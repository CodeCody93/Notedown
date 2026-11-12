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
 *    (`renderStandaloneHtml` in ./export), styled with the same
 *    `MARKDOWN_BODY_CSS` so preview and export look identical.
 *
 * Extracted from ./export so the editor/live preview (and the embeddable
 * editor package) can render markdown without importing the export pipeline
 * (which lazily imports pdf-lib). ./export re-exports this module's public
 * rendering API for existing callers/tests.
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
import { parseGraphTag, graphToHtml, graphToErrorHtml } from './graph'
import { parseListItem, cycleOrderedStyle, ListDepthTracker } from './lists'
import type { OrderedStyle, OrderedCase } from './lists'

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
 *
 * WHY `breaks: true` (soft-break parity): every source single `\n` must
 * produce a visible line break in all export formats — RTF emits `\line`
 * and DOCX emits `<w:br/>` for interior softbreaks, so the HTML path renders
 * `<br>` (markdown-it's documented `softbreak` → `<br>\n` behavior) instead
 * of a bare `\n` that browsers collapse to a space. Preview and standalone
 * export share this instance so they stay identical. Round-trip is safe: the
 * HTML importer (Turndown) converts `<br>` back to a line break that
 * re-renders as `<br>`.
 */
const md = new MarkdownIt({
  html: true,
  breaks: true,
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
// WHY shortcuts off (round-10 export round-trip, bug 8): the `full` preset
// bundles ASCII-emoticon shortcuts (`:D` → 😄, `:)` → 🙂, `<3` → ❤ …) that
// rewrite literal prose — e.g. `:D` inside a table cell — while Notedown
// documents emoji as `:shortcode:` (helpContent) and the picker inserts raw
// unicode. Clearing `shortcuts` keeps the full `:name:` defs (`:joy:` → 😂
// keeps working) and leaves emoticons byte-identical everywhere.
md.use(emoji, { shortcuts: {} })

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

// ---------------------------------------------------------------------------
// Graph core rule — single-line `%% ... %%` tags → pure-CSS graph figures.
//
// Same seam as the spoiler/dropdown rules above: string preprocessing before
// block parsing (the tag must survive as a block-level <figure>, and an
// inline rule would never fire mid-text). Registered AFTER the dropdown rule
// so it runs after task-list-markers → spoiler-spans → md-dropdown
// (same-anchor `before('block')` inserts run in registration order). No
// interaction either way: graph HTML contains no `>>>` or `||`, and spoiler
// output contains no `%%`.
// Fenced code blocks (```/~~~, stripCR-tolerant) and backtick code spans are
// protected, mirroring the spoiler rule; unclosed single `%%` stays literal.
// ---------------------------------------------------------------------------

/** Backtick code-span ranges on ONE line (same run-matching as spoilers). */
function graphLineCodeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
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
          ranges.push([p, q + closeLen])
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
  return ranges
}

/**
 * Replace single-line `%% ... %%` tags on ONE line with graph HTML.
 * Exported for tests (mirrors `applySpoilerSpansToLine`).
 */
export function applyGraphTagsToLine(line: string): string {
  const ranges = graphLineCodeRanges(line)
  return line.replace(/%%([\s\S]*?)%%/g, (full, innerRaw, offset) => {
    // Inline-code protection: a tag fully inside a backtick span stays literal.
    const start = offset as number
    if (ranges.some(([s, e]) => start >= s && start + full.length <= e)) return full
    const inner = (innerRaw as string).trim()
    if (inner === '') return full
    try {
      const parsed = parseGraphTag(inner)
      return parsed.ok ? graphToHtml(parsed.spec) : graphToErrorHtml(parsed.error, full)
    } catch {
      return full
    }
  })
}

/** Line-based graph transform with fenced-code protection. */
function applyGraphTags(src: string): string {
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
    lines[i] = applyGraphTagsToLine(line)
  }
  return lines.join('\n')
}

md.core.ruler.before('block', 'md-graph', (state) => {
  state.src = applyGraphTags(state.src)
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
 * Ordered-list indicators (round 11) — Notedown accepts `a.`/`A.` and
 * `i.`/`iv)` (Roman) ordered markers, but markdown-it only parses decimal
 * markers. This pre-block transform rewrites every alphabetic/Roman marker to
 * its decimal value while keeping the line count identical, and records the
 * original style/case per 0-based source line so the token rule below can
 * attach depth-aware `list-style-type` classes. Numeric lines are recorded
 * too (style `decimal`) so nested numeric markers still cycle by depth.
 */
type OrderedMarkerMeta = { style: OrderedStyle; markerCase: OrderedCase }

interface OrderedListEnv {
  notedownOrderedMeta?: Map<number, OrderedMarkerMeta>
}

/** Leading blockquote markers (`>`, `> >`, … with optional spaces/tabs). */
const BLOCKQUOTE_PREFIX_RE = /^((?:[ \t]*>[ \t]?)*)/

/**
 * Visual indentation width (tabs count as 4) used by the list tracker.
 * Exported for the pure export converters (parseExportBlocks in ./export).
 */
export function lineIndentWidth(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length
}

function normalizeOrderedListMarkers(src: string): { src: string; meta: Map<number, OrderedMarkerMeta> } {
  const meta = new Map<number, OrderedMarkerMeta>()
  const lines = src.split('\n')
  const listTracker = new ListDepthTracker()
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  let prevNonBlank: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      listTracker.reset()
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
      // Fence lines are non-blank but never list items, so they break the
      // "previous non-blank line was a list item" indented-code heuristic.
      prevNonBlank = null
      continue
    }
    if (inFence) continue

    const prefix = BLOCKQUOTE_PREFIX_RE.exec(line)![1]
    const rest = line.slice(prefix.length)
    if (/^ {4,}/.test(rest) || /^\t/.test(rest)) {
      // 4+ spaces (or a leading tab) is also how list-item content is
      // indented, so only treat it as a genuine code block when the previous
      // non-blank line was not itself a list item (same blockquote stripping).
      const prevPrefix = prevNonBlank === null ? '' : BLOCKQUOTE_PREFIX_RE.exec(prevNonBlank)![1]
      const prevRest = prevNonBlank === null ? null : prevNonBlank.slice(prevPrefix.length)
      // Treat 4-space indentation as list content when the previous non-blank
      // line was a list item OR indented continuation text (nested lists often
      // follow wrapped text); otherwise it is a genuine indented code block.
      const prevInList =
        prevRest !== null && (parseListItem(prevRest) !== null || lineIndentWidth(prevRest) > 0)
      if (!prevInList) {
        listTracker.noteNonList()
        prevNonBlank = line
        continue
      }
    }

    const info = parseListItem(rest)
    if (info === null) {
      if (line.trim() === '') listTracker.noteBlank()
      else listTracker.noteNonList(lineIndentWidth(rest))
    } else {
      const res = listTracker.feed(info)
      if (info.kind === 'ordered') {
        meta.set(i, { style: info.style ?? 'decimal', markerCase: info.markerCase ?? 'lower' })
        const value = res.orderedValue ?? info.value ?? 1
        // Rewrite when the source value differs from the display value:
        // non-decimal styles always, and nested list starts whose typed
        // continuation value (b./2./ii.) must restart at 1. Rewriting a
        // nested first item to `1.` also lets markdown-it interrupt the
        // parent paragraph and actually create the nested list.
        if (info.style !== 'decimal' || value !== info.value) {
          // Swap only the marker token: blockquote prefix, indentation, the
          // delimiter and trailing whitespace stay byte-for-byte intact.
          const delimAt = info.marker.search(/[.)]/)
          const trailing = delimAt >= 0 ? info.marker.slice(delimAt + 1) : ' '
          const marker = `${value}${info.delimiter ?? '.'}${trailing}`
          lines[i] = prefix + info.indent + marker + rest.slice(info.indent.length + info.marker.length)
        }
      }
    }
    if (line.trim() !== '') prevNonBlank = lines[i]
  }
  return { src: lines.join('\n'), meta }
}

md.core.ruler.before('block', 'ordered-list-markers', (state) => {
  const result = normalizeOrderedListMarkers(state.src)
  state.src = result.src
  const env = state.env as OrderedListEnv
  env.notedownOrderedMeta = result.meta
})

/** Ordered-list CSS class per display style/case (depth 1 decimal stays default). */
const ORDERED_LIST_CLASS: Record<OrderedStyle, Record<OrderedCase, string>> = {
  decimal: { lower: 'md-list-decimal', upper: 'md-list-decimal' },
  alpha: { lower: 'md-list-alpha', upper: 'md-list-alpha-upper' },
  roman: { lower: 'md-list-roman', upper: 'md-list-roman-upper' },
}

/**
 * Post-core token rule — decorates list-open tokens so the shared
 * MARKDOWN_BODY_CSS can switch indicators by nesting depth:
 *  - bullets: depth 1 keeps the default disc (no class); depth ≥ 2 alternates
 *    circle (even) / disc (odd);
 *  - ordered: a typed alpha/Roman marker wins at its level, numeric markers
 *    cycle decimal → alpha → roman from the nearest enclosing ordered level.
 */
md.core.ruler.push('notedown-list-styles', (state) => {
  const env = state.env as OrderedListEnv
  const meta = env.notedownOrderedMeta
  const listStack: Array<'ul' | 'ol'> = []
  const orderedStack: Array<{ depth: number; style: OrderedStyle }> = []
  for (const token of state.tokens) {
    if (token.type === 'bullet_list_open') {
      const depth = listStack.length + 1
      if (depth >= 2) token.attrJoin('class', depth % 2 === 0 ? 'md-list-circle' : 'md-list-disc')
      listStack.push('ul')
      continue
    }
    if (token.type === 'ordered_list_open') {
      const depth = listStack.length + 1
      const line = token.map?.[0]
      const markerMeta = line === undefined ? undefined : meta?.get(line)
      const explicit = markerMeta?.style ?? 'decimal'
      // Deeper ordered levels always continue the numbered → alpha → roman
      // cycle from the nearest enclosing ordered list, so continuation markers
      // inherited from the parent (Enter+Tab) still switch by depth. An
      // explicit alpha/Roman marker only chooses the starting style for a new
      // ordered list with no ordered ancestor.
      const ancestor = orderedStack[orderedStack.length - 1]
      let style: OrderedStyle
      if (ancestor !== undefined) {
        style = cycleOrderedStyle(ancestor.style, depth - ancestor.depth)
      } else if (explicit !== 'decimal') {
        style = explicit
      } else {
        style = cycleOrderedStyle('decimal', depth - 1)
      }
      const markerCase = markerMeta?.markerCase ?? 'lower'
      // Nested lists restart their own indicator sequence at 1/a/i: indenting
      // a continued item (Enter then Tab) leaves b./2./ii. in the source, but
      // the sub-list's first label must not inherit the parent's value.
      if (depth > 1) token.attrSet('start', '1')
      // Only add a class when it changes rendering; attrJoin keeps any
      // existing classes (e.g. task-list classes).
      if (depth > 1 || style !== 'decimal') {
        token.attrJoin('class', ORDERED_LIST_CLASS[style][markerCase])
      }
      orderedStack.push({ depth, style })
      listStack.push('ol')
      continue
    }
    if (token.type === 'bullet_list_close') {
      listStack.pop()
      continue
    }
    if (token.type === 'ordered_list_close') {
      listStack.pop()
      orderedStack.pop()
      continue
    }
  }
  delete env.notedownOrderedMeta
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
 *
 * GRAPH SANITIZE DEPENDENCY: the `%%` graph figures rely on the DOMPurify
 * DEFAULTS — keep the bare `DOMPurify.sanitize(html)` calls below (no
 * tightening) unless graphs are re-verified. The figure HTML needs `style`
 * (CSS vars `--v`/`--x`/`--y1`/`--y2` plus `conic-gradient` pie
 * backgrounds), `data-*` + `class` attributes, and
 * `figure`/`figcaption`/`table` elements — all preserved by default.
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

/* Nesting-aware list indicators (same sheet feeds preview + export). */
.md-body ul { list-style-type: disc; }
.md-body ul.md-list-circle { list-style-type: circle; }
.md-body ul.md-list-disc { list-style-type: disc; }
.md-body ol { list-style-type: decimal; }
.md-body ol.md-list-decimal { list-style-type: decimal; }
.md-body ol.md-list-alpha { list-style-type: lower-alpha; }
.md-body ol.md-list-alpha-upper { list-style-type: upper-alpha; }
.md-body ol.md-list-roman { list-style-type: lower-roman; }
.md-body ol.md-list-roman-upper { list-style-type: upper-roman; }

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

/* Nested tables (Packet D) — a single-line inline table element inside a
   GFM cell renders as a real sub-grid. Full width of the host cell, tighter
   margins/padding and slightly smaller type so the nesting reads clearly.
   The dropdown-table carve-outs below are untouched (they target only direct
   child tables). */
.md-body table table {
  width: 100%;
  margin: 0.3em 0;
  font-size: 0.9em;
}

.md-body table table th,
.md-body table table td {
  padding: 0.25em 0.5em;
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

/* Graphs — %% pie|bar|line ... %% — pure-CSS figures, no JS. The md-graph
   core rule above injects <figure class="md-graph"> HTML; all colors come
   from the app theme tokens, so dark mode follows automatically (no extra
   rules). Var contract with graph.ts: --v = unitless 0-100 bar height;
   --x/--y = dot-position percentages; --y1/--y2 = line-seg endpoint
   percentages; --c = legend swatch color. */
.md-body .md-graph {
  position: relative;
  margin: 0.8em 0;
  border: 1px solid var(--border, #e3e3df);
  border-radius: 6px;
  padding: 12px;
  background: var(--surface, #f8f8f6);
}
.md-body .md-graph figcaption,
.md-body .md-graph-title {
  font-weight: 600;
  margin-bottom: 8px;
}
/* Graph titles run almost as large as an h1 (h1 is 2em). Scoped to the
   figcaption child — the figure card carries .md-graph-{type} too, so a bare
   type selector would also match the card. */
.md-body .md-graph > figcaption,
.md-body .md-graph > .md-graph-title {
  font-size: 1.75em;
  font-weight: 600;
  margin-bottom: 12px;
}
.md-body .md-graph-error {
  border-color: #c00;
}
.md-body .md-graph-error pre {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0.4em 0 0;
}
/* Pie: side-by-side disc + legend column pinned to the right side. The
   chart row is display:flex (for bars), so the disc needs flex sizing —
   otherwise the row shrink-wraps it into a sliver. The disc grows to fill
   all free space; margin-left:auto pushes the legend hard right. */
.md-body .md-graph-chart.md-graph-chart-pie {
  align-items: center;
  min-height: 0;
  flex-wrap: wrap;
}
/* NOTE: element selectors below are scoped under .md-graph-chart on purpose:
   the <figure> card itself carries .md-graph-{type} too, so a bare
   .md-graph-pie / .md-graph-bar selector would also match the card (a bare
   .md-graph-pie rule forced the card's height to its width via aspect-ratio,
   leaving a big empty band at the bottom). */
.md-body .md-graph-chart > .md-graph-pie {
  flex: 1 1 0;
  min-width: 220px;
  aspect-ratio: 1;
  border-radius: 50%;
  margin: 0;
}
.md-body .md-graph-chart > .md-graph-legend {
  flex: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 0 auto;
  padding: 0;
  list-style: none;
  font-size: 1.5em;
}
.md-body .md-graph-chart > .md-graph-legend > li {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 10px;
}
.md-body .md-graph-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.md-body .md-graph-swatch,
.md-body .md-graph-legend-swatch,
.md-body .md-graph-legend-item > i {
  display: inline-block;
  width: 0.65em;
  height: 0.65em;
  border-radius: 50%;
  background: var(--c, var(--accent, #2563eb));
  flex: none;
}
/* Bar: y-axis gutter + grid plot (bars row over a tick row). The plot is a
   2-row grid, so each bar's --v percent is a TRUE fraction of the fixed bars
   row (the old flex column + calc(% * px) was invalid CSS, which collapsed
   every bar flat). Element selectors stay scoped under .md-graph-chart (the
   figure card shares .md-graph-{type}). data-min/data-max feed the scale
   labels via attr() — no extra elements needed. */
.md-body .md-graph-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-height: 160px;
  position: relative;
}
.md-body .md-graph-chart.md-graph-chart-plot {
  align-items: stretch;
  min-height: 0;
}
.md-body .md-graph-chart > .md-graph-y {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  align-self: center;
  max-height: 240px;
  font-size: 0.85em;
  color: var(--muted, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-body .md-graph-plot {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(var(--count, 1), minmax(0, 1fr));
  grid-template-rows: minmax(0, 220px) auto;
  column-gap: 8px;
  row-gap: 4px;
  padding-left: 44px;
}
/* Y scale: max at the top of the bars row, min at its bottom. The min label
   is offset by exactly the tick row (ticks are single-line at 1.5
   line-height) plus the row gap, so it sits on the bars baseline. */
.md-body .md-graph-plot::before {
  content: attr(data-max);
  position: absolute;
  top: 0;
  left: 0;
  width: 36px;
  text-align: right;
  font-size: 0.75em;
  color: var(--muted, #6b7280);
}
.md-body .md-graph-plot::after {
  content: attr(data-min);
  position: absolute;
  bottom: calc(1.6875em + 4px);
  left: 0;
  width: 36px;
  text-align: right;
  font-size: 0.75em;
  color: var(--muted, #6b7280);
}
.md-body .md-graph-plot > .md-graph-bar {
  align-self: end;
  height: var(--v, 0%);
  min-height: 4px;
  background: var(--c, var(--accent, #2563eb));
  border-radius: 4px 4px 0 0;
}
.md-body .md-graph-plot > .md-graph-tick {
  font-size: 1.125em;
  line-height: 1.5;
  color: var(--muted, #6b7280);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Axis labels outside the plot (line-chart x/y, bar-chart x). Bar y-labels
   live in the chart gutter (rule above) and override this. */
.md-body .md-graph-axis {
  font-size: 0.75em;
  color: var(--muted, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Line: one overlaid plot area — segment bands, dots and x labels all share
   the md-graph-line-area div, so nothing collapses (the old side-by-side
   dots/segs flex row gave both containers zero width, which is why no line
   rendered). Each segment clips its own slanted band across the whole area;
   dots sit on the joints; x labels anchor below with edge-aware alignment.
   data-min/max reuse the bar scale labels; the min offset is re-anchored to
   the area bottom (margin-bottom reserves the x-label row). */
.md-body .md-graph-plot.md-graph-line-plot {
  display: block;
  padding-left: 44px;
}
.md-body .md-graph-line-plot::after {
  bottom: 1.8em;
}
.md-body .md-graph-line-area {
  position: relative;
  height: 220px;
  margin-bottom: 1.8em;
}
.md-body .md-graph-line-area > .md-graph-seg {
  position: absolute;
  inset: 0;
  background: var(--c, var(--accent, #2563eb));
  clip-path: polygon(var(--x1) calc(100% - var(--y1)), var(--x2) calc(100% - var(--y2)), var(--x2) calc(100% - var(--y2) + 3px), var(--x1) calc(100% - var(--y1) + 3px));
}
.md-body .md-graph-line-area > .md-graph-dot {
  position: absolute;
  left: var(--x);
  bottom: var(--y);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c, var(--accent, #2563eb));
  box-shadow: 0 0 0 2px var(--surface, #f8f8f6);
  transform: translate(-50%, 50%);
}
.md-body .md-graph-line-area > .md-graph-xlab {
  position: absolute;
  top: calc(100% + 4px);
  left: var(--x);
  transform: translateX(calc(var(--edge, 0.5) * -100%));
  font-size: 0.85em;
  color: var(--muted, #6b7280);
  white-space: nowrap;
}
/* Line x-axis name: centered directly under the day-name row (mirroring how
   the y-axis name hugs its axis), with the series legend below it. Scoped to
   the line figure's direct child so pie/bar axis labels are untouched. */
.md-body .md-graph-line > .md-graph-x {
  text-align: center;
  margin: 4px 0 0;
}
/* Line legend: horizontal wrap below the chart (pie keeps its side column). */
.md-body .md-graph-line-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  justify-content: center;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  font-size: 1.125em;
}
.md-body .md-graph-line-legend > li {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Data table is an accessible + import fallback only — visually hidden but
   kept in the DOM so screen readers announce it and the Turndown import
   rule can still read it back into %% source. */
.md-body .md-graph-data {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`

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
