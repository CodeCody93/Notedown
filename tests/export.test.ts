// @vitest-environment jsdom
// M4 Packet 1 — shared markdown-it render pipeline (src/app/export.ts).
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
import { HLJS_CSS_LIGHT } from '../src/styles/hljs-themes'

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
    expect(doc).toContain('<html lang="en" data-theme="light">')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain('<title>My Doc</title>')
    expect(doc).toContain('<h1>Hi</h1>')
    expect(doc).toContain('main.md-body')
    expect(doc).not.toContain('<script')
  })

  it('escapes the title', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'A & B <C>"\'', theme: 'light' })
    expect(doc).toContain('<title>A &amp; B &lt;C&gt;&quot;&#39;</title>')
  })

  it('light theme embeds the light hljs stylesheet only', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'T', theme: 'light' })
    expect(doc).toContain(HLJS_CSS_LIGHT)
    expect(doc).not.toContain(HLJS_CSS_DARK)
  })

  it('dark theme embeds the dark hljs stylesheet only', () => {
    const doc = renderStandaloneHtml('# Hi', { title: 'T', theme: 'dark' })
    expect(doc).toContain(HLJS_CSS_DARK)
    expect(doc).not.toContain(HLJS_CSS_LIGHT)
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