/**
 * MarkItDown — shared markdown rendering pipeline (PLAN §6B, §14, §16, §17).
 *
 * ONE markdown-it instance with the full cheat-sheet plugin set (§6B table),
 * a lazy-registered highlight.js language set (§17) and DOMPurify
 * sanitization on EVERY render (§16 — `html: true` allows raw HTML, so no
 * output may be injected into the preview pane or an export document without
 * passing through DOMPurify first).
 *
 * Both consumers share this module:
 *  - Preview mode injects `renderMarkdown()` output into a scrollable pane;
 *  - Export wraps the same output in a standalone HTML document
 *    (`renderStandaloneHtml`), styled with the same `MARKDOWN_BODY_CSS` so
 *    preview and export look identical.
 *
 * This module must stay DOM-window-free EXCEPT for DOMPurify (which requires
 * a window — it only ever runs inside a browser/Tauri webview or jsdom tests).
 */
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import footnote from 'markdown-it-footnote'
import attrs from 'markdown-it-attrs'
import deflist from 'markdown-it-deflist'
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import { full as emoji } from 'markdown-it-emoji'
import hljs from 'highlight.js/lib/core'
import markdownLang from 'highlight.js/lib/languages/markdown'
import javascriptLang from 'highlight.js/lib/languages/javascript'
import typescriptLang from 'highlight.js/lib/languages/typescript'
import pythonLang from 'highlight.js/lib/languages/python'
import bashLang from 'highlight.js/lib/languages/bash'
import jsonLang from 'highlight.js/lib/languages/json'
import yamlLang from 'highlight.js/lib/languages/yaml'
import htmlLang from 'highlight.js/lib/languages/xml' // hljs calls the language "xml" but its aliases include "html"
import cssLang from 'highlight.js/lib/languages/css'
import rustLang from 'highlight.js/lib/languages/rust'
import sqlLang from 'highlight.js/lib/languages/sql'
import plaintextLang from 'highlight.js/lib/languages/plaintext'
import DOMPurify from 'dompurify'
import { HLJS_CSS_DARK, HLJS_CSS_LIGHT } from '../styles/hljs-themes'

// Re-exported for the preview pane (a separate module): the preview injects the
// same stylesheets into its own <style> element so preview and export match.
export { HLJS_CSS_DARK, HLJS_CSS_LIGHT }

let languagesRegistered = false

/**
 * Register the highlight.js language set from PLAN §17 lazily (once, on
 * first use) so the bundle stays small. Idempotent — safe to call again.
 *
 * The "xml" module is registered under its own name; its aliases include
 * "html", so ```html fences resolve through `hljs.getLanguage('html')`.
 */
export function registerLanguages(): void {
  if (languagesRegistered) return
  languagesRegistered = true
  hljs.registerLanguage('markdown', markdownLang)
  hljs.registerLanguage('javascript', javascriptLang)
  hljs.registerLanguage('typescript', typescriptLang)
  hljs.registerLanguage('python', pythonLang)
  hljs.registerLanguage('bash', bashLang)
  hljs.registerLanguage('json', jsonLang)
  hljs.registerLanguage('yaml', yamlLang)
  hljs.registerLanguage('xml', htmlLang)
  hljs.registerLanguage('css', cssLang)
  hljs.registerLanguage('rust', rustLang)
  hljs.registerLanguage('sql', sqlLang)
  hljs.registerLanguage('plaintext', plaintextLang)
}

// Register at module load — cheap and idempotent.
registerLanguages()

/**
 * The single shared markdown-it instance (PLAN §6B). `html: true` enables
 * raw HTML passthrough; the `highlight` callback returns '' for unknown or
 * empty languages so markdown-it falls back to its default escaped `<code>`
 * output (hljs resolves aliases like "ts" automatically).
 */
const md = new MarkdownIt({
  html: true,
  highlight: (code: string, lang: string) => {
    if (lang === '' || !hljs.getLanguage(lang)) return ''
    try {
      return hljs.highlight(code, { language: lang }).value
    } catch {
      return ''
    }
  },
})

// Plugin order matters: task lists first (rewrites list-item tokens), then
// block-level (footnote, attrs, deflist), then inline (mark, sub, sup, emoji).
md.use(taskLists, { label: true, labelAfter: true })
md.use(footnote)
md.use(attrs)
md.use(deflist)
md.use(mark)
md.use(sub)
md.use(sup)
md.use(emoji)

/**
 * Render markdown to sanitized HTML.
 *
 * SECURITY (PLAN §16): `html: true` is on, so raw HTML in the document would
 * reach the DOM untouched. EVERY render therefore passes through DOMPurify
 * before being injected into the preview pane or an export document.
 */
export function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(md.render(markdown))
}

/**
 * Typographic stylesheet for the `.md-body` container. Used VERBATIM by both
 * the preview pane and the standalone export document so they look identical.
 * All colors come from the app theme tokens (src/styles/theme.css); the
 * standalone export defines those tokens in its own `:root` block.
 */
export const MARKDOWN_BODY_CSS: string = `
.md-body {
  font-size: 15px;
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
  overflow-wrap: break-word;
}

.md-body h1,
.md-body h2,
.md-body h3,
.md-body h4,
.md-body h5,
.md-body h6 {
  margin: 1.4em 0 0.6em;
  line-height: 1.25;
  font-weight: 600;
}

.md-body h1 {
  font-size: 2em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}

.md-body h2 {
  font-size: 1.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}

.md-body h3 { font-size: 1.25em; }
.md-body h4 { font-size: 1.1em; }
.md-body h5 { font-size: 1em; }
.md-body h6 {
  font-size: 0.875em;
  color: var(--muted);
}

.md-body p { margin: 0.6em 0; }

.md-body ul,
.md-body ol {
  margin: 0.6em 0;
  padding-left: 1.6em;
}

.md-body li { margin: 0.2em 0; }

.md-body blockquote {
  margin: 0.8em 0;
  padding: 0.4em 1em;
  border-left: 3px solid var(--accent);
  background: var(--surface);
  color: var(--muted);
}

.md-body code {
  font-family: var(--mono);
  font-size: 0.9em;
  background: var(--code-bg);
  padding: 0.15em 0.35em;
  border-radius: 4px;
}

.md-body pre {
  background: var(--code-bg);
  padding: 0.8em 1em;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.8em 0;
}

.md-body pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 0.9em;
}

/* highlight.js needs block display + horizontal scroll inside markdown-it's
   <pre><code class="language-x"> wrapper. markdown-it 15 no longer adds the
   hljs class itself, so match both hljs-style and language-* codes. */
.md-body pre code.hljs,
.md-body pre code[class*="language-"] {
  display: block;
  overflow-x: auto;
}

.md-body table {
  border-collapse: collapse;
  margin: 0.8em 0;
}

.md-body th,
.md-body td {
  border: 1px solid var(--border);
  padding: 0.4em 0.8em;
}

.md-body th {
  background: var(--surface);
  font-weight: 600;
}

.md-body img {
  max-width: 100%;
}

.md-body hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5em 0;
}

.md-body a {
  color: var(--accent);
  text-decoration: none;
}

.md-body a:hover {
  text-decoration: underline;
}

.md-body mark {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text);
  border-radius: 2px;
  padding: 0 0.15em;
}

.md-body sub,
.md-body sup {
  font-size: 0.75em;
  line-height: 0;
}

.md-body dl { margin: 0.8em 0; }

.md-body dt { font-weight: 600; }

.md-body dd {
  margin: 0.2em 0 0.6em 1.6em;
}

.md-body .task-list-item {
  list-style: none;
}

.md-body .task-list-item-checkbox {
  margin-right: 0.5em;
  vertical-align: middle;
  accent-color: var(--accent);
}

.md-body .task-list-item-label {
  color: var(--muted);
}

.md-body .footnote-ref {
  font-size: 0.75em;
  vertical-align: super;
  line-height: 0;
}

.md-body .footnote-ref a,
.md-body .footnote-ref a:hover {
  color: var(--accent);
  text-decoration: none;
}

.md-body .footnote-backref {
  text-decoration: none;
}

.md-body .footnotes {
  font-size: 0.85em;
  color: var(--muted);
  margin-top: 2em;
  padding-top: 0.6em;
  border-top: 1px solid var(--border);
}

/* The plugin emits <hr class="footnotes-sep"> before the section; the
   border-top on .footnotes replaces it. */
.md-body .footnotes-sep {
  display: none;
}
`

/**
 * Theme tokens for the standalone export document. The export has no
 * <link rel="stylesheet"> to the app's theme.css, so its :root must define
 * the tokens itself. Mirror of src/styles/theme.css — keep in sync when
 * tokens change. `--mono` is included in both blocks because the dark block
 * in theme.css inherits it from the light/:root block.
 */
const THEME_TOKENS: Record<'dark' | 'light', string> = {
  light: `:root {
  color-scheme: light;
  --bg: #ffffff;
  --surface: #f8f8f6;
  --surface-2: #ececea;
  --text: #1f2328;
  --muted: #6b7280;
  --accent: #2563eb;
  --border: #e3e3df;
  --code-bg: #f3f3f1;
  --ghost: rgba(0, 0, 0, 0.55);
  --selection: rgba(37, 99, 235, 0.22);
  --shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  --menu-radius: 8px;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
`,
  dark: `:root {
  color-scheme: dark;
  --bg: #1e1e1e;
  --surface: #252526;
  --surface-2: #2d2d31;
  --text: #e8e8e8;
  --muted: #9a9a9a;
  --accent: #4f8cff;
  --border: #3c3c3c;
  --code-bg: #2a2a2d;
  --ghost: rgba(255, 255, 255, 0.55);
  --selection: rgba(79, 140, 255, 0.32);
  --shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  --menu-radius: 8px;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
`,
}

/** Options for {@link renderStandaloneHtml}. */
export interface StandaloneHtmlOptions {
  /** Document title — HTML-escaped into `<title>`; may be a filename. */
  title: string
  /** Which theme token set + hljs stylesheet the document should use. */
  theme: 'dark' | 'light'
}

/**
 * Escape the five HTML-significant characters (`& < > " '`) for text
 * positions (titles, attributes). Also used by other M4 packets.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Wrap `renderMarkdown()` output in a complete standalone HTML document.
 *
 * The document is self-contained: theme tokens (:root), the shared
 * `.md-body` stylesheet, the hljs theme CSS for the requested theme, and a
 * CSP meta that permits no scripts and no remote resources
 * (`default-src 'none'`; inline styles for the theme, `data:`/`blob:` images
 * only) — rendered output is sanitized by DOMPurify inside renderMarkdown,
 * and the CSP is the second layer of defense.
 */
export function renderStandaloneHtml(markdown: string, opts: StandaloneHtmlOptions): string {
  const body = renderMarkdown(markdown)
  const hljsCss = opts.theme === 'dark' ? HLJS_CSS_DARK : HLJS_CSS_LIGHT
  return [
    '<!doctype html>',
    `<html lang="en" data-theme="${opts.theme}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(opts.title)}</title>`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:">`,
    `<style>${THEME_TOKENS[opts.theme]}${MARKDOWN_BODY_CSS}${hljsCss}` +
      'body { margin: 0; background: var(--bg); color: var(--text); }\n' +
      'main.md-body { padding: 32px 40px; max-width: 860px; margin: 0 auto; }\n' +
      '</style>',
    '</head>',
    `<body><main class="md-body">${body}</main></body>`,
    '</html>',
  ].join('\n')
}