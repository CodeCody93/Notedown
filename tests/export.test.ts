// @vitest-environment jsdom
// M4 Packet 4 — export fixes: E3 (__ renders <u>), Other #5 (-# subtext
// paragraphs), G2 (standalone export follows system dark mode instead of
// baking a theme), Other #4 (task-list shorthand markers -[] / -[ ] / -[x]).
// P1 Export HTML fix batch — classifyImageSrc, inlineMarkdownImagesDetailed,
// hardened resolveAgainstDocDir/normalizeRelSrc, html-img + ref-style inlining,
// standalone color-scheme/print/clipboard fixes.
// DOMPurify needs a window, hence the jsdom environment.
import { describe, it, expect } from 'vitest'
import {
  applySpoilerSpansToLine,
  renderMarkdown,
  renderStandaloneHtml,
  renderStandaloneHtmlWithImages,
  inlineMarkdownImages,
  inlineMarkdownImagesDetailed,
  classifyImageSrc,
  MARKDOWN_BODY_CSS,
  HLJS_CSS_LIGHT,
  HLJS_CSS_DARK,
  escapeHtml,
  EXPORT_FORMATS,
  exportLossSummaryFor,
  markdownToRtf,
  markdownToDocxBytes,
} from '../src/app/export'
import { resolveAgainstDocDir, normalizeRelSrc } from '../src/app/text'

describe('renderMarkdown — cheat-sheet features (PLAN §6B)', () => {
  const cases: Array<{
    name: string
    markdown: string
    contains: string[]
    notContains?: string[]
  }> = [
    { name: 'heading', markdown: '# Hello', contains: ['<h1>Hello</h1>'] },
    { name: 'bold', markdown: '**b**', contains: ['<strong>b</strong>'] },
    { name: 'italic', markdown: '*i*', contains: ['<em>i</em>'] },
    { name: 'strikethrough', markdown: '~~s~~', contains: ['<s>s</s>'] },
    { name: 'inline code', markdown: '`c`', contains: ['<code>c</code>'] },
    { name: 'horizontal rule', markdown: '---', contains: ['<hr'] },
    { name: 'link', markdown: '[x](https://a.dev)', contains: ['<a href="https://a.dev">x</a>'] },
    { name: 'image', markdown: '![a](i.png)', contains: ['<img src="i.png" alt="a">'] },
    { name: 'blockquote', markdown: '> q', contains: ['<blockquote>'] },
    { name: 'unordered list', markdown: '- it', contains: ['<li>it</li>'] },
    { name: 'ordered list', markdown: '1. it', contains: ['<ol>'] },
    { name: 'GFM table', markdown: '| a | b |\n|---|---|\n| 1 | 2 |', contains: ['<table>'] },
    {
      name: 'task list (checked)',
      markdown: '- [x] done',
      contains: ['<li class="task-list-item">', 'type="checkbox"', 'checked'],
    },
    {
      name: 'footnote',
      markdown: 'Text[^1]\n\n[^1]: note',
      contains: ['class="footnote-ref"', 'class="footnotes"'],
    },
    { name: 'heading id via attrs', markdown: '# H {#custom}', contains: ['<h1 id="custom">H</h1>'] },
    { name: 'definition list', markdown: 'Term\n: def', contains: ['<dl>', '<dt>', '<dd>'] },
    { name: 'highlight mark', markdown: '==hi==', contains: ['<mark>hi</mark>'] },
    { name: 'subscript', markdown: 'H~2~O', contains: ['<sub>2</sub>'] },
    { name: 'superscript', markdown: 'X^2^', contains: ['<sup>2</sup>'] },
    { name: 'emoji', markdown: ':joy:', contains: ['😂'] },
    { name: 'raw HTML passthrough (html: true)', markdown: '<u>x</u>', contains: ['<u>x</u>'] },
    {
      name: 'fenced code highlighted (js)',
      markdown: '```js\nconst x = 1\n```',
      // markdown-it 15 adds `class="language-js"` (langPrefix); the hljs
      // spans carry the `hljs-` classes.
      contains: ['class="language-js"', 'hljs-keyword'],
    },
    {
      name: 'fenced code with unknown language falls back to escaped text',
      markdown: '```nosuchlang\n<b>raw</b>\n```',
      contains: ['&lt;b&gt;raw&lt;/b&gt;'],
      notContains: ['hljs-'],
    },
  ]

  it.each(cases)('$name', ({ markdown, contains, notContains }) => {
    const html = renderMarkdown(markdown)
    for (const needle of contains) expect(html).toContain(needle)
    for (const needle of notContains ?? []) expect(html).not.toContain(needle)
  })
})

describe('renderMarkdown — underline via __ (E3)', () => {
  it('renders __x__ as <u>x</u> and keeps **y** as <strong>y</strong>', () => {
    const html = renderMarkdown('__x__ and **y**')
    expect(html).toContain('<u>x</u>')
    expect(html).toContain('<strong>y</strong>')
    expect(html).not.toContain('<strong>x</strong>')
  })
})

describe('renderMarkdown — -# subtext paragraphs (Other #5)', () => {
  it('renders "-# note" as <p class="md-subtext">note</p>', () => {
    const html = renderMarkdown('-# note')
    expect(html).toBe('<p class="md-subtext">note</p>\n')
  })

  it('keeps inline formatting inside a subtext paragraph', () => {
    const html = renderMarkdown('-# *em* note')
    expect(html).toBe('<p class="md-subtext"><em>em</em> note</p>\n')
  })

  it('renders a marker with no content as a plain empty paragraph (no class)', () => {
    expect(renderMarkdown('-#')).toBe('<p></p>\n')
    expect(renderMarkdown('-# ')).toBe('<p></p>\n')
  })

  it('leaves ordinary paragraphs untouched', () => {
    const html = renderMarkdown('plain')
    expect(html).toBe('<p>plain</p>\n')
    expect(html).not.toContain('md-subtext')
  })
})

describe('renderMarkdown — task-list shorthand markers (Other #4)', () => {
  const cases: Array<[string, boolean]> = [
    ['-[] task', false],
    ['-[ ] task', false],
    ['-[x] done', true],
    ['-[X] done', true],
  ]

  it.each(cases)('turns %s into a task list item', (markdown, checked) => {
    const html = renderMarkdown(markdown)
    expect(html).toContain('<li class="task-list-item">')
    expect(html).toContain('type="checkbox"')
    if (checked) expect(html).toContain('checked=""')
  })

  it('still supports the standard "- [ ]" marker', () => {
    const html = renderMarkdown('- [ ] task')
    expect(html).toContain('<li class="task-list-item">')
    expect(html).toContain('type="checkbox"')
  })

  it('leaves -[] markers inside fenced code blocks literal', () => {
    const html = renderMarkdown('```\n-[] raw\n```')
    expect(html).toContain('-[] raw')
    expect(html).not.toContain('- [ ] raw')
  })

  it('leaves -[] markers inside indented code blocks literal', () => {
    const html = renderMarkdown('    -[] code')
    expect(html).toContain('-[] code')
    expect(html).not.toContain('<ul')
  })
})

describe('renderMarkdown — security (PLAN §16)', () => {
  it('strips <script> tags', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script')
  })

  it('strips event-handler attributes', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('onerror')
  })

  it('blocks javascript: URLs', () => {
    // markdown-it's validateLink rejects javascript: hrefs outright, so the
    // source renders as plain text with NO anchor element at all.
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).toContain('[x](javascript:alert(1))')
  })
})

describe('renderStandaloneHtml', () => {
  it('produces a complete standalone document with CSP and rendered content', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'My Doc', theme: 'light' })
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('<html lang="en">')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("script-src 'unsafe-inline'")
    expect(doc).toContain('<title>My Doc</title>')
    expect(doc).toContain('<h1>Hi</h1>')
    expect(doc).toContain('main.md-body')
    expect(doc).toContain('.md-code-copy')
  })

  it('escapes the title', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'A & B <C>"\'', theme: 'light' })
    expect(doc).toContain('<title>A &amp; B &lt;C&gt;&quot;&#39;</title>')
  })

  it('does not bake a theme (G2): both hljs variants + prefers-color-scheme, no data-theme', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'T', theme: 'light' })
    // Both hljs theme stylesheets are embedded.
    expect(doc).toContain(HLJS_CSS_LIGHT)
    expect(doc).toContain(HLJS_CSS_DARK)
    // Light tokens are the default :root; dark tokens ride in the media query.
    expect(doc).toContain('--bg: #ffffff')
    expect(doc).toContain('--bg: #1e1e1e')
    // One media query for the theme tokens, one for the hljs themes.
    expect(doc.match(/@media \(prefers-color-scheme: dark\)/g)).toHaveLength(2)
    // No baked theme attribute on <html> and no single-variant selection.
    expect(doc).not.toContain('data-theme')
  })

  it('ignores the theme option — light and dark exports are identical', () => {
    const light = renderStandaloneHtml('# Hi', { title: 'T', theme: 'light' })
    const dark = renderStandaloneHtml('# Hi', { title: 'T', theme: 'dark' })
    expect(dark).toBe(light)
  })
})

describe('lazy language registration (PLAN §17)', () => {
  it('is idempotent — repeated renders produce identical highlighting', () => {
    const src = '```js\nconst x = 1\n```'
    const first = renderMarkdown(src)
    const second = renderMarkdown(src)
    expect(first).toBe(second)
    expect(first).toContain('hljs-keyword')
  })
})

describe('module surface', () => {

  it('MARKDOWN_BODY_CSS is scoped under .md-body and uses theme tokens', () => {
    expect(MARKDOWN_BODY_CSS).toContain('.md-body')
    expect(MARKDOWN_BODY_CSS).toContain('var(--accent)')
    expect(MARKDOWN_BODY_CSS).toContain('var(--code-bg)')
    expect(MARKDOWN_BODY_CSS).toContain('var(--mono)')
  })

  it('escapeHtml escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x" y='z'> & `)).toBe('&lt;a href=&quot;x&quot; y=&#39;z&#39;&gt; &amp; ')
  })

  it('exposes the hljs theme css for the preview pane', () => {
    expect(HLJS_CSS_LIGHT).toContain('.hljs')
    expect(HLJS_CSS_DARK).toContain('.hljs')
  })
})

// ---------------------------------------------------------------------------
// P1 Export HTML fix batch
// ---------------------------------------------------------------------------

const P1_DATA = 'data:image/png;base64,AAA'

/** Mock expose(): records abs paths, resolves to a fixed data URL (or throws). */
function mockExpose(calls: string[] = [], fail = false) {
  return async (abs: string): Promise<string> => {
    calls.push(abs)
    if (fail) throw new Error(`cannot expose ${abs}`)
    return P1_DATA
  }
}

describe('classifyImageSrc (P1 — pure, no FS)', () => {
  const cases: Array<[string, 'inline' | 'skip', string]> = [
    ['pic.png', 'inline', 'local'],
    ['sub/pic.png', 'inline', 'local'],
    ['./pic.png', 'inline', 'local'],
    ['../pic.png', 'inline', 'local'],
    ['my pic.png', 'inline', 'local'],
    ['pic.png?v=2', 'inline', 'local'],
    ['pic.png#frag', 'inline', 'local'],
    ['https://x.dev/a.png', 'skip', 'remote'],
    ['http://x.dev/a.png', 'skip', 'remote'],
    ['HTTPS://x.dev/a.png', 'skip', 'remote'],
    ['data:image/png;base64,AAA', 'skip', 'data-url'],
    ['blob:https://x/y', 'skip', 'blob-url'],
    ['asset://a.png', 'skip', 'asset-url'],
    ['#frag', 'skip', 'fragment'],
    ['/abs/a.png', 'skip', 'absolute'],
    ['\\abs\\a.png', 'skip', 'absolute'],
    ['pic.svg', 'inline', 'local'],
    ['PIC.SVG', 'inline', 'local'],
    ['pic.svg?v=2#t', 'inline', 'local'],
    ['', 'skip', 'empty'],
    ['   ', 'skip', 'empty'],
  ]

  it.each(cases)('classifyImageSrc(%s) → %s (%s)', (src, action, reason) => {
    expect(classifyImageSrc(src)).toEqual({ action, reason })
  })
})

describe('resolveAgainstDocDir hardening (P1 — pure, no FS)', () => {
  const cases: Array<[string, string, string]> = [
    ['/docs/n.md', 'pic.png', '/docs/pic.png'],
    ['C:\\docs\\n.md', 'pic.png', 'C:\\docs\\pic.png'],
    ['/docs/n.md', './pic.png', '/docs/pic.png'],
    ['/docs/sub/n.md', '../pic.png', '/docs/pic.png'],
    ['/docs/n.md', 'sub/../pic.png', '/docs/pic.png'],
    ['/docs/n.md', 'a/./b.png', '/docs/a/b.png'],
    ['/docs/n.md', 'pic.png?v=2', '/docs/pic.png'],
    ['/docs/n.md', 'pic.png#frag', '/docs/pic.png'],
    ['/docs/n.md', 'pic.png?v=2#frag', '/docs/pic.png'],
    ['/docs/n.md', 'my%20pic.png', '/docs/my pic.png'],
    ['/docs/n.md', '100%.png', '/docs/100%.png'],
    // Separator flavor follows the doc path, even for mixed-separator srcs.
    ['C:\\docs\\n.md', 'sub/pic.png', 'C:\\docs\\sub\\pic.png'],
    ['/docs/n.md', '.\\pic.png', '/docs/pic.png'],
    ['/docs/n.md', 'sub\\..\\pic.png', '/docs/pic.png'],
  ]

  it.each(cases)('resolveAgainstDocDir(%s, %s) → %s', (docPath, rel, expected) => {
    expect(resolveAgainstDocDir(docPath, rel)).toBe(expected)
  })
})

describe('normalizeRelSrc (P1 — pure, no FS)', () => {
  const cases: Array<[string, string]> = [
    ['pic.png?v=2#t', 'pic.png'],
    ['my%20pic.png', 'my pic.png'],
    ['sub/../pic.png', 'pic.png'],
    ['./pic.png', 'pic.png'],
    ['a/./b.png', 'a/b.png'],
    ['100%.png', '100%.png'],
    ['sub\\..\\pic.png', 'pic.png'],
  ]

  it.each(cases)('normalizeRelSrc(%s) → %s', (src, expected) => {
    expect(normalizeRelSrc(src)).toBe(expected)
  })
})

describe('inlineMarkdownImages — inline syntax + titles (P1)', () => {
  it('returns the input unchanged when docPath is null (expose never called)', async () => {
    const calls: string[] = []
    const md = '![a](pic.png)'
    expect(await inlineMarkdownImages(md, null, mockExpose(calls))).toBe(md)
    expect(calls).toEqual([])
  })

  it('inlines a basic relative image', async () => {
    const calls: string[] = []
    const out = await inlineMarkdownImages('![a](pic.png)', '/docs/n.md', mockExpose(calls))
    expect(out).toBe(`![a](${P1_DATA})`)
    expect(calls).toEqual(['/docs/pic.png'])
  })

  it('preserves a title after the src', async () => {
    const out = await inlineMarkdownImages('![a](pic.png "t")', '/docs/n.md', mockExpose())
    expect(out).toBe(`![a](${P1_DATA} "t")`)
  })

  it('handles angle-bracket srcs with spaces plus a title', async () => {
    const calls: string[] = []
    const out = await inlineMarkdownImages('![a](<my pic.png> "t")', '/docs/n.md', mockExpose(calls))
    expect(out).toBe(`![a](${P1_DATA} "t")`)
    expect(calls).toEqual(['/docs/my pic.png'])
  })

  it('handles a closing paren inside a quoted title', async () => {
    const out = await inlineMarkdownImages('![a](pic.png "t(x)")', '/docs/n.md', mockExpose())
    expect(out).toBe(`![a](${P1_DATA} "t(x)")`)
  })

  it('dedupes expose() calls by RESOLVED abs path, not raw string', async () => {
    const calls: string[] = []
    const out = await inlineMarkdownImages(
      '![a](./pic.png) and ![b](pic.png)',
      '/docs/n.md',
      mockExpose(calls),
    )
    expect(calls).toEqual(['/docs/pic.png'])
    expect(out).toBe(`![a](${P1_DATA}) and ![b](${P1_DATA})`)
  })

  it('strips query/fragment and decodes %20 before resolving', async () => {
    const calls: string[] = []
    const out = await inlineMarkdownImages(
      '![a](pic.png?v=2) ![b](my%20pic.png) ![c](sub/../other.png#x)',
      '/docs/n.md',
      mockExpose(calls),
    )
    expect(calls).toEqual(['/docs/pic.png', '/docs/my pic.png', '/docs/other.png'])
    expect(out).not.toContain('pic.png?v=2')
  })

  it('resolves ../ against the doc directory', async () => {
    const calls: string[] = []
    await inlineMarkdownImages('![a](../pic.png)', '/docs/sub/n.md', mockExpose(calls))
    expect(calls).toEqual(['/docs/pic.png'])
  })

  it('leaves skip-by-design srcs alone and reports reasons', async () => {
    const calls: string[] = []
    const md = '![r](https://x.dev/y.png) ![t](/a.png) ![d](data:image/png;base64,AAA)'
    const res = await inlineMarkdownImagesDetailed(md, '/docs/n.md', mockExpose(calls))
    expect(res.markdown).toBe(md)
    expect(res.inlined).toEqual([])
    expect(res.skipped).toEqual([
      { src: 'https://x.dev/y.png', reason: 'remote' },
      { src: '/a.png', reason: 'absolute' },
      { src: 'data:image/png;base64,AAA', reason: 'data-url' },
    ])
    expect(calls).toEqual([])
  })

  it('embeds svg as a sanitized data: URL (round-6 A1)', async () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>'
    const evilB64 = Buffer.from(evil, 'utf-8').toString('base64')
    const calls: string[] = []
    const res = await inlineMarkdownImagesDetailed('![s](pic.svg)', '/docs/n.md', async (abs) => {
      calls.push(abs)
      return `data:image/svg+xml;base64,${evilB64}`
    })
    expect(calls).toEqual(['/docs/pic.svg'])
    expect(res.inlined).toEqual(['pic.svg'])
    const embedded = res.markdown
    expect(embedded).toContain('data:image/svg+xml;base64,')
    // The payload round-trips without scripts or event handlers.
    const payload = Buffer.from(embedded.split(',')[1], 'base64').toString('utf-8')
    expect(payload).not.toContain('<script')
    expect(payload).toContain('<circle')
  })

  it('reports expose failures with reason expose-failed and keeps the raw src', async () => {
    const res = await inlineMarkdownImagesDetailed('![a](pic.png)', '/docs/n.md', mockExpose([], true))
    expect(res.markdown).toBe('![a](pic.png)')
    expect(res.inlined).toEqual([])
    expect(res.skipped).toEqual([{ src: 'pic.png', reason: 'expose-failed' }])
  })
})

describe('inlineMarkdownImages — raw HTML <img> (P1)', () => {
  it('replaces only the src value, preserving all other attributes', async () => {
    const out = await inlineMarkdownImages(
      '<img alt="a" src="pic.png" width="10">',
      '/docs/n.md',
      mockExpose(),
    )
    expect(out).toBe(`<img alt="a" src="${P1_DATA}" width="10">`)
  })

  it('handles single-quoted src', async () => {
    const out = await inlineMarkdownImages(
      "<img src='pic.png' alt='a'>",
      '/docs/n.md',
      mockExpose(),
    )
    expect(out).toBe(`<img src='${P1_DATA}' alt='a'>`)
  })

  it('handles unquoted src', async () => {
    const out = await inlineMarkdownImages('<img src=pic.png alt=a>', '/docs/n.md', mockExpose())
    expect(out).toBe(`<img src="${P1_DATA}" alt=a>`)
  })

  it('skips remote html-img srcs but embeds svg', async () => {
    const calls: string[] = []
    const md = '<img src="https://x.dev/y.png"> <img src="pic.svg">'
    const out = await inlineMarkdownImages(md, '/docs/n.md', mockExpose(calls))
    expect(out).toContain('src="https://x.dev/y.png"')
    expect(out).toContain(`src="${P1_DATA}"`)
    expect(calls).toEqual(['/docs/pic.svg'])
  })
})

describe('inlineMarkdownImages — reference-style images (P1)', () => {
  it('inlines the definition target and leaves the markdown structure intact', async () => {
    const calls: string[] = []
    const res = await inlineMarkdownImagesDetailed(
      '![alt][logo]\n\n[logo]: pic.png "Title"',
      '/docs/n.md',
      mockExpose(calls),
    )
    expect(res.markdown).toBe(`![alt][logo]\n\n[logo]: ${P1_DATA} "Title"`)
    expect(res.inlined).toEqual(['pic.png'])
    expect(calls).toEqual(['/docs/pic.png'])
  })

  it('matches labels case-insensitively and handles angle-bracket targets', async () => {
    const calls: string[] = []
    const res = await inlineMarkdownImagesDetailed(
      '![Alt][LOGO]\n\n[logo]: <my pic.png>',
      '/docs/n.md',
      mockExpose(calls),
    )
    expect(res.markdown).toBe(`![Alt][LOGO]\n\n[logo]: ${P1_DATA}`)
    expect(calls).toEqual(['/docs/my pic.png'])
  })

  it('does not touch definitions that no image references', async () => {
    const calls: string[] = []
    const md = '[text][ref]\n\n[ref]: pic.png'
    const res = await inlineMarkdownImagesDetailed(md, '/docs/n.md', mockExpose(calls))
    expect(res.markdown).toBe(md)
    expect(res.inlined).toEqual([])
    expect(calls).toEqual([])
  })

  it('shares one expose() call between inline and ref syntax for the same file', async () => {
    const calls: string[] = []
    const res = await inlineMarkdownImagesDetailed(
      '![a](./pic.png)\n\n![b][r]\n\n[r]: pic.png',
      '/docs/n.md',
      mockExpose(calls),
    )
    expect(calls).toEqual(['/docs/pic.png'])
    expect(res.inlined).toEqual(['./pic.png', 'pic.png'])
  })
})

describe('renderStandaloneHtml — P1 export fixes', () => {
  it('includes a color-scheme meta for light/dark', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'T', theme: 'light' })
    expect(doc).toContain('<meta name="color-scheme" content="light dark">')
  })

  it('adds print CSS (white bg, black text, hidden copy buttons)', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'T', theme: 'light' })
    expect(doc).toContain('@media print')
    expect(doc).toContain('.md-code-copy { display: none; }')
  })

  it('does not force images to full width (max-width only, small icons stay small)', () => {
    const m = MARKDOWN_BODY_CSS.match(/\.md-body img \{[^}]*\}/)
    expect(m).not.toBeNull()
    const rule = m![0]
    expect(rule).toContain('max-width: 100%')
    expect(rule).toContain('height: auto')
    const hasBareWidth = rule
      .split('\n')
      .some((line) => line.trim().startsWith('width:'))
    expect(hasBareWidth).toBe(false)
  })

  it('copies via navigator.clipboard with an execCommand fallback', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'T', theme: 'light' })
    expect(doc).toContain('navigator.clipboard.writeText')
    expect(doc).toContain('execCommand')
  })

  it('keeps the data-code attribute and inline svg through DOMPurify', () => {
    const html = renderMarkdown('```js\nconst x = 1\n```')
    expect(html).toContain('data-code')
    expect(html).toContain('<svg')
  })

  it('renders ||spoiler|| spans (round-6 A6/B2 — core preprocessing)', () => {
    expect(renderMarkdown('||spoiler||')).toBe(
      '<p><span class="md-spoiler" data-revealed="false">spoiler</span></p>\n',
    )
    expect(renderMarkdown('|| Spoiler ||')).toContain('md-spoiler')
    expect(renderMarkdown('a ||b|| c')).toContain('>b</span>')
    expect(renderMarkdown('**b** ||s||')).toContain('</strong> <span class="md-spoiler"')
    // Inner markdown still parses; headings and blockquotes work too.
    expect(renderMarkdown('||*em*||')).toContain('<em>em</em></span>')
    expect(renderMarkdown('# ||h||')).toContain('<h1><span class="md-spoiler"')
    expect(renderMarkdown('> ||q||')).toContain('md-spoiler')
    expect(renderMarkdown('||a|| ||b||').match(/md-spoiler/g)).toHaveLength(2)
  })

  it('leaves non-spoiler pipes literal', () => {
    expect(renderMarkdown('`||code||`')).toContain('<code>||code||</code>')
    expect(renderMarkdown('```\n||code||\n```')).toContain('||code||\n</code>')
    expect(renderMarkdown('||||')).toBe('<p>||||</p>\n')
    expect(renderMarkdown('||||x||')).toBe('<p>||||x||</p>\n')
    expect(renderMarkdown('||a||b||')).toContain('</span>b||')
    // Table-row-like lines are skipped so cell delimiters never corrupt.
    expect(applySpoilerSpansToLine('| ||x|| |')).toBe('| ||x|| |')
    expect(applySpoilerSpansToLine('||x||')).toContain('md-spoiler')
    // Code spans protect their contents; outer pairs still match around them.
    expect(renderMarkdown('||a `||` b||')).toContain('<code>||</code>')
  })

  it('requires a blank line before reference definitions (CommonMark)', async () => {
    // A definition cannot interrupt a paragraph — without the blank line both
    // lines stay literal text (GitHub renders the same). The inliner still
    // rewrites the target, so the stranded data URL is the tell-tale.
    const doc = await renderStandaloneHtmlWithImages(
      '![ref][r]\n[r]: pic.png',
      { title: 'T', theme: 'light' },
      '/docs/n.md',
      mockExpose(),
    )
    expect(doc).toContain('![ref][r]')
    const blank = await renderStandaloneHtmlWithImages(
      '![ref][r]\n\n[r]: pic.png',
      { title: 'T', theme: 'light' },
      '/docs/n.md',
      mockExpose(),
    )
    expect(blank).toContain(`src="${P1_DATA}"`)
  })

  it('tolerates CRLF line endings in ref-defs, dropdowns and fences', async () => {
    const calls: string[] = []
    const inlined = await inlineMarkdownImagesDetailed(
      '![ref][r]\r\n\r\n[r]: pic.png\r\n',
      '/docs/n.md',
      mockExpose(calls),
    )
    expect(inlined.inlined).toEqual(['pic.png'])
    expect(inlined.markdown).toContain(P1_DATA)
    expect(renderMarkdown('>>> Title\r\nbody\r\n>>>\r\n')).toContain('md-dropdown')
    // Fences still protect code in CRLF docs; spoilers work after them.
    const fenced = renderMarkdown('```\r\n||x||\r\n```\r\n\nafter ||s|| end')
    expect(fenced).toContain('||x||\n</code>')
    expect(fenced).toContain('md-spoiler')
  })

  it('end-to-end: raster and svg images embed as data: URLs', async () => {
    const calls: string[] = []
    const doc = await renderStandaloneHtmlWithImages(
      '![a](pic.png)\n\n![s](pic.svg)',
      { title: 'T', theme: 'light' },
      '/docs/n.md',
      mockExpose(calls),
    )
    expect(doc).toContain(`src="${P1_DATA}"`)
    expect(doc).not.toContain('src="pic.svg"')
    expect(calls).toEqual(['/docs/pic.png', '/docs/pic.svg'])
  })
})

// ---------------------------------------------------------------------------
// Round-9 unified export — pure export core (txt/html/pdf/docx/rtf)
// ---------------------------------------------------------------------------

describe('EXPORT_FORMATS + exportLossSummaryFor (round-9 unified export)', () => {
  it('offers txt/html/pdf/docx/rtf in order', () => {
    expect(EXPORT_FORMATS).toEqual(['txt', 'html', 'pdf', 'docx', 'rtf'])
  })

  it('txt is verbatim source (no losses)', () => {
    expect(exportLossSummaryFor('txt')).toEqual([])
  })

  it('html lists 1-2 image-embedding bullets', () => {
    const bullets = exportLossSummaryFor('html')
    expect(bullets.length).toBeGreaterThan(0)
    expect(bullets.length).toBeLessThanOrEqual(2)
    expect(bullets.join(' ')).toMatch(/image/i)
  })

  it('pdf notes the print stylesheet and TEXT (re-importable) output', () => {
    const bullets = exportLossSummaryFor('pdf')
    expect(bullets).toHaveLength(2)
    expect(bullets.join(' ')).toMatch(/print/i)
    expect(bullets.join(' ')).toMatch(/TEXT/)
  })

  it('docx/rtf stay honest and short (images dropped, layout lost)', () => {
    for (const fmt of ['docx', 'rtf'] as const) {
      const bullets = exportLossSummaryFor(fmt)
      expect(bullets.length).toBeGreaterThan(0)
      expect(bullets.length).toBeLessThanOrEqual(6)
      const all = bullets.join(' ')
      expect(all).toMatch(/[Ii]mages are dropped/)
      expect(all).toMatch(/layout/)
    }
  })
})

describe('markdownToRtf (round-9 unified export)', () => {
  it('starts with {\\rtf1 and renders bold with \\b markers', () => {
    const rtf = markdownToRtf('Hello **bold**')
    expect(rtf.startsWith('{\\rtf1')).toBe(true)
    expect(rtf).toContain('\\b bold\\b0')
  })

  it('renders highlight and strikethrough control words', () => {
    expect(markdownToRtf('==x==')).toContain('\\highlight7')
    expect(markdownToRtf('==x==')).toContain('x')
    expect(markdownToRtf('~~x~~')).toContain('\\strike')
  })

  it('stays 7-bit ASCII (unicode becomes hex/\\u escapes)', () => {
    const rtf = markdownToRtf('- [ ] caf\u00e9 \u2610 \u4e2d')
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(rtf)).toBe(true)
    expect(rtf).toContain("\\'e9")
  })

  it('maps task checkboxes to ballot-box escapes and flattens tables', () => {
    expect(markdownToRtf('- [ ] todo')).toContain('\\u9744?')
    expect(markdownToRtf('- [x] done')).toContain('\\u9746?')
    expect(markdownToRtf('| a | b |\n|---|---|\n| 1 | 2 |')).toContain(' | ')
  })

  it('flattens links/images to text (alt kept, url in parens)', () => {
    const rtf = markdownToRtf('[t](https://a.dev) and ![alt](i.png)')
    expect(rtf).toContain('t (https://a.dev)')
    expect(rtf).toContain('alt')
    expect(rtf).not.toContain('![alt]')
  })
})

describe('markdownToDocxBytes (round-9 unified export)', () => {
  /** Decode raw zip bytes as latin1 so ASCII spans (names + XML) survive. */
  function latin1(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('latin1')
  }

  it('starts with the PK zip signature and embeds document.xml', () => {
    const bytes = markdownToDocxBytes('# Title\n\nHello **bold**')
    expect(bytes[0]).toBe(0x50) // P
    expect(bytes[1]).toBe(0x4b) // K
    expect(bytes[2]).toBe(0x03)
    expect(bytes[3]).toBe(0x04)
    const text = latin1(bytes)
    expect(text).toContain('word/document.xml')
    expect(text).toContain('w:val="Heading1"')
    expect(text).toContain('Title')
    expect(text).toContain('bold')
  })

  it('keeps literal list prefixes and flattened tables (round-trip words)', () => {
    const text = latin1(markdownToDocxBytes('- item\n\n1. first\n\n| a | b |\n|---|---|\n| 1 | 2 |'))
    expect(text).toContain('- item')
    expect(text).toContain('1. first')
    expect(text).toContain('a')
  })
})