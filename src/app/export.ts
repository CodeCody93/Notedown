/**
 * Notedown — shared markdown rendering pipeline (PLAN §6B, §14, §16, §17).
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
// Spoiler spans — `||text||` → <span class="md-spoiler"> (core preprocessing)
//
// WHY A CORE TRANSFORM (round-6 A6/B2): markdown-it's `text` rule consumes
// everything up to the next hardcoded terminator char, and `|` (0x7C) is NOT
// a terminator (unlike `=`/`~`/`^` used by mark/sub/sup). An inline rule
// placed after `text` therefore never sees the `||` opener — spoilers
// silently rendered as literal text since implementation. The classic
// delimiter-pair pattern (à la markdown-it-mark) cannot work either: even
// with the opener firing before `text`, the SAME `text` rule swallows the
// CLOSER before it is ever tokenized, and whole-span inline rules only fire
// at tokenizer retry points (line starts, after terminator-triggered tokens),
// so mid-text `a ||b|| c` still fails. Hence string preprocessing before
// block parsing (same seam as the dropdown rule below), with semantics
// mirroring the live editor's per-line `||` pairing (livePreview.ts):
// consecutive `||` runs pair up (0-1, 2-3, …), empty `||||` stays literal,
// backtick code spans and fenced blocks are protected, table-row-like lines
// are skipped (live skips tables too), and spans never cross blank lines.
// The inner content is parsed normally by the subsequent block/inline
// passes, so `||*em*||` keeps its emphasis.
// ---------------------------------------------------------------------------

/** Opener/closer HTML for spoiler spans (rendered output is DOMPurify-sanitized). */
const SPOILER_OPEN_HTML = '<span class="md-spoiler" data-revealed="false">'
const SPOILER_CLOSE_HTML = '</span>'

/**
 * Pair `||` runs on a SINGLE line into spoiler spans. Exported for tests and
 * for the inline-only render path below (which skips core rules).
 */
export function applySpoilerSpansToLine(line: string): string {
  // Table-row-like lines (a LEADING SINGLE pipe — not a `||` spoiler opener)
  // are skipped, mirroring the live editor's table skip, so pairing can never
  // merge cells or corrupt a table. `||x||` at line start still processes.
  if (/^\s*\|(?!\|)/.test(line)) return line

  // Collect backtick code-span ranges (an opener run of N closes only at a
  // run of exactly N; unclosed runs are literal) so `||` inside code stays
  // untouched. Single-line scope matches the live editor's per-line pairing.
  const codeRanges: Array<[number, number]> = []
  {
    let p = 0
    while (p < line.length) {
      if (line.charCodeAt(p) !== 0x60 /* ` */) {
        p++
        continue
      }
      let openLen = 0
      while (p + openLen < line.length && line.charCodeAt(p + openLen) === 0x60) openLen++
      let q = p + openLen
      let closed = false
      while (q < line.length) {
        if (line.charCodeAt(q) === 0x60) {
          let closeLen = 0
          while (q + closeLen < line.length && line.charCodeAt(q + closeLen) === 0x60) closeLen++
          if (closeLen === openLen) {
            codeRanges.push([p, q + closeLen])
            p = q + closeLen
            closed = true
            break
          }
          q += closeLen
          continue
        }
        q++
      }
      if (!closed) p++
    }
  }
  const inCode = (idx: number): boolean => codeRanges.some(([s, e]) => idx >= s && idx < e)

  // Collect `||` run starts outside code spans and pair them consecutively.
  const runs: number[] = []
  const re = /\|\|/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (!inCode(m.index)) runs.push(m.index)
  }
  if (runs.length < 2) return line

  let out = ''
  let last = 0
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const open = runs[i]
    const close = runs[i + 1]
    // Empty `||||` — leave the pair literal and move on, exactly like the
    // live editor (which skips pairs with no content between the runs).
    if (close === open + 2) continue
    out += line.slice(last, open) + SPOILER_OPEN_HTML
    last = open + 2
    out += line.slice(last, close) + SPOILER_CLOSE_HTML
    last = close + 2
  }
  out += line.slice(last)
  return out
}

/**
 * Strip one trailing CR for line-regex matching. `.` never matches `\r`, so
 * every `$`-anchored line regex silently fails on CRLF lines (round-6 A2:
 * ref-defs, `>>>` fences and fence closers all broke in CRLF docs).
 */
function stripCR(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/** Line-based spoiler transform with fenced-code protection. */
function applySpoilerSpans(src: string): string {
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
        if (
          marker[0] === fenceChar &&
          marker.length >= fenceLen &&
          /^ {0,3}[`~]+[ \t]*$/.test(stripCR(line))
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
    lines[i] = applySpoilerSpansToLine(line)
  }
  return lines.join('\n')
}

md.core.ruler.before('block', 'spoiler-spans', (state) => {
  state.src = applySpoilerSpans(state.src)
})

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
          /^ {0,3}[`~]+[ \t]*$/.test(stripCR(line))
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

    const m = fenceRe.exec(stripCR(line))
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
 *
 * `md.renderInline` skips core rules, so the spoiler-spans transform is
 * applied explicitly — otherwise `||x||` in a table cell would stay literal
 * while the same line renders as a spoiler everywhere else.
 */
export function renderInlineOnlyMarkdown(text: string): string {
  return DOMPurify.sanitize(md.renderInline(applySpoilerSpans(text)))
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
 * Round-6 A1 — allow sanitized SVG data URLs in links/images.
 * markdown-it 15's default `validateLink` rejects `data:` URLs except
 * gif/png/jpeg/webp, so an inlined `![svg](data:image/svg+xml;base64,…)`
 * image rendered as literal text instead of an `<img>`. Accept only
 * `data:image/svg+xml;` here.
 * SECURITY: safe because (1) every render still passes through DOMPurify,
 * (2) SVG bytes are sanitized by `sanitizeSvgDataUrl` before embedding,
 * (3) an `<img>`-loaded SVG runs in secure-static mode (scripts never
 * execute), (4) the export CSP is `img-src data: blob:`. Do NOT widen
 * beyond `data:image/svg+xml;` — no `javascript:`/`data:text/html` etc.
 */
const defaultValidateLink = md.validateLink.bind(md);
md.validateLink = (url: string) => {
  if (url.trim().toLowerCase().startsWith('data:image/svg+xml;')) return true;
  return defaultValidateLink(url);
};

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
          /^ {0,3}[`~]+[ \t]*$/.test(stripCR(line))
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
  width: 100%;
  box-sizing: border-box;
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
.md-body .md-dropdown > :not(.md-dropdown-summary):not(table) {
  padding: 8px 12px;
}
/* A GFM table parsed directly inside the dropdown <details> is a direct
   child — padding on a border-collapse: collapse table breaks its borders
   and keeps it shrink-to-content. Exclude it from the generic gutter above
   and reproduce the 12px side gutter with margins instead, so dropdown
   tables fill the content width exactly like tables outside dropdowns. */
.md-body .md-dropdown > table {
  padding: 0;
  width: calc(100% - 24px);
  margin: 8px 12px;
  box-sizing: border-box;
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
 * P1 — classification of an image `src` for export inlining.
 *
 * `inline`/`local` means "resolve against the doc dir and try `expose()`";
 * every other outcome is skip-by-design (left as-is in the export, where the
 * `img-src data: blob:` CSP would block a non-inlined relative src anyway):
 * `remote` (http/https), `data-url`, `blob-url`, `asset-url`, `fragment`
 * (`#...`), `absolute` (rooted `/...` or `\...`), `empty`, and the runtime
 * `expose-failed` (file missing/unsupported — recorded in
 * {@link InlineResult.skipped}).
 *
 * SVG (round-6 A1) is `inline`, NOT skipped: an SVG loaded via
 * `<img src="data:...">` runs in the browser's secure-static mode (scripts
 * never execute), and the payload is additionally DOMPurify-sanitized by
 * {@link sanitizeSvgDataUrl} before embedding — defense in depth for
 * recipients who might extract the data URL as a standalone document.
 */
export interface ImageSrcClassification {
  action: 'inline' | 'skip'
  reason: string
}

/**
 * P1 — pure classifier for an image `src`. No FS, no window — safe to
 * unit-test with plain strings.
 */
export function classifyImageSrc(src: string): ImageSrcClassification {
  const s = src.trim()
  if (s === '') return { action: 'skip', reason: 'empty' }
  if (/^data:/i.test(s)) return { action: 'skip', reason: 'data-url' }
  if (/^blob:/i.test(s)) return { action: 'skip', reason: 'blob-url' }
  if (/^asset:/i.test(s)) return { action: 'skip', reason: 'asset-url' }
  if (/^https?:/i.test(s)) return { action: 'skip', reason: 'remote' }
  if (s.startsWith('#')) return { action: 'skip', reason: 'fragment' }
  if (/^[\\/]/.test(s)) return { action: 'skip', reason: 'absolute' }
  return { action: 'inline', reason: 'local' }
}

/** Data-URL prefix produced by `expose_image` for SVG files. */
const SVG_DATA_PREFIX = 'data:image/svg+xml;base64,'

/**
 * Sanitize an SVG `data:` URL payload with DOMPurify and re-encode it
 * (round-6 A1). Strips `<script>`, event handlers and `javascript:` URIs
 * while keeping shapes/text — safe to embed even if a recipient extracts the
 * data URL as a standalone document. Throws on undecodable payloads (the
 * caller records `expose-failed`).
 */
export function sanitizeSvgDataUrl(dataUrl: string): string {
  const bytes = Uint8Array.from(atob(dataUrl.slice(SVG_DATA_PREFIX.length)), (c) => c.charCodeAt(0))
  const svg = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const clean = DOMPurify.sanitize(svg)
  const out = new TextEncoder().encode(clean)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < out.length; i += CHUNK) {
    binary += String.fromCharCode(...out.subarray(i, i + CHUNK))
  }
  return SVG_DATA_PREFIX + btoa(binary)
}

/** One skipped image src and the machine-readable `classifyImageSrc` reason. */
export interface InlineSkipped {
  src: string
  reason: string
}

/**
 * P1 — detailed result of image inlining. `inlined`/`skipped` hold UNIQUE raw
 * src strings in first-seen order (dedupe of `expose()` calls happens by
 * RESOLVED absolute path, so `./pic.png` and `pic.png` share one call but
 * both appear in `inlined`).
 */
export interface InlineResult {
  markdown: string
  inlined: string[]
  skipped: InlineSkipped[]
}

/**
 * Split the inside of `![alt](INSIDE)` into the bare src and the optional
 * title remainder. Handles `<src with spaces>` (title follows the `>`) and
 * bare `src "title"` / `src 'title'` / `src (title)` forms.
 */
function extractImageTarget(inside: string): { src: string; titlePart: string } {
  const trimmed = inside.trim()
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>')
    if (end !== -1) {
      return { src: trimmed.slice(1, end).trim(), titlePart: trimmed.slice(end + 1).trim() }
    }
  }
  const ws = trimmed.search(/\s/)
  if (ws === -1) return { src: trimmed, titlePart: '' }
  return { src: trimmed.slice(0, ws), titlePart: trimmed.slice(ws).trim() }
}

interface MdImageToken {
  start: number
  end: number
  alt: string
  inside: string
}

/**
 * Scan markdown for inline `![alt](target)` images with balanced `[]`/`()`
 * matching (quote- and `<>`-aware so titles like `"t(x)"` and destinations
 * like `<my pic.png>` survive). Reference-style `![alt][ref]` is NOT matched
 * here (no `(` after `]`) — it is handled via link-reference definitions.
 */
function scanMarkdownImages(markdown: string): MdImageToken[] {
  const out: MdImageToken[] = []
  let i = 0
  while (i < markdown.length) {
    const bang = markdown.indexOf('![', i)
    if (bang === -1) break
    // Balanced [...] for the alt text (backslash escapes honored).
    let j = bang + 2
    let depth = 1
    while (j < markdown.length && depth > 0) {
      const c = markdown[j]
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === '[') depth++
      else if (c === ']') depth--
      j++
    }
    if (depth !== 0) {
      i = bang + 2
      continue
    }
    const closeBracket = j - 1
    if (markdown[j] !== '(') {
      i = j
      continue
    }
    // Balanced (...) for the target; quotes only open after whitespace so
    // `it's.png` stays literal, and `<>` spans hide parens.
    let k = j + 1
    let pdepth = 1
    let inAngle = false
    let quote: string | null = null
    while (k < markdown.length && pdepth > 0) {
      const c = markdown[k]
      const prev = markdown[k - 1]
      if (quote !== null) {
        if (c === quote) quote = null
        k++
        continue
      }
      if (c === '\\') {
        k += 2
        continue
      }
      if (inAngle) {
        if (c === '>') inAngle = false
        k++
        continue
      }
      if (c === '<') {
        inAngle = true
        k++
        continue
      }
      if ((c === '"' || c === "'") && (prev === undefined || /\s/.test(prev) || prev === '(')) {
        quote = c
        k++
        continue
      }
      if (c === '(' && (prev === undefined || !/\s/.test(prev))) pdepth++
      else if (c === ')') pdepth--
      k++
    }
    if (pdepth !== 0) {
      i = j + 1
      continue
    }
    out.push({
      start: bang,
      end: k,
      alt: markdown.slice(bang + 2, closeBracket),
      inside: markdown.slice(j + 1, k - 1),
    })
    i = k
  }
  return out
}

interface HtmlImageToken {
  start: number
  end: number
  tag: string
}

/** Scan for raw-HTML `<img ...>` tags (quote-aware so `alt="a>b"` survives). */
function scanHtmlImages(markdown: string): HtmlImageToken[] {
  const out: HtmlImageToken[] = []
  const re = /<img\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    let k = m.index + 4
    let quote: string | null = null
    while (k < markdown.length) {
      const c = markdown[k]
      if (quote !== null) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === '>') {
        break
      }
      k++
    }
    if (k >= markdown.length) break // unterminated tag — leave as-is
    out.push({ start: m.index, end: k + 1, tag: markdown.slice(m.index, k + 1) })
    re.lastIndex = k + 1
  }
  return out
}

/** Normalize a link-reference label per CommonMark (whitespace + case). */
function normalizeRefLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * K3 — inline local images (raster + sanitized SVG) as data URLs for export.
 *
 * Scans markdown for `![alt](src)` tokens, resolves each relative src against
 * `docPath` via `resolveAgainstDocDir`, and calls `expose(absPath)` to get a
 * `data:` URL (`pic.png` becomes `data:image/png;base64,...`; `pic.svg`
 * becomes a DOMPurify-sanitized `data:image/svg+xml;base64,...` via
 * {@link sanitizeSvgDataUrl}). Returns the markdown with inlined data URLs
 * (or the original markdown when docPath is null, nothing is relative, or
 * expose fails). Duplicate srcs are de-duplicated before calling expose.
 *
 * P1 extensions: also inlines raw-HTML `<img src="...">` (replacing ONLY the
 * src value, preserving all other attributes) and reference-style image
 * definitions (`![alt][ref]` + `[ref]: path "title"` — the definition target
 * is inlined, the markdown structure is left intact). `expose()` calls are
 * de-duplicated by RESOLVED absolute path, not by raw string. See
 * {@link classifyImageSrc} for the skip-by-design list and
 * {@link inlineMarkdownImagesDetailed} for the full inlined/skipped report.
 */
export async function inlineMarkdownImages(
  markdown: string,
  docPath: string | null,
  expose: (absPath: string) => Promise<string>,
): Promise<string> {
  return (await inlineMarkdownImagesDetailed(markdown, docPath, expose)).markdown
}

/**
 * P1 — {@link inlineMarkdownImages} with the full detail report
 * ({@link InlineResult}). The string-only wrapper above keeps existing
 * callers/tests passing unchanged.
 */
export async function inlineMarkdownImagesDetailed(
  markdown: string,
  docPath: string | null,
  expose: (absPath: string) => Promise<string>,
): Promise<InlineResult> {
  const empty: InlineResult = { markdown, inlined: [], skipped: [] }
  if (docPath === null) return empty

  const inlined: string[] = []
  const inlinedSet = new Set<string>()
  const skipped: InlineSkipped[] = []
  const skippedSet = new Set<string>()
  const reportInlined = (src: string): void => {
    if (!inlinedSet.has(src)) {
      inlinedSet.add(src)
      inlined.push(src)
    }
  }
  const reportSkipped = (src: string, reason: string): void => {
    if (src.trim() === '' || skippedSet.has(src)) return
    skippedSet.add(src)
    skipped.push({ src, reason })
  }

  interface Pending {
    rawSrc: string
    abs: string
  }
  const pending: Pending[] = []
  const absOf = new Map<string, string>() // rawSrc -> abs (first resolution wins)

  /**
   * Classify + resolve a raw src; returns the trimmed raw src when it is a
   * candidate for inlining, or null when skipped (reported) / empty.
   */
  function consider(rawSrc: string): string | null {
    const src = rawSrc.trim()
    if (src === '') return null
    const c = classifyImageSrc(src)
    if (c.action === 'skip') {
      reportSkipped(src, c.reason)
      return null
    }
    const seen = absOf.get(src)
    if (seen !== undefined) return src
    let abs: string
    try {
      abs = resolveAgainstDocDir(docPath as string, src)
    } catch {
      reportSkipped(src, 'expose-failed')
      return null
    }
    absOf.set(src, abs)
    pending.push({ rawSrc: src, abs })
    return src
  }

  // --- Pass 1: inline `![alt](target)` -------------------------------------
  const mdTokens = scanMarkdownImages(markdown)
  const mdSrcs = new Array<string | null>(mdTokens.length)
  mdTokens.forEach((t, idx) => {
    mdSrcs[idx] = consider(extractImageTarget(t.inside).src)
  })

  // --- Pass 2: raw-HTML `<img src="...">` ----------------------------------
  const SRC_ATTR_RE = /\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s"'`>]+)/i
  const htmlTokens = scanHtmlImages(markdown)
  const htmlSrcs = new Array<string | null>(htmlTokens.length)
  htmlTokens.forEach((t, idx) => {
    const sm = SRC_ATTR_RE.exec(t.tag)
    htmlSrcs[idx] = sm !== null ? consider(unquoteSrcAttr(sm[1])) : null
  })

  // --- Pass 3: reference-style definitions used by `![alt][ref]` ------------
  const REF_USE_RE = /!\[([^\]]*)\]\[([^\]]*)\]/g
  const imageLabels = new Set<string>()
  for (const um of markdown.matchAll(REF_USE_RE)) {
    const ref = um[2]
    imageLabels.add(normalizeRefLabel(ref !== '' ? ref : um[1]))
  }
  interface RefDef {
    start: number
    end: number
    destStart: number
    destEnd: number
    rawSrc: string
  }
  const refDefs: RefDef[] = []
  if (imageLabels.size > 0) {
    const TITLE_RE = /^(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))$/
    let lineStart = 0
    for (const line of markdown.split('\n')) {
      const lineEnd = lineStart + line.length
      // CRLF tolerance (round-6 A2): `.` never matches `\r`, so the `$`
      // anchor fails on `\r`-terminated lines and the definition is silently
      // skipped. Match the CR-stripped line; offsets stay valid because the
      // destination span never includes the trailing `\r`.
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line
      const dm = /^[ ]{0,3}\[([^\]\n]+)\]:[ \t]*(.*)$/.exec(clean)
      if (dm !== null && imageLabels.has(normalizeRefLabel(dm[1]))) {
        const rawRest = dm[2]
        const rest = rawRest.trim()
        // Offset of `rest` inside `line` (dm[0] spans the whole line).
        const restBase = lineStart + (clean.length - rawRest.length)
        const lead = rawRest.length - rawRest.trimStart().length
        if (rest.startsWith('<')) {
          const lt = rawRest.indexOf('<')
          const gt = rawRest.indexOf('>', lt + 1)
          if (gt !== -1) {
            const after = rawRest.slice(gt + 1).trim()
            if (after === '' || TITLE_RE.test(after)) {
              refDefs.push({
                start: lineStart,
                end: lineEnd,
                destStart: restBase + lt,
                destEnd: restBase + gt + 1,
                rawSrc: rawRest.slice(lt + 1, gt).trim(),
              })
            }
          }
        } else {
          const ws = rest.search(/\s/)
          const dest = ws === -1 ? rest : rest.slice(0, ws)
          const after = ws === -1 ? '' : rest.slice(ws).trim()
          if (dest !== '' && (after === '' || TITLE_RE.test(after))) {
            refDefs.push({
              start: lineStart,
              end: lineEnd,
              destStart: restBase + lead,
              destEnd: restBase + lead + dest.length,
              rawSrc: dest,
            })
          }
        }
      }
      lineStart = lineEnd + 1 // +1 for the '\n' consumed by split
    }
  }
  const refSrcs = new Array<string | null>(refDefs.length)
  refDefs.forEach((d, idx) => {
    refSrcs[idx] = consider(d.rawSrc)
  })

  // --- Expose phase: ONE call per unique RESOLVED abs path ------------------
  const dataByAbs = new Map<string, string>()
  const failedAbs = new Set<string>()
  const seenAbs = new Set<string>()
  for (const p of pending) {
    if (seenAbs.has(p.abs)) continue
    seenAbs.add(p.abs)
    try {
      let dataUrl = await expose(p.abs)
      // SVG payloads are sanitized before embedding (see sanitizeSvgDataUrl).
      if (dataUrl.startsWith(SVG_DATA_PREFIX)) {
        dataUrl = sanitizeSvgDataUrl(dataUrl)
      }
      dataByAbs.set(p.abs, dataUrl)
    } catch {
      failedAbs.add(p.abs)
    }
  }
  // Raw srcs whose abs failed to expose are reported (not silently dropped).
  for (const p of pending) {
    if (failedAbs.has(p.abs)) reportSkipped(p.rawSrc, 'expose-failed')
    else reportInlined(p.rawSrc)
  }

  interface Edit {
    start: number
    end: number
    text: string
  }
  const edits: Edit[] = []

  mdTokens.forEach((t, idx) => {
    const src = mdSrcs[idx]
    if (src === null) return
    const dataUrl = dataByAbs.get(absOf.get(src) as string)
    if (dataUrl === undefined) return
    const { titlePart } = extractImageTarget(t.inside)
    edits.push({
      start: t.start,
      end: t.end,
      text: `![${t.alt}](${dataUrl}${titlePart !== '' ? ` ${titlePart}` : ''})`,
    })
  })

  htmlTokens.forEach((t, idx) => {
    const src = htmlSrcs[idx]
    if (src === null) return
    const dataUrl = dataByAbs.get(absOf.get(src) as string)
    if (dataUrl === undefined) return
    const sm = SRC_ATTR_RE.exec(t.tag)
    if (sm === null || sm.index === undefined) return
    const quote = sm[1].startsWith('"') || sm[1].startsWith("'") ? sm[1][0] : '"'
    const before = t.tag.slice(0, sm.index)
    const after = t.tag.slice(sm.index + sm[0].length)
    // Replace ONLY the src attribute value; every other attr is byte-identical.
    edits.push({
      start: t.start,
      end: t.end,
      text: `${before}src=${quote}${dataUrl}${quote}${after}`,
    })
  })

  refDefs.forEach((d, idx) => {
    const src = refSrcs[idx]
    if (src === null) return
    const dataUrl = dataByAbs.get(absOf.get(src) as string)
    if (dataUrl === undefined) return
    edits.push({
      start: d.destStart,
      end: d.destEnd,
      text: dataUrl, // bare data URL (no spaces) — valid with or without <>
    })
  })

  if (edits.length === 0) return { markdown, inlined, skipped }
  edits.sort((a, b) => a.start - b.start)
  let out = ''
  let last = 0
  for (const e of edits) {
    if (e.start < last) continue // overlapping spans — keep the first
    out += markdown.slice(last, e.start) + e.text
    last = e.end
  }
  out += markdown.slice(last)
  return { markdown: out, inlined, skipped }
}

/** Strip the surrounding quotes of an HTML `src="..."` attribute value. */
function unquoteSrcAttr(value: string): string {
  if (value.length >= 2) {
    const q = value[0]
    if ((q === '"' || q === "'") && value[value.length - 1] === q) {
      return value.slice(1, -1)
    }
  }
  return value
}

/**
 * K3 — async export path that inlines local images before rendering.
 * Keeps `renderStandaloneHtml` synchronous for tests/preview; the export
 * command (app.ts) awaits this so `pic.png` next to the doc becomes
 * `data:image/png;base64,...` and `pic.svg` a sanitized
 * `data:image/svg+xml;base64,...`.
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
 * remote resources (`default-src 'none'`; inline styles for the theme,
 * `data:`/`blob:` images only) with `script-src 'unsafe-inline'` for the
 * single trusted inline script below (spoiler reveal + copy-code button) —
 * rendered output is sanitized by DOMPurify inside renderMarkdown, and the
 * CSP is the second layer of defense.
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
    '<meta name="color-scheme" content="light dark">',
    `<title>${escapeHtml(opts.title)}</title>`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:">`,
    `<style>${themeCss}${MARKDOWN_BODY_CSS}${hljsCss}` +
      'body { margin: 0; background: var(--bg); color: var(--text); }\n' +
      'main.md-body { padding: 32px 40px; max-width: 860px; margin: 0 auto; }\n' +
      '/* Keep in sync with PRINT_CSS in src/app/print.ts (spoiler/dropdown/link print rules) — the standalone export must print correctly on its own. */\n' +
      '@media print {\n' +
      '  body, main.md-body { background: #fff; color: #000; }\n' +
      '  .md-body { background: #fff; color: #000; }\n' +
      '  .md-code-copy { display: none; }\n' +
      '  .md-body pre,\n' +
      '  .md-body table,\n' +
      '  .md-body blockquote,\n' +
      '  .md-body img { page-break-inside: avoid; }\n' +
      '  .md-body img { max-width: 100% !important; }\n' +
      '  details.md-dropdown { display: block !important; border-color: #ccc !important; }\n' +
      '  .md-body .md-dropdown-summary { background: #f5f5f5 !important; color: #000 !important; }\n' +
      '  .md-body .md-spoiler { background: none !important; color: inherit !important; }\n' +
      '  .md-body .md-spoiler[data-revealed="false"] { background: none !important; color: inherit !important; }\n' +
      '  .md-body a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.85em; word-break: break-all; }\n' +
      '}\n' +
      '</style>',
    '</head>',
    `<body><main class="md-body">${body}</main>`,
    `<script>`,
    `(function(){function fallbackCopy(text){var el=document.createElement('textarea');el.value=text;el.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(el);el.select();try{document.execCommand('copy')}catch(e){}document.body.removeChild(el)}document.addEventListener('click',function(e){var s=e.target.closest('.md-spoiler');if(s){s.setAttribute('data-revealed',s.getAttribute('data-revealed')==='true'?'false':'true');return}var btn=e.target.closest('.md-code-copy');if(!btn)return;e.stopPropagation();var code=btn.getAttribute('data-code');if(code===null)return;var done=function(){var svg=btn.innerHTML;btn.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>';setTimeout(function(){btn.innerHTML=svg},2000)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(code).then(done,function(){fallbackCopy(code);done()})}else{fallbackCopy(code);done()}})})();`,
    `</script>`,
    `</body>`,
    '</html>',
  ].join('\n')
}