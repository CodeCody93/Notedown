// @vitest-environment jsdom
// M4 Packet 4 — export fixes: E3 (__ renders <u>), Other #5 (-# subtext
// paragraphs), G2 (standalone export follows system dark mode instead of
// baking a theme), Other #4 (task-list shorthand markers -[] / -[ ] / -[x]).
// DOMPurify needs a window, hence the jsdom environment.
import { describe, it, expect } from 'vitest'
import {
  renderMarkdown,
  renderStandaloneHtml,
  MARKDOWN_BODY_CSS,
  HLJS_CSS_LIGHT,
  HLJS_CSS_DARK,
  escapeHtml,
} from '../src/app/export'

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