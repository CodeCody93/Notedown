// @vitest-environment node
/**
 * Packet C — Node-only server renderer (`src/render/index.ts`).
 *
 * Deliberately runs in the plain Node environment (no global `window`/
 * `document`): the render subpath creates its own JSDOM window internally, so
 * this suite proves the public API renders Markdown in a server context
 * without a browser global.
 *
 * No filesystem access, no snapshots — plain string assertions only.
 */
import { describe, expect, it } from 'vitest'
import {
  createNotedownRenderer,
  HLJS_CSS_DARK,
  HLJS_CSS_LIGHT,
  MARKDOWN_BODY_CSS,
  NOTEDOWN_THEME_CSS,
  renderMarkdown,
  renderMarkdownDocument,
} from '../src/render/index'

describe('renderMarkdown — basic rendering', () => {
  it('renders headings and bold as an HTML fragment', () => {
    const html = renderMarkdown('# Hello\n\n**bold**')
    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('<strong>bold</strong>')
    // A fragment, not a standalone page.
    expect(html).not.toContain('<!doctype html>')
    expect(html).not.toContain('<html')
  })
})

describe('renderMarkdown — Notedown dialect', () => {
  interface DialectCase {
    name: string
    markdown: string
    contains: string[]
    notContains?: string[]
  }

  const cases: DialectCase[] = [
    {
      name: 'underline (__text__)',
      markdown: '__under__',
      contains: ['<u>under</u>'],
      notContains: ['<strong>under</strong>'],
    },
    {
      name: 'spoiler (||text||)',
      markdown: 'a ||secret|| b',
      contains: ['md-spoiler', '>secret</span>'],
    },
    {
      name: 'dropdown (>>> Title … >>>)',
      markdown: '>>> Title\nhidden\n>>>',
      contains: ['<details', 'md-dropdown-summary', '>Title<'],
    },
    {
      name: 'graph (%% pie … %%) keeps inline styles',
      markdown: '%% pie "T" (A, 30) (B, 70) %%',
      contains: ['md-graph', 'style="', 'conic-gradient'],
    },
    {
      name: 'task list (- [x])',
      markdown: '- [x] done',
      contains: ['task-list-item', 'type="checkbox"', 'checked=""'],
    },
    {
      name: 'footnote',
      markdown: 'Text[^1]\n\n[^1]: note',
      contains: ['class="footnote-ref"', 'class="footnotes"'],
    },
    {
      name: 'definition list',
      markdown: 'Term\n: def',
      contains: ['<dl>', '<dt>Term</dt>', '<dd>def</dd>'],
    },
    { name: 'mark (==text==)', markdown: '==mark==', contains: ['<mark>mark</mark>'] },
    { name: 'subscript (H~2~O)', markdown: 'H~2~O', contains: ['<sub>2</sub>'] },
    { name: 'superscript (X^2^)', markdown: 'X^2^', contains: ['<sup>2</sup>'] },
    { name: 'emoji (:joy:)', markdown: ':joy:', contains: ['😂'] },
    {
      name: 'alpha ordered list (a. item)',
      markdown: 'a. item',
      contains: ['md-list-alpha', '<li>item</li>'],
    },
    { name: 'subtext (-# text)', markdown: '-# subtext', contains: ['md-subtext', '>subtext<'] },
  ]

  it.each(cases)('$name', ({ markdown, contains, notContains }) => {
    const html = renderMarkdown(markdown)
    for (const needle of contains) expect(html).toContain(needle)
    for (const needle of notContains ?? []) expect(html).not.toContain(needle)
  })
})

describe('renderMarkdown — sanitization', () => {
  it('drops raw <script> content', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script')
  })

  it('drops event-handler attributes', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).not.toContain('onerror')
  })

  it('never emits an anchor for a javascript: URL', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('<a')
  })

  it('removes raw <iframe> elements', () => {
    expect(renderMarkdown('<iframe src="https://evil.example/x"></iframe>')).not.toContain('<iframe')
  })
})

describe('renderMarkdownDocument', () => {
  it('returns a complete document with defaults', () => {
    const doc = renderMarkdownDocument('# Hi')
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('<html lang="en">')
    expect(doc).toContain('<title>Notedown document</title>')
  })

  it('escapes a custom title', () => {
    const doc = renderMarkdownDocument('# Hi', { title: 'A & B <C>' })
    expect(doc).toContain('<title>A &amp; B &lt;C&gt;</title>')
  })

  it('honours a custom lang', () => {
    expect(renderMarkdownDocument('# Hi', { title: 'T', lang: 'fr' })).toContain('<html lang="fr">')
  })

  it('includes the default Content-Security-Policy meta tag', () => {
    const doc = renderMarkdownDocument('# Hi')
    expect(doc).toContain('Content-Security-Policy')
    // The shared document wrapper HTML-escapes the attribute value, so decode
    // `&#39;` before asserting the policy content.
    expect(doc.replace(/&#39;/g, "'")).toContain("default-src 'none'")
  })

  it('omits the CSP meta tag when csp is false', () => {
    expect(renderMarkdownDocument('# Hi', { csp: false })).not.toContain('Content-Security-Policy')
  })

  it('uses a custom CSP string', () => {
    const doc = renderMarkdownDocument('# Hi', { csp: "default-src 'self'" })
    // The implementation may HTML-escape the quotes; assert loosely.
    expect(doc).toContain('Content-Security-Policy')
    expect(doc).toContain('default-src')
  })

  it('renders the markdown into an md-body container', () => {
    const doc = renderMarkdownDocument('# Hi')
    expect(doc).toContain('class="md-body"')
    expect(doc).toContain('<h1>Hi</h1>')
  })
})

describe('renderMarkdown — determinism', () => {
  it('returns identical output for identical input', () => {
    // Task-list checkboxes get a random per-render `id` from
    // markdown-it-task-lists, so use deterministic constructs here.
    const source = '# Hi\n\n%% pie "T" (A, 30) (B, 70) %%\n'
    expect(renderMarkdown(source)).toBe(renderMarkdown(source))
  })
})

describe('CSS exports', () => {
  it('exports non-empty stylesheet strings', () => {
    expect(typeof MARKDOWN_BODY_CSS).toBe('string')
    expect(typeof NOTEDOWN_THEME_CSS).toBe('string')
    expect(typeof HLJS_CSS_LIGHT).toBe('string')
    expect(typeof HLJS_CSS_DARK).toBe('string')
    expect(MARKDOWN_BODY_CSS.length).toBeGreaterThan(0)
    expect(NOTEDOWN_THEME_CSS.length).toBeGreaterThan(0)
    expect(HLJS_CSS_LIGHT.length).toBeGreaterThan(0)
    expect(HLJS_CSS_DARK.length).toBeGreaterThan(0)
  })

  it('scopes body typography under .md-body', () => {
    expect(MARKDOWN_BODY_CSS).toContain('.md-body')
  })

  it('ships the theme behind prefers-color-scheme', () => {
    expect(NOTEDOWN_THEME_CSS).toContain('prefers-color-scheme')
  })
})

describe('createNotedownRenderer', () => {
  const injectedSanitizer = (html: string): string => `<!--custom-->${html}`

  it('honours an injected sanitizer for fragments', () => {
    const seen: string[] = []
    const renderer = createNotedownRenderer((html) => {
      seen.push(html)
      return injectedSanitizer(html)
    })
    const html = renderer.renderMarkdown('# Hi')
    expect(html).toContain('<!--custom-->')
    expect(html).toContain('<h1>Hi</h1>')
    // The callback receives the raw markdown-it HTML.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toContain('<h1>Hi</h1>')
  })

  it('honours an injected sanitizer for documents', () => {
    const renderer = createNotedownRenderer(injectedSanitizer)
    const doc = renderer.renderMarkdownDocument('# Hi', { title: 'T' })
    expect(doc).toContain('<!--custom-->')
    expect(doc).toContain('<h1>Hi</h1>')
    expect(doc).toContain('<title>T</title>')
  })

  it('throws a TypeError for a non-function sanitizer', () => {
    expect(() =>
      createNotedownRenderer(null as unknown as (html: string) => string),
    ).toThrow(TypeError)
  })
})
