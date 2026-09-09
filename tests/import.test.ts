// @vitest-environment jsdom
// Round-6 follow-up: unit coverage for the Import pipeline text paths
// (de-risks the C1/C2/C5 user-test items, including the Turndown+GFM lazy
// interop that HTML/DOCX conversion depends on at runtime).
// DOMPurify/Turndown need a DOM, hence the jsdom environment.
import { describe, expect, it, vi } from 'vitest'
import {
  convertToMarkdown,
  detectFormat,
  lossSummaryFor,
  pdfClassifyFontObject,
  pdfCollectFontStyles,
  pdfContentFontNames,
  pdfFlagSupSub,
  pdfHeaderLevel,
  pdfItemsToRawLines,
  pdfPageBodyMedian,
  pdfPageToText,
  pdfRenderLine,
  pdfStyleOfFont,
} from '../src/app/import'
import type { PdfImportSpan, PdfRawSpan } from '../src/app/import'
import { markdownToPdfBytes } from '../src/app/export'

// Test-only worker redirect: src/app/import.ts loads its pdfjs worker through
// Vite's `?url` asset import, which resolves to a bogus path under vitest.
// Point it at the real legacy worker file instead (file:// URL, so pdfjs can
// load it on the main-thread fake worker — jsdom has no Worker). The URL is
// built from process.cwd() (vitest runs at the project root): import.meta.url
// is an http:// URL under vite-node, so `new URL(…, import.meta.url)` would
// yield an unloadable http: URL. Production is unaffected (real Vite build
// emits the hashed worker asset).
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { resolve } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  return {
    default: pathToFileURL(resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href,
  }
})

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

// --- Packet A: PDF text-layer styles (synthetic TextItem shapes, no pdfjs) ---

/** Minimal TextItem-shaped object (only the fields the import pipeline reads). */
function pdfItem(
  str: string,
  opts: { font?: string; height?: number; y?: number; x?: number; w?: number; eol?: boolean } = {},
): Record<string, unknown> {
  const x = opts.x ?? 0
  const w = opts.w ?? 50
  return {
    str,
    dir: 'ltr',
    transform: [1, 0, 0, 1, x, opts.y ?? 0],
    width: w,
    height: opts.height ?? 10,
    fontName: opts.font ?? 'Helvetica',
    hasEOL: opts.eol ?? false,
  }
}

describe('pdfStyleOfFont (Packet A)', () => {
  it('strips a 6-char subset prefix before matching', () => {
    expect(pdfStyleOfFont('ABCDEF+Helvetica-Bold')).toEqual({ bold: true, italic: false })
    expect(pdfStyleOfFont('XYZ123+Arial-ItalicMT')).toEqual({ bold: false, italic: true })
  })

  it('matches Bold (bold) and Oblique/Italic (italic)', () => {
    expect(pdfStyleOfFont('Helvetica-Bold')).toEqual({ bold: true, italic: false })
    expect(pdfStyleOfFont('Times-Oblique')).toEqual({ bold: false, italic: true })
    expect(pdfStyleOfFont('Courier-Italic')).toEqual({ bold: false, italic: true })
  })

  it('matches both for BoldOblique names', () => {
    expect(pdfStyleOfFont('Helvetica-BoldOblique')).toEqual({ bold: true, italic: true })
  })

  it('is regular for plain, empty and unknown names', () => {
    expect(pdfStyleOfFont('Helvetica')).toEqual({ bold: false, italic: false })
    expect(pdfStyleOfFont('Courier')).toEqual({ bold: false, italic: false })
    expect(pdfStyleOfFont('')).toEqual({ bold: false, italic: false })
    expect(pdfStyleOfFont('Symbol')).toEqual({ bold: false, italic: false })
    expect(pdfStyleOfFont('d0_f1')).toEqual({ bold: false, italic: false })
  })

  it('never throws on non-string input', () => {
    const fn = pdfStyleOfFont as (name: unknown) => { bold: boolean; italic: boolean }
    expect(fn(undefined)).toEqual({ bold: false, italic: false })
    expect(fn(null)).toEqual({ bold: false, italic: false })
    expect(fn(42)).toEqual({ bold: false, italic: false })
  })
})

describe('pdfPageToText — bold/italic emission (Packet A)', () => {
  it('wraps bold / italic / both', () => {
    expect(pdfPageToText([pdfItem('bold', { font: 'Helvetica-Bold' })])).toBe('**bold**')
    expect(pdfPageToText([pdfItem('italic', { font: 'Helvetica-Oblique' })])).toBe('*italic*')
    expect(pdfPageToText([pdfItem('both', { font: 'Helvetica-BoldOblique' })])).toBe('***both***')
  })

  it('merges adjacent same-style spans and joins mixed styles with spaces', () => {
    expect(
      pdfPageToText([pdfItem('hi', { font: 'Helvetica-Bold' }), pdfItem('there')]),
    ).toBe('**hi** there')
    expect(
      pdfPageToText([
        pdfItem('a', { font: 'ABCDEF+Helvetica-Bold' }),
        pdfItem('b', { font: 'ABCDEF+Helvetica-Bold' }),
      ]),
    ).toBe('**ab**')
  })

  it('never emits empty marker pairs; whitespace-only styled spans stay bare', () => {
    expect(pdfPageToText([pdfItem('', { font: 'Helvetica-Bold' }), pdfItem('x')])).toBe('x')
    expect(pdfPageToText([pdfItem(' ', { font: 'Helvetica-Bold' })])).toBe('')
    expect(pdfPageToText([pdfItem('a'), pdfItem(' ', { font: 'Helvetica-Bold' })])).toBe('a')
    expect(pdfPageToText([pdfItem('x', { font: 'Helvetica-Bold' })])).not.toContain('****')
  })

  it('ignores marked-content items (no text, no phantom spaces, no breaks)', () => {
    const items: unknown[] = [
      { type: 'beginMarkedContent', id: 'm1' },
      pdfItem('a', { font: 'Helvetica-Bold' }),
      { type: 'endMarkedContent', id: 'm1' },
      pdfItem('b', { font: 'Helvetica-Bold' }),
    ]
    expect(pdfPageToText(items)).toBe('**ab**')
  })

  it('resolves emphasis through the page styles dict when the id is opaque', () => {
    const items = [pdfItem('x', { font: 'd0_f1' })]
    expect(pdfPageToText(items)).toBe('x')
    expect(pdfPageToText(items, { d0_f1: { fontFamily: 'Helvetica-Bold' } })).toBe('**x**')
  })

  it('keeps the legacy no-hasEOL fallback byte-identical for regular fonts', () => {
    // Gaps ride in-str (as real pdfjs emits them); verbatim-merge preserves them.
    const bare = (str: string): Record<string, unknown> => ({
      str,
      dir: 'ltr',
      transform: [1, 0, 0, 1, 0, 0],
      width: 10,
      height: 10,
      fontName: 'Helvetica',
    })
    expect(pdfPageToText([bare('a '), bare('b')])).toBe('a b')
    expect(pdfPageToText([])).toBe('')
  })
})

describe('pdfPageToText — headers (Packet A)', () => {
  const bodies = [
    pdfItem('body one', { eol: true }),
    pdfItem('body two', { eol: true }),
    pdfItem('body three', { eol: true }),
  ]

  it('promotes a 1.6× line to #', () => {
    expect(pdfPageToText([...bodies, pdfItem('Big Title', { height: 16, eol: true })])).toBe(
      'body one\nbody two\nbody three\n# Big Title',
    )
  })

  it('uses 1.35 / 1.15 boundaries for ## / ### / body', () => {
    expect(pdfPageToText([...bodies, pdfItem('Probe', { height: 13.5, eol: true })])).toContain(
      '## Probe',
    )
    expect(pdfPageToText([...bodies, pdfItem('Probe', { height: 11.5, eol: true })])).toContain(
      '### Probe',
    )
    const justBelow = pdfPageToText([...bodies, pdfItem('Probe words', { height: 11.4, eol: true })])
    expect(justBelow).toContain('Probe words')
    expect(justBelow).not.toContain('#')
  })

  it('requires EVERY normal span in the line to clear the threshold', () => {
    const res = pdfPageToText([
      ...bodies,
      pdfItem('Big ', { height: 16 }),
      pdfItem('small', { height: 10, eol: true }),
    ])
    expect(res).toContain('Big small')
    expect(res).not.toContain('#')
  })

  it('keeps multi-line header bands as separate prefixed lines', () => {
    expect(
      pdfPageToText([
        ...bodies,
        pdfItem('A', { height: 16, eol: true }),
        pdfItem('B', { height: 16, eol: true }),
      ]),
    ).toBe('body one\nbody two\nbody three\n# A\n# B')
  })

  it('excludes sup spans from the body median', () => {
    // Without exclusion the small `s` span would drag the median (10) down and
    // promote P (13/10 = 1.3 → ##); with exclusion the median is 11.5 and both
    // P (13/11.5 ≈ 1.13) and B (20/11.5 ≈ 1.74 → still #) behave correctly.
    const res = pdfPageToText([
      pdfItem('A', { eol: true }),
      pdfItem('B', { height: 20, eol: true }),
      pdfItem('H'),
      pdfItem('s', { height: 7, y: 2, eol: true }),
      pdfItem('P', { height: 13, eol: true }),
    ])
    expect(res).toBe('A\n# B\nH^s^\nP')
  })
})

describe('pdfPageToText — super/subscript (Packet A)', () => {
  it('attaches sup/sub directly with no surrounding spaces', () => {
    expect(pdfPageToText([pdfItem('H'), pdfItem('up', { height: 7, y: 3.5 })])).toBe('H^up^')
    expect(pdfPageToText([pdfItem('H'), pdfItem('dn', { height: 7, y: -2.5 })])).toBe('H~dn~')
    expect(
      pdfPageToText([
        pdfItem('H'),
        pdfItem('up', { height: 7, y: 3.5 }),
        pdfItem(' and '),
        pdfItem('H'),
        pdfItem('dn', { height: 7, y: -2.5 }),
      ]),
    ).toBe('H^up^ and H~dn~')
  })

  it('attaches a leading sup without a leading space', () => {
    expect(pdfPageToText([pdfItem('up', { height: 7, y: 3.5 }), pdfItem('H')])).toBe('^up^ H')
  })

  it('leaves small-but-unshifted spans plain', () => {
    expect(pdfPageToText([pdfItem('big '), pdfItem('sml', { height: 7, y: 0 })])).toBe('big sml')
  })

  it('treats an all-small line as normal (no whole-line misfire)', () => {
    const res = pdfPageToText([pdfItem('a ', { height: 0, y: 0 }), pdfItem('b', { height: 0, y: 5 })])
    expect(res).toBe('a b')
    expect(res).not.toContain('^')
    expect(res).not.toContain('~')
  })
})

describe('PDF line/span builders (Packet A units)', () => {
  it('pdfHeaderLevel thresholds are pure and boundary-exact', () => {
    expect(pdfHeaderLevel([16], 10)).toBe(1)
    expect(pdfHeaderLevel([13.5], 10)).toBe(2)
    expect(pdfHeaderLevel([11.5], 10)).toBe(3)
    expect(pdfHeaderLevel([11.4], 10)).toBe(0)
    expect(pdfHeaderLevel([], 10)).toBe(0)
    expect(pdfHeaderLevel([16], NaN)).toBe(0)
    expect(pdfHeaderLevel([16], 0)).toBe(0)
    expect(pdfHeaderLevel([16, 10], 10)).toBe(0)
  })

  it('builders compose: raw lines → flags → median → render', () => {
    const raw: PdfRawSpan[][] = pdfItemsToRawLines([
      pdfItem('H'),
      pdfItem('up', { height: 7, y: 3.5, eol: true }),
    ])
    expect(raw.length).toBe(1)
    const flagged: PdfImportSpan[] = pdfFlagSupSub(raw[0] ?? [])
    expect(flagged).toEqual([
      { text: 'H', bold: false, italic: false, sup: false, sub: false },
      { text: 'up', bold: false, italic: false, sup: true, sub: false },
    ])
    expect(pdfPageBodyMedian(raw, [flagged])).toBe(10)
    expect(pdfRenderLine(flagged, 0)).toBe('H^up^')
    expect(pdfRenderLine(flagged, 1)).toBe('# H^up^')
  })
})

describe('convertToMarkdown — PDF text-layer round-trip (Packet A)', () => {
  // NOTE (Packet C update): pdfjs `TextItem.fontName` is an opaque
  // `docId_fontId` (`font.loadedName`, never the style-carrying BaseFont) and
  // `styles[].fontFamily` is a generic CSS family (`sans-serif`, …) — so
  // text-layer keyword matching alone cannot recover bold/italic. Packet C
  // resolves each id through `page.commonObjs` (after `getOperatorList`) to
  // the true BaseFont `.name` plus pdfjs's own `.bold`/`.italic`, and marks
  // spans from that (see the Packet C round-trip below). The remaining limit
  // is honest: fully-obfuscated BaseFonts (random, keyword-free names) still
  // import as plain words. Bold/italic MARKERS are proven by the synthetic
  // tests above (style-carrying font names → `**`/`*`); this round-trip proves
  // the geometry heuristics (relative-size headers, baseline-shift scripts)
  // fire on real pdfjs items end to end.
  it('recovers headings + sup/sub from real pdfjs output; keeps styled words', async () => {
    const bytes = await markdownToPdfBytes('**bold** and *italic*\n\n# Big Title\n\nH^up^ and H~dn~\n')
    const res = await convertToMarkdown(bytes, 'pdf')
    expect(res.markdown).toContain('bold')
    expect(res.markdown).toContain('italic')
    expect(res.markdown).toContain('# Big Title')
    expect(res.markdown).toContain('^up^')
    expect(res.markdown).toContain('~dn~')
    expect(res.markdown).not.toContain('****')
  }, 30000)
})

describe('pdfClassifyFontObject (Packet C)', () => {
  it('classifies style-name keywords', () => {
    expect(pdfClassifyFontObject({ name: 'Helvetica-Bold' })).toEqual({ bold: true, italic: false })
    expect(pdfClassifyFontObject({ name: 'Helvetica-Oblique' })).toEqual({
      bold: false,
      italic: true,
    })
    expect(pdfClassifyFontObject({ name: 'Courier-Italic' })).toEqual({
      bold: false,
      italic: true,
    })
    expect(pdfClassifyFontObject({ name: 'Helvetica-BoldOblique' })).toEqual({
      bold: true,
      italic: true,
    })
    expect(pdfClassifyFontObject({ name: 'Helvetica' })).toEqual({ bold: false, italic: false })
  })

  it('strips a 6-char subset prefix before matching', () => {
    expect(pdfClassifyFontObject({ name: 'ABCDEF+Helvetica-Bold' })).toEqual({
      bold: true,
      italic: false,
    })
    expect(pdfClassifyFontObject({ name: 'XYZ123+Arial-ItalicMT' })).toEqual({
      bold: false,
      italic: true,
    })
  })

  it('honors pdfjs booleans when strictly === true', () => {
    expect(pdfClassifyFontObject({ name: 'Plain', bold: true })).toEqual({
      bold: true,
      italic: false,
    })
    expect(pdfClassifyFontObject({ name: 'Plain', italic: true })).toEqual({
      bold: false,
      italic: true,
    })
    expect(pdfClassifyFontObject({ name: 'Plain', bold: true, italic: true })).toEqual({
      bold: true,
      italic: true,
    })
    // Truthy-but-not-true is ignored (strict === true).
    expect(pdfClassifyFontObject({ name: 'Plain', bold: 1, italic: 'yes' })).toEqual({
      bold: false,
      italic: false,
    })
  })

  it('is regular for garbage/null/{} and never throws', () => {
    const bad: unknown[] = [null, undefined, 42, 'Helvetica-Bold', true, {}, { name: 42 }, { bold: 'yes' }]
    for (const font of bad) {
      expect(() => pdfClassifyFontObject(font)).not.toThrow()
      expect(pdfClassifyFontObject(font)).toEqual({ bold: false, italic: false })
    }
  })
})

describe('pdfContentFontNames (Packet C)', () => {
  it('dedupes, keeps first-seen order, and skips non-strings/empties', () => {
    expect(
      pdfContentFontNames([
        pdfItem('a', { font: 'g_d0_f1' }),
        pdfItem('b', { font: 'Helvetica' }),
        pdfItem('c', { font: 'g_d0_f1' }),
        pdfItem('d', { font: 'g_d0_f2' }),
      ]),
    ).toEqual(['g_d0_f1', 'Helvetica', 'g_d0_f2'])
  })

  it('skips missing, non-string and empty fontNames', () => {
    const items: unknown[] = [
      pdfItem('a', { font: 'g_d0_f1' }),
      { str: 'no-font' },
      { str: 'num', fontName: 42 },
      { str: 'empty', fontName: '' },
      { type: 'beginMarkedContent', id: 'm1' },
      null,
      undefined,
    ]
    expect(pdfContentFontNames(items)).toEqual(['g_d0_f1'])
    expect(pdfContentFontNames([])).toEqual([])
  })
})

describe('pdfCollectFontStyles (Packet C)', () => {
  it('resolves name-keyed objects through a fake store into a classified map', async () => {
    const store = {
      get(id: string, cb: (font: unknown) => void): void {
        const fonts: Record<string, unknown> = {
          g_d0_f1: { name: 'Helvetica-Bold', bold: true, italic: false },
          g_d0_f2: { name: 'Helvetica', bold: false, italic: false },
          g_d0_f3: { name: 'Helvetica-Oblique', bold: false, italic: true },
        }
        cb(fonts[id] ?? { name: 'Helvetica' })
      },
    }
    const map = await pdfCollectFontStyles(store, ['g_d0_f1', 'g_d0_f2', 'g_d0_f1', '', 'g_d0_f3'], 500)
    expect(map.get('g_d0_f1')).toEqual({ bold: true, italic: false })
    expect(map.get('g_d0_f2')).toEqual({ bold: false, italic: false })
    expect(map.get('g_d0_f3')).toEqual({ bold: false, italic: true })
    expect(map.size).toBe(3)
  })

  it('returns an empty map fast when the store never calls back', async () => {
    const silent = { get(_id: string, _cb: (font: unknown) => void): void {} }
    const map = await pdfCollectFontStyles(silent, ['g_d0_f1'], 20)
    expect(map.size).toBe(0)
  })

  it('returns an empty map for a null store and never rejects', async () => {
    await expect(pdfCollectFontStyles(null, ['g_d0_f1'], 50)).resolves.toEqual(new Map())
    await expect(pdfCollectFontStyles(undefined, ['g_d0_f1'], 50)).resolves.toEqual(new Map())
  })

  it('returns an empty map when store.get throws (never rejects)', async () => {
    const throwing = {
      get(_id: string, _cb: (font: unknown) => void): void {
        throw new Error('boom')
      },
    }
    await expect(pdfCollectFontStyles(throwing, ['g_d0_f1'], 50)).resolves.toEqual(new Map())
  })
})

describe('pdfItemsToRawLines fontStyles map join (Packet C)', () => {
  it('marks an opaque id bold through the resolved map', () => {
    const items = [pdfItem('hi', { font: 'g_d0_f1' })]
    // No map: opaque ids stay plain (no phantom markers).
    expect(pdfPageToText(items)).toBe('hi')
    // With the resolved map: the span wraps **.
    expect(
      pdfPageToText(items, undefined, {
        fontStyles: new Map([['g_d0_f1', { bold: true, italic: false }]]),
      }),
    ).toBe('**hi**')
  })

  it('marks italic through the map and keeps direct matches first', () => {
    expect(
      pdfPageToText([pdfItem('it', { font: 'g_d0_f9' })], undefined, {
        fontStyles: new Map([['g_d0_f9', { bold: false, italic: true }]]),
      }),
    ).toBe('*it*')
    // Direct style-carrying names still hit without any map.
    expect(pdfItemsToRawLines([pdfItem('b', { font: 'Helvetica-Bold' })])[0]?.[0]).toMatchObject({
      bold: true,
      italic: false,
    })
  })
})

describe('convertToMarkdown — PDF bold/italic font-resource round-trip (Packet C)', () => {
  it('recovers **bold** and *italic* end to end via commonObjs resolution', async () => {
    const bytes = await markdownToPdfBytes('**bold** and *italic* and plain\n')
    const res = await convertToMarkdown(bytes, 'pdf')
    expect(res.markdown).toContain('**bold**')
    expect(res.markdown).toContain('*italic*')
  }, 60000)
})

describe('pdfPageToText — vector decorations (rules + highlights)', () => {
  // classifyHorizontalRule is imported test-only (never in src bundle paths —
  // import.ts receives it as a callback from the lazy pdfVector chunk).
  it('marks an overlapped span __underline__ via classifyRule', async () => {
    const fn = (await import('../src/app/pdfVector')).classifyHorizontalRule
    const out = pdfPageToText([pdfItem('hi', { x: 30, y: 100, eol: true })], undefined, {
      rules: [{ x0: 30, y0: 98.5, x1: 80, y1: 99 }],
      classifyRule: fn,
    })
    expect(out).toBe('__hi__')
  })

  it('marks an overlapped span ~~strike~~ in the strike band', async () => {
    const fn = (await import('../src/app/pdfVector')).classifyHorizontalRule
    const out = pdfPageToText([pdfItem('hi', { x: 30, y: 100, eol: true })], undefined, {
      rules: [{ x0: 30, y0: 102.6, x1: 80, y1: 103 }],
      classifyRule: fn,
    })
    expect(out).toBe('~~hi~~')
  })

  it('ignores rules without classifyRule and rules outside both bands', async () => {
    const fn = (await import('../src/app/pdfVector')).classifyHorizontalRule
    const items = [pdfItem('hi', { x: 30, y: 100, eol: true })]
    expect(pdfPageToText(items, undefined, { rules: [{ x0: 30, y0: 98.5, x1: 80, y1: 99 }] })).toBe('hi')
    expect(
      pdfPageToText(items, undefined, {
        rules: [{ x0: 30, y0: 120, x1: 80, y1: 120.5 }],
        classifyRule: fn,
      }),
    ).toBe('hi')
  })

  it('marks ==highlight== for a hugging fill, ignores full-bleed shade bands', () => {
    const hug = pdfPageToText([pdfItem('hi', { x: 30, y: 100, eol: true })], undefined, {
      highlights: [{ x0: 28, y0: 99, x1: 82, y1: 108 }],
    })
    expect(hug).toBe('==hi==')
    // Code-block-style background: full content width over a short line.
    const shade = pdfPageToText([pdfItem('hi', { x: 30, y: 100, eol: true })], undefined, {
      highlights: [{ x0: 0, y0: 99, x1: 527, y1: 108 }],
    })
    expect(shade).toBe('hi')
  })
})

describe('pdfPageToText — vector tables', () => {
  const grid2x2 = {
    x0: 30,
    y0: 90,
    x1: 130,
    y1: 110,
    cols: 2,
    rows: 2,
    colEdges: [30, 80, 130],
    rowEdges: [90, 100, 110],
  }

  it('rebuilds a clean 2x2 grid with header separator', () => {
    const out = pdfPageToText(
      [
        pdfItem('a', { x: 35, y: 105 }),
        pdfItem('b', { x: 90, y: 105, eol: true }),
        pdfItem('c', { x: 35, y: 95 }),
        pdfItem('d', { x: 90, y: 95, eol: true }),
      ],
      undefined,
      { tables: [grid2x2] },
    )
    expect(out).toBe('| a | b |\n| --- | --- |\n| c | d |')
  })

  it('escapes pipes inside cells', () => {
    const out = pdfPageToText(
      [
        pdfItem('a|b', { x: 35, y: 105 }),
        pdfItem('c', { x: 90, y: 105, eol: true }),
        pdfItem('d', { x: 35, y: 95 }),
        pdfItem('e', { x: 90, y: 95, eol: true }),
      ],
      undefined,
      { tables: [grid2x2] },
    )
    expect(out).toContain('a\\|b')
  })

  it('rejects single-row grids and straddling lines (flatten fallback)', () => {
    // NOTE: real pdfjs output separates words with explicit space items;
    // adjacent same-style spans without one merge (verbatim concat), so the
    // space items below mirror production.
    const single = pdfPageToText(
      [pdfItem('a', { x: 35, y: 105 }), pdfItem(' ', { x: 60, y: 105 }), pdfItem('b', { x: 90, y: 105, eol: true })],
      undefined,
      { tables: [grid2x2] },
    )
    expect(single).toBe('a b')
    expect(single).not.toContain('|')
    const straddle = pdfPageToText(
      [
        pdfItem('a', { x: 35, y: 105 }),
        pdfItem('b', { x: 90, y: 105, eol: true }),
        pdfItem('outside', { x: 200, y: 100, eol: true }),
      ],
      undefined,
      { tables: [grid2x2] },
    )
    expect(straddle).not.toContain('| a | b |')
    expect(straddle).toContain('outside')
  })

  it('keeps table text out of the body median (headers still detected)', () => {
    const out = pdfPageToText(
      [
        pdfItem('Title', { height: 20, x: 30, y: 200, eol: true }),
        pdfItem('a', { x: 35, y: 105 }),
        pdfItem('b', { x: 90, y: 105, eol: true }),
        pdfItem('c', { x: 35, y: 95 }),
        pdfItem('d', { x: 90, y: 95, eol: true }),
      ],
      undefined,
      { tables: [grid2x2] },
    )
    expect(out).toContain('# Title')
    expect(out).toContain('| a | b |')
  })
})

describe('convertToMarkdown — PDF vector round-trip (decorations + tables)', () => {
  it('recovers __underline__, ~~strike~~, ==highlight== and a real table end to end', async () => {
    const bytes = await markdownToPdfBytes(
      '__ul__ and ~~st~~\n\n==hl==\n\n| a | b |\n| --- | --- |\n| c | d |\n',
    )
    const res = await convertToMarkdown(bytes, 'pdf')
    expect(res.markdown).toContain('__ul__')
    expect(res.markdown).toContain('~~st~~')
    expect(res.markdown).toContain('==hl==')
    expect(res.markdown).toContain('| a | b |')
    expect(res.markdown).toContain('| --- | --- |')
    expect(res.markdown).toContain('| c | d |')
  }, 60000)
})
