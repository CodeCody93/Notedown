// @vitest-environment jsdom
// Round-6 follow-up: unit coverage for the Import pipeline text paths
// (de-risks the C1/C2/C5 user-test items, including the Turndown+GFM lazy
// interop that HTML/DOCX conversion depends on at runtime).
// DOMPurify/Turndown need a DOM, hence the jsdom environment.
import { describe, expect, it } from 'vitest'
import { convertToMarkdown, detectFormat, lossSummaryFor } from '../src/app/import'

describe('detectFormat', () => {
  const cases: Array<[string, ReturnType<typeof detectFormat>]> = [
    ['notes.md', 'markdown'],
    ['NOTES.MD', 'markdown'],
    ['a.markdown', 'markdown'],
    ['a.txt', 'txt'],
    ['page.html', 'html'],
    ['page.HTM', 'html'],
    ['doc.pdf', 'pdf'],
    ['doc.PDF', 'pdf'],
    ['word.docx', 'docx'],
    ['r.rtf', 'rtf'],
    ['noext', 'txt'],
    ['odd.xyz', 'txt'],
  ]
  it.each(cases)('detectFormat(%s) → %s', (name, expected) => {
    expect(detectFormat(name)).toBe(expected)
  })
})

describe('lossSummaryFor', () => {
  it('is empty for lossless formats', () => {
    expect(lossSummaryFor('markdown')).toEqual([])
    expect(lossSummaryFor('txt')).toEqual([])
  })

  it('warns for every lossy format', () => {
    for (const format of ['html', 'pdf', 'docx', 'rtf'] as const) {
      expect(lossSummaryFor(format).length).toBeGreaterThan(0)
    }
  })
})

describe('convertToMarkdown — text formats', () => {
  it('decodes txt verbatim, stripping BOM and normalizing CRLF', async () => {
    const bytes = new TextEncoder().encode('﻿hello\r\nworld\r\n')
    const res = await convertToMarkdown(bytes, 'txt')
    expect(res.markdown).toBe('hello\nworld\n')
    expect(res.losses).toEqual([])
  })

  it('passes markdown through (string or bytes)', async () => {
    expect((await convertToMarkdown('# Hi', 'markdown')).markdown).toContain('# Hi')
    const bytes = new TextEncoder().encode('# Hi')
    expect((await convertToMarkdown(bytes, 'markdown')).markdown).toContain('# Hi')
  })
})

describe('convertToMarkdown — HTML (Turndown+GFM interop)', () => {
  it('converts headings, bold, lists and tables; strips scripts', async () => {
    const html = [
      '<h1>Title</h1>',
      '<p>Hello <strong>bold</strong></p>',
      '<ul><li>one</li><li>two</li></ul>',
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
      '<script>alert(1)</script>',
    ].join('\n')
    const res = await convertToMarkdown(html, 'html')
    expect(res.markdown).toContain('# Title')
    expect(res.markdown).toContain('**bold**')
    expect(res.markdown).toContain('-   one')
    expect(res.markdown).toContain('| A')
    expect(res.markdown).not.toContain('alert')
    expect(res.markdown).not.toContain('<script')
    expect(res.losses.length).toBeGreaterThan(0)
  })
})

describe('convertToMarkdown — HTML Notedown dialect (round-7 C2b)', () => {
  it('maps mark/sup/sub/spoiler to ==/^^/~/||', async () => {
    const html =
      '<p>Hi <mark>lit</mark> <sup>up</sup> <sub>down</sub> ' +
      '<span class="md-spoiler" data-revealed="false">secret</span></p>'
    const res = await convertToMarkdown(html, 'html')
    expect(res.markdown).toContain('==lit==')
    expect(res.markdown).toContain('^up^')
    expect(res.markdown).toContain('~down~')
    expect(res.markdown).toContain('||secret||')
  })

  it('maps dropdown/subtext/deflist blocks', async () => {
    const html = [
      '<details class="md-dropdown"><summary class="md-dropdown-summary">Title</summary><p>Body text</p></details>',
      '<p class="md-subtext">quiet</p>',
      '<dl><dt>Term</dt><dd>Definition</dd></dl>',
    ].join('\n')
    const res = await convertToMarkdown(html, 'html')
    expect(res.markdown).toContain('>>> Title')
    expect(res.markdown).toContain('Body text')
    expect(res.markdown).toContain('>>>')
    expect(res.markdown).toContain('-# quiet')
    expect(res.markdown).toContain('Term\n: Definition')
  })
})

describe('convertToMarkdown — HTML footnotes + data images (round-7 C2a/C2c)', () => {
  it('preserves footnotes as [^n] refs + definitions, never raw HTML', async () => {
    const html = [
      '<p>Claim.<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup></p>',
      '<section class="footnotes"><ol><li id="fn1">The note. <a href="#fnref1">↩</a></li></ol></section>',
    ].join('\n')
    const res = await convertToMarkdown(html, 'html')
    expect(res.markdown).toContain('[^1]')
    expect(res.markdown).toContain('[^1]: The note.')
    expect(res.markdown).not.toContain('<')
  })

  it('strips data-URL images and notes the loss', async () => {
    const html = '<p>Before <img src="data:image/png;base64,iVBORw0KGgo=" alt="x"> after</p>'
    const res = await convertToMarkdown(html, 'html')
    expect(res.markdown).not.toContain('data:image')
    expect(res.markdown).toContain('Before')
    expect(res.markdown).toContain('after')
    expect(res.losses.some((l) => l.includes('stripped'))).toBe(true)
  })
})

describe('convertToMarkdown — RTF (built-in converter)', () => {
  it('keeps paragraphs and bold text', async () => {
    const rtf = '{\\rtf1\\ansi Hello \\b bold\\b0  world\\par second}'
    const res = await convertToMarkdown(rtf, 'rtf')
    expect(res.markdown).toContain('Hello')
    expect(res.markdown).toContain('bold')
    expect(res.markdown).toContain('second')
    expect(res.markdown).not.toContain('\\b')
    expect(res.losses.length).toBeGreaterThan(0)
  })

  it('keeps bold closers on the same line as their text (round-7 C5)', async () => {
    const res = await convertToMarkdown('{\\rtf1\\ansi Hello \\b bold\\b0\\par world}', 'rtf')
    expect(res.markdown).toBe('Hello **bold**\nworld')
    // Closers must never strand alone on a line (the reported bug); a closer
    // at end-of-line before a paragraph break (`**\nworld`) is legitimate.
    expect(res.markdown.split('\n').some((line) => line.trim() === '**')).toBe(false)
  })
})

describe('convertToMarkdown — RTF WordPad repro (round-8 D1/D2)', () => {
  // WordPad sample from the round-8 report (CRLF-joined like the .rtf source).
  const wordpadRtf = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}{\\f1\\fnil\\fcharset2 Symbol;}}',
    '{\\colortbl ;\\red255\\green255\\blue0;}',
    '{\\*\\generator Riched20 10.0.19041}\\viewkind4\\uc1',
    '\\pard\\sa200\\sl276\\slmult1\\b\\f0\\fs22\\lang9 bold\\par',
    '\\b0\\i italic\\i0\\par',
    '\\ul underline\\ulnone\\par',
    '\\strike strikethrough\\strike0\\par',
    '\\ul\\b\\i\\strike all\\ulnone\\b0\\i0\\strike0\\par',
    'paragraph\\par',
    '\\pard{\\pntext\\f1\\\'B7\\tab}{\\*\\pn\\pnlvlblt\\pnf1\\pnindent0{\\pntxtb\\\'B7}}\\fi-360\\li720\\sa200\\sl276\\slmult1 Unordered List\\par',
    '{\\pntext\\f1\\\'B7\\tab}Unordered List\\par',
    '{\\pntext\\f1\\\'B7\\tab}Unordered List\\par',
    '\\pard\\sa200\\sl276\\slmult1\\par',
    '\\pard {\\pntext\\f0 1.\\tab}{\\*\\pn\\pnlvlbody\\pnf0\\pnindent0\\pnstart1\\pndec{\\pntxta.}}\\fi-360\\li720\\sa200\\sl276\\slmult1 List\\par',
    '{\\pntext\\f0 2.\\tab}List\\par',
    '{\\pntext\\f0 3.\\tab}List\\par',
    '\\pard\\sa200\\sl276\\slmult1\\sub subscript\\nosupersub text\\par',
    '\\super superscript\\nosupersub text\\par',
    '\\highlight1 highlight\\highlight0\\par',
    '}',
  ].join('\r\n')

  it('converts the full WordPad sample without leaking markers', async () => {
    const res = await convertToMarkdown(wordpadRtf, 'rtf')
    const lines = res.markdown.split('\n')
    expect(lines).toContain('**bold**')
    expect(lines).toContain('*italic*')
    expect(res.markdown).not.toContain('***italic***')
    expect(lines).toContain('underline')
    expect(res.markdown).not.toContain('**underline**')
    expect(lines).toContain('~~strikethrough~~')
    const allLine = lines.find((l) => l.includes('all')) ?? ''
    expect(allLine).toContain('all')
    // Balanced markers on the combined line (even counts), never a stray run.
    expect((allLine.match(/\*/g) ?? []).length % 2).toBe(0)
    expect((allLine.match(/~/g) ?? []).length % 2).toBe(0)
    expect(lines.some((l) => /^[\s*~=_^]+$/.test(l) && l.trim() !== '')).toBe(false)
    expect(lines).toContain('paragraph')
    expect(lines.filter((l) => l === '- Unordered List').length).toBe(3)
    expect(lines).toContain('1. List')
    expect(lines).toContain('2. List')
    expect(lines).toContain('3. List')
    expect(lines).toContain('~subscript~ text')
    expect(lines).toContain('^superscript^ text')
    expect(lines).toContain('==highlight==')
    expect(res.markdown).not.toContain('\\b')
    expect(res.markdown).not.toContain('\\par')
  })

  it('explicit off-switches cancel pending reopen (round-8 D1)', async () => {
    const res = await convertToMarkdown('{\\rtf1\\ansi \\b bold\\par\\b0 plain}', 'rtf')
    expect(res.markdown).toBe('**bold**\nplain')
    expect(res.markdown).not.toContain('****')
  })

  it('maps strike/sub/super/highlight singles (round-8 D1/D2)', async () => {
    expect((await convertToMarkdown('{\\rtf1\\ansi \\strike gone\\strike0}', 'rtf')).markdown).toBe(
      '~~gone~~',
    )
    expect((await convertToMarkdown('{\\rtf1\\ansi \\sub down\\nosupersub after}', 'rtf')).markdown).toBe(
      '~down~ after',
    )
    expect((await convertToMarkdown('{\\rtf1\\ansi \\super up\\nosupersub after}', 'rtf')).markdown).toBe(
      '^up^ after',
    )
    expect(
      (await convertToMarkdown('{\\rtf1\\ansi \\highlight1 lit\\highlight0}', 'rtf')).markdown,
    ).toBe('==lit==')
  })
})

describe('convertToMarkdown — HTML checkbox task lists (round-8 E4 side-note)', () => {
  it('converts checked checkbox items to - [x]-style output', async () => {
    const res = await convertToMarkdown(
      '<ul><li><input type="checkbox" checked> done</li></ul>',
      'html',
    )
    expect(res.markdown).toContain('[x]')
    expect(res.markdown).toContain('done')
  })
})
