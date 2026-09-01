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
import { resolveAgainstDocDir } from './text'

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

// ---------------------------------------------------------------------------
// Spoiler inline plugin — `||text||` → <span class="md-spoiler">
// ---------------------------------------------------------------------------

md.inline.ruler.after('emphasis', 'spoiler', (state, silent) => {
  const start = state.pos
  const max = state.posMax
  // Must start with || and have at least one char before closing ||
  if (start + 2 >= max) return false
  if (state.src.charCodeAt(start) !== 0x7c /* | */ || state.src.charCodeAt(start + 1) !== 0x7c) return false

  // Scan for closing || (not at the same position)
  let pos = start + 2
  while (pos < max) {
    if (state.src.charCodeAt(pos) === 0x7c && pos + 1 < max && state.src.charCodeAt(pos + 1) === 0x7c) {
      // Found closing || — content is between start+2 and pos
      if (pos === start + 2) {
        // Empty content — not a valid spoiler
        pos += 2
        break
      }
      if (!silent) {
        const token_o = state.push('spoiler_open', 'span', 0)
        token_o.markup = '||'
        state.pos = start + 2
        state.md.inline.tokenize(state)
        state.pos = pos
        const token_c = state.push('spoiler_close', 'span', -1)
        token_c.markup = '||'
      }
      state.pos = pos + 2
      return true
    }
    pos++
  }
  return false
})

md.renderer.rules.spoiler_open = () =>
  '<span class="md-spoiler" data-revealed="false">'
md.renderer.rules.spoiler_close = () => '</span>'

// ---------------------------------------------------------------------------
// Dropdown core rule — preprocesses `>>>` fences before block parsing.
// Opening/closing `>>>` lines become <details>/<summary> tags so the inner
// markdown content is parsed normally by markdown-it.
// Optional name: `>>> My Title` sets the summary text to "My Title".
// ---------------------------------------------------------------------------

md.core.ruler.before('block', 'md-dropdown', (state) => {
  const lines = state.src.split('\n')
  const fenceRe = /^\s*>>>\s*(.*)$/
  let inFence = false
  let fenceStartLine = -1
  let fenceName = ''
  // Track lines inside fenced code blocks to skip them
  let inCodeFence = false
  let codeFenceChar = ''
  let codeFenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const codeFence = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (codeFence) {
      const marker = codeFence[1]
      if (inCodeFence) {
        if (
          marker[0] === codeFenceChar &&
          marker.length >= codeFenceLen &&
          /^ {0,3}[`~]+[ \t]*$/.test(line)
        ) {
          inCodeFence = false
        }
      } else {
        inCodeFence = true
        codeFenceChar = marker[0]
        codeFenceLen = marker.length
      }
      continue
    }
    if (inCodeFence) continue

    const m = fenceRe.exec(line)
    if (m) {
      if (!inFence) {
        inFence = true
        fenceStartLine = i
        fenceName = (m[1] ?? '').trim()
      } else {
        // Closing fence — replace both lines with HTML tags
        const summaryContent = fenceName !== '' ? escapeHtml(fenceName) : ''
        lines[fenceStartLine] = `<details class="md-dropdown" open><summary class="md-dropdown-summary">${summaryContent}</summary>`
        lines[i] = '</details>'
        inFence = false
      }
    }
  }
  // Unclosed >>> left as-is (treated as plain text)
  state.src = lines.join('\n')
})

/**
 * Render a markdown string through the same md instance.
 * Used by livePreview.ts to render dropdown inner content.
 */
export function renderInlineMarkdown(text: string): string {
  return DOMPurify.sanitize(md.render(text))
}

/**
 * Render inline-level markdown only (no block-level wrapping like <p>).
 * Used by livePreview.ts for table cell content where block wrappers
 * would break the cell layout.
 */
export function renderInlineOnlyMarkdown(text: string): string {
  return DOMPurify.sanitize(md.renderInline(text))
}

/**
 * Add a "Copy code" button to fenced code blocks. The button sits at the
 * top-right corner and copies the raw code text to the clipboard on click.
 * The HTML structure mirrors the live-preview widget (cm-code-widget) so
 * both paths look and behave identically.
 */
const defaultFenceRenderer = md.renderer.rules.fence!.bind(md.renderer.rules)
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const rawCode = token.content
  const defaultHtml = defaultFenceRenderer(tokens, idx, options, env, self)
  const escapedCode = escapeHtml(rawCode)
  return [
    `<div class="md-code-block">`,
    `<button class="md-code-copy" title="Copy code" data-code="${escapedCode}">`,
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>`,
    `</button>`,
    defaultHtml,
    `</div>`,
  ].join('\n')
}

/**
 * E3 — the editor's underline command writes `__text__`, and `__` is also a
 * CommonMark strong marker, so markdown-it parses it as `<strong>`. Only the
 * `**` form may stay strong: re-route tokens whose markup is `__` to `<u>`.
 * Verified against markdown-it@15: strong_open/strong_close tokens carry the
 * original marker in `Token.markup` (`'**'` vs `'__'`).
 */
md.renderer.rules.strong_open = (tokens, idx) =>
  tokens[idx].markup === '__' ? '<u>' : '<strong>'
md.renderer.rules.strong_close = (tokens, idx) =>
  tokens[idx].markup === '__' ? '</u>' : '</strong>'

/**
 * User-results Other #4 — accept `-[]` / `- []` / `-[ ]` / `- [ ]`
 * (and `*`/`+` variants, with or without space after the bullet). CommonMark
 * only recognises `- ` as a list marker and markdown-it-task-lists only
 * matches `[ ] `/`[x] `/`[X] ` inline content, so the shorthand forms parse
 * as plain paragraphs. Normalise them to the standard `- [ ] ` spelling in
 * the source BEFORE block parsing. Fenced code blocks and indented code
 * lines are left untouched so their content stays literal.
 */
const TASK_MARKER_RE = /^(\s*)([-*+])\s*\[([ xX]?)\](?=\s|$)/

function normalizeTaskListMarkers(src: string): string {
  const lines = src.split('\n')
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const marker = fence[1]
      if (inFence) {
        // A closing fence: only the same char, at least as long, nothing else.
        if (
          marker[0] === fenceChar &&
          marker.length >= fenceLen &&
          /^ {0,3}[`~]+[ \t]*$/.test(line)
        ) {
          inFence = false
        }
      } else {
        inFence = true
        fenceChar = marker[0]
        fenceLen = marker.length
      }
      continue
    }
    if (inFence) continue
    if (/^ {4,}/.test(line)) continue // indented code block
    lines[i] = line.replace(TASK_MARKER_RE, (_, indent, bullet, label) => `${indent}${bullet} [${label || ' '}]`)
  }
  return lines.join('\n')
}

md.core.ruler.before('block', 'task-list-markers', (state) => {
  state.src = normalizeTaskListMarkers(state.src)
})

/**
 * User-results Other #5 — `-# text` subtext paragraphs. Runs LAST in the core
 * chain (after 'text_join') so it sees the final inline tokens: a paragraph
 * whose first inline child is a text token starting with `-# ` (or exactly
 * `-#`) gets the prefix stripped and the paragraph_open token gets
 * `class="md-subtext"` (the default renderer emits it via renderAttrs). A
 * marker with no content at all renders as a plain empty paragraph — no class.
 */
md.core.ruler.push('md-subtext', (state) => {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type !== 'paragraph_open') continue
    const inline = tokens[i + 1]
    if (inline.type !== 'inline' || !inline.children || inline.children.length === 0) continue
    const first = inline.children[0]
    if (first.type !== 'text') continue
    const content = first.content
    let rest: string
    if (content === '-#') rest = ''
    else if (content.startsWith('-# ')) rest = content.slice(3)
    else continue
    first.content = rest
    inline.content = rest + inline.content.slice(content.length)
    const hasContent = inline.children.some((child) => child.content.trim() !== '')
    if (hasContent) tokens[i].attrSet('class', 'md-subtext')
  }
})

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

/* Code block copy button — mirrors the editor live-preview widget. */
.md-code-block {
  position: relative;
}
.md-code-block .md-code-copy {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: var(--surface-2, #ececea);
  color: var(--muted, #6b7280);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
  z-index: 1;
}
.md-code-block:hover .md-code-copy {
  opacity: 1;
}
.md-code-block .md-code-copy:hover {
  background: var(--border, #e3e3df);
  color: var(--text, #1f2328);
}
.md-code-block .md-code-copy:active {
  transform: scale(0.95);
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
  width: 100%;
  height: auto;
  display: block;
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

/* Spoiler — ||text|| — censored grey box, click to reveal. */
.md-body .md-spoiler {
  background: var(--muted, #6b7280);
  color: transparent;
  border-radius: 3px;
  padding: 0 0.25em;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s ease, color 0.2s ease;
}
.md-body .md-spoiler[data-revealed="true"] {
  background: transparent;
  color: inherit;
}

/* Dropdown — ^^^ block — collapsible details/summary. */
.md-body .md-dropdown {
  margin: 0.8em 0;
  border: 1px solid var(--border, #e3e3df);
  border-radius: 6px;
  overflow: hidden;
}
.md-body .md-dropdown-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--muted, #6b7280);
  background: var(--surface, #f8f8f6);
  user-select: none;
  list-style: none;
}
.md-body .md-dropdown-summary::-webkit-details-marker {
  display: none;
}
.md-body .md-dropdown-summary::before {
  content: '\\25B6';
  display: inline-block;
  font-size: 0.7em;
  transition: transform 0.2s ease;
}
.md-body .md-dropdown[open] > .md-dropdown-summary::before {
  transform: rotate(90deg);
}
.md-body .md-dropdown > :not(.md-dropdown-summary) {
  padding: 8px 12px;
}
`

/**
 * Theme tokens for the standalone export document. The export has no
 * <link rel="stylesheet"> to the app's theme.css, so its :root must define
 * the tokens itself. Mirror of src/styles/theme.css — keep in sync when
 * tokens change. `--mono` is included in both blocks because the dark block
 * in theme.css inherits it from the light/:root block.
 *
 * G2 — the export no longer bakes one theme: the light block is the default
 * `:root` and the dark block rides inside a `prefers-color-scheme: dark`
 * media query so the document follows the system/browser setting.
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
  --muted: #b0b0b0;
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
  /**
   * Kept for call-site compatibility (the export command passes the resolved
   * app theme in `{ title, theme }`). G2: the standalone document no longer
   * bakes a theme — it ships BOTH token sets and follows the system/browser
   * preference via `prefers-color-scheme`, so this field is ignored.
   */
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
 * K3 — inline local raster images as data URLs for export.
 *
 * Scans markdown for `![alt](src)` tokens, resolves each relative src against
 * `docPath` via `resolveAgainstDocDir`, and calls `expose(absPath)` to get a
 * `data:` URL (Tauri's `expose_image` — rejects svg/unsupported, which we
 * intentionally skip so `pic.svg` stays not-embedded and `pic.png` becomes
 * `data:image/png;base64,...`). Returns the markdown with inlined data URLs
 * (or the original markdown when docPath is null, nothing is relative, or
 * expose fails). Duplicate srcs are de-duplicated before calling expose.
 *
 * Remote/absolute/data/blob/asset/rooted srcs and `.svg` are skipped by
 * design — they either must not be embedded or the CSP would block them
 * anyway, so the exported HTML keeps the raw src (rendered as empty/alt).
 */
export async function inlineMarkdownImages(
  markdown: string,
  docPath: string | null,
  expose: (absPath: string) => Promise<string>,
): Promise<string> {
  if (docPath === null) return markdown
  // Find all markdown image tokens: ![alt](inside)
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g
  const matches = [...markdown.matchAll(re)]
  if (matches.length === 0) return markdown

  // De-duplicate by raw src string (the first token inside parens, sans title).
  // Map raw src -> dataUrl (only when expose succeeds and not svg/remote).
  const cache = new Map<string, string>()

  // Helper: extract the bare src from the inside of `![alt](INSIDE)` — handles
  // `<src>`, title after src, and surrounding whitespace.
  function extractSrc(inside: string): { src: string; titlePart: string } {
    const trimmed = inside.trim()
    if (trimmed.startsWith('<')) {
      const end = trimmed.indexOf('>')
      if (end !== -1) {
        const src = trimmed.slice(1, end).trim()
        const titlePart = trimmed.slice(end + 1).trim()
        return { src, titlePart }
      }
    }
    // First whitespace-separated token is the src; remainder is optional title.
    const ws = trimmed.search(/\s/)
    if (ws === -1) return { src: trimmed, titlePart: '' }
    return { src: trimmed.slice(0, ws).trim(), titlePart: trimmed.slice(ws).trim() }
  }

  for (const m of matches) {
    const inside = m[2]
    const { src } = extractSrc(inside)
    if (src.length === 0) continue
    if (/^(https?:|data:|blob:|asset:|\/|#)/i.test(src)) continue
    const lower = src.toLowerCase().split('?')[0].split('#')[0]
    if (lower.endsWith('.svg')) continue
    if (cache.has(src)) continue
    // Cache misses are resolved now; failed exposes are not cached (leave raw).
    try {
      const abs = resolveAgainstDocDir(docPath, src)
      const dataUrl = await expose(abs)
      cache.set(src, dataUrl)
    } catch {
      // svg rejection, unsupported type, missing file — leave raw src
    }
  }

  if (cache.size === 0) return markdown

  // Rebuild markdown, replacing each token's src with the data URL when cached.
  let out = ''
  let last = 0
  for (const m of matches) {
    const start = m.index ?? 0
    const full = m[0]
    const alt = m[1]
    const inside = m[2]
    const { src, titlePart } = extractSrc(inside)
    const dataUrl = cache.get(src)
    out += markdown.slice(last, start)
    if (dataUrl !== undefined) {
      out += `![${alt}](${dataUrl}${titlePart !== '' ? ` ${titlePart}` : ''})`
    } else {
      out += full
    }
    last = start + full.length
  }
  out += markdown.slice(last)
  return out
}

/**
 * K3 — async export path that inlines local raster images before rendering.
 * Keeps `renderStandaloneHtml` synchronous for tests/preview; the export
 * command (app.ts) awaits this so `pic.png` next to the doc becomes
 * `data:image/png;base64,...` while `pic.svg` stays not-embedded.
 */
export async function renderStandaloneHtmlWithImages(
  markdown: string,
  opts: StandaloneHtmlOptions,
  docPath: string | null,
  expose: (absPath: string) => Promise<string>,
): Promise<string> {
  const inlined = await inlineMarkdownImages(markdown, docPath, expose)
  return renderStandaloneHtml(inlined, opts)
}

/**
 * Wrap `renderMarkdown()` output in a complete standalone HTML document.
 *
 * The document is self-contained: light theme tokens (:root) with dark
 * overrides via `@media (prefers-color-scheme: dark)` (G2 — no baked app
 * theme; the export follows the system/browser setting), the shared
 * `.md-body` stylesheet, BOTH hljs theme stylesheets (light default, dark
 * switched in by the same media query), and a CSP meta that permits no
 * scripts and no remote resources (`default-src 'none'`; inline styles for
 * the theme, `data:`/`blob:` images only) — rendered output is sanitized by
 * DOMPurify inside renderMarkdown, and the CSP is the second layer of
 * defense.
 */
export function renderStandaloneHtml(markdown: string, opts: StandaloneHtmlOptions): string {
  const body = renderMarkdown(markdown)
  const themeCss =
    THEME_TOKENS.light +
    '@media (prefers-color-scheme: dark) {\n' +
    THEME_TOKENS.dark +
    '}\n'
  const hljsCss =
    HLJS_CSS_LIGHT +
    '@media (prefers-color-scheme: dark) {\n' +
    HLJS_CSS_DARK +
    '}\n'
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(opts.title)}</title>`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:">`,
    `<style>${themeCss}${MARKDOWN_BODY_CSS}${hljsCss}` +
      'body { margin: 0; background: var(--bg); color: var(--text); }\n' +
      'main.md-body { padding: 32px 40px; max-width: 860px; margin: 0 auto; }\n' +
      '</style>',
    '</head>',
    `<body><main class="md-body">${body}</main>`,
    `<script>`,
    `(function(){document.addEventListener('click',function(e){var s=e.target.closest('.md-spoiler');if(s){s.setAttribute('data-revealed',s.getAttribute('data-revealed')==='true'?'false':'true');return}var btn=e.target.closest('.md-code-copy');if(!btn)return;e.stopPropagation();var code=btn.getAttribute('data-code');if(code!==null){var el=document.createElement('textarea');el.value=code;el.style.cssText='position:fixed;left:-9999px';document.body.appendChild(el);el.select();document.execCommand('copy');document.body.removeChild(el)}var svg=btn.innerHTML;btn.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>';setTimeout(function(){btn.innerHTML=svg},2000)})})();`,
    `</script>`,
    `</body>`,
    '</html>',
  ].join('\n')
}