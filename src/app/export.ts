/**
 * Notedown — export pipeline (standalone HTML + unified txt/html/pdf/docx/rtf).
 *
 * The shared markdown rendering pipeline (the ONE markdown-it instance, the
 * highlight.js language set, the preprocessing core rules, DOMPurify on every
 * render and `MARKDOWN_BODY_CSS`) lives in ./markdown so the editor/live
 * preview and the embeddable editor package do not import this export module
 * (which lazily imports pdf-lib). This module re-exports that public rendering
 * API for existing callers/tests.
 *
 * Export wraps `renderMarkdown()` output in a standalone HTML document
 * (`renderStandaloneHtml`), styled with the same `MARKDOWN_BODY_CSS` so
 * preview and export look identical.
 *
 * SECURITY (PLAN §16): every markdown render is DOMPurify-sanitized inside
 * ./markdown before it can reach an export document.
 */
import DOMPurify from 'dompurify'
import { HLJS_CSS_DARK, HLJS_CSS_LIGHT } from '../styles/hljs-themes'
import { wrapStandaloneHtml } from '../render/document'
import type { StandaloneHtmlOptions } from '../render/document'
import { resolveAgainstDocDir } from './text'
import { parseGraphTag, graphToTextFallback } from './graph'
import { parseListItem, ListDepthTracker } from './lists'
import { escapeHtml, lineIndentWidth, MARKDOWN_BODY_CSS, renderMarkdown } from './markdown'

// Re-exported for the preview pane (a separate module): the preview injects the
// same stylesheets into its own <style> element so preview and export match.
export { HLJS_CSS_DARK, HLJS_CSS_LIGHT }

// Re-exported public rendering API (the preview pane, dialogs, editor and
// tests have always imported these from ./export — keep that surface stable
// while the implementation lives in ./markdown).
export { escapeHtml, MARKDOWN_BODY_CSS, renderMarkdown }
export type { StandaloneHtmlOptions }
export {
  applyGraphTagsToLine,
  applySpoilerSpansToLine,
  registerLanguages,
  renderInlineMarkdown,
  renderInlineOnlyMarkdown,
} from './markdown'

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
 * The document assembly (theme tokens, body/hljs/print CSS, CSP, inline
 * spoiler + copy-code script) lives in `../render/document` so the Node-only
 * `@codecody93/notedown-editor/render` entry reuses the EXACT same wrapper.
 * Default output is unchanged: `<html lang="en">`, the default CSP meta, and
 * the theme/hljs `prefers-color-scheme: dark` media queries.
 */
export function renderStandaloneHtml(markdown: string, opts: StandaloneHtmlOptions): string {
  return wrapStandaloneHtml(renderMarkdown(markdown), opts)
}

// ---------------------------------------------------------------------------
// Round-9 unified export — pure export core (txt/html/pdf/docx/rtf).
//
// WHY THIS MODULE GREW (round-9 unified export): the per-type Export HTML/PDF
// menu items are replaced by ONE Export dialog offering txt/html/pdf/docx/rtf
// (the same list as import). PDF is now a direct text-based export via pdf-lib
// (selectable, re-importable — never an image). This section is the PURE core the dialog + wiring packets
// consume, so the exported contract below is load-bearing: ExportFormat,
// EXPORT_FORMATS, exportLossSummaryFor, markdownToRtf, markdownToDocxBytes.
//
// Purity: no DOM/window access here (unlike renderMarkdown above, which needs
// DOMPurify). Outputs are plain text/bytes; docx text is XML-escaped and RTF
// text is RTF-escaped, so there is no HTML injection surface.
// ---------------------------------------------------------------------------

/** Formats offered by the unified Export dialog (mirrors the import list). */
export type ExportFormat = 'txt' | 'html' | 'pdf' | 'docx' | 'rtf'

/** Ordered format list for the dialog (wiring packet renders these in order). */
export const EXPORT_FORMATS: ExportFormat[] = ['txt', 'html', 'pdf', 'docx', 'rtf']

/**
 * Static fidelity notes per format for the Export dialog (round-9 unified
 * export). The per-file dynamic skip alert lives in app wiring; these lists
 * stay static and short (each ≤6 bullets). txt is verbatim source, so `[]`.
 */
export function exportLossSummaryFor(format: ExportFormat): string[] {
  switch (format) {
    case 'txt':
      return []
    case 'html':
      return [
        'Remote (http/https) and absolute-path images are not embedded — they stay linked and need network access to display.',
        'Local images that cannot be read are left as-is and listed in the export skip alert.',
        'Graphs are fully preserved as styled figures (same rendering as the on-screen preview).',
      ]
    case 'pdf':
      return [
        'Output is a selectable TEXT pdf, re-importable via Import — never an image scan.',
        'Tables render as bordered grids with shaded headers that repeat across pages; very wide tables shrink columns to fit, and images inside cells embed after the table.',
        'Local PNG/JPG images are embedded; SVG, remote, or unreadable images fall back to alt text and are listed in the skip alert.',
        'Tasks render as ASCII "- [ ]" / "- [x]" and graphs flatten to "Label=Value" text lines (bar/line scales and pie slices do not survive as graphics) so they round-trip through Import.',
        'Fonts are Helvetica/Courier (WinAnsi) only — emoji and CJK degrade to "?" (documented loss).',
        'Layout and pagination are minimal and differ from the on-screen preview.',
      ]
    case 'docx':
      return [
        'Headings, bold, italic, lists, code and basic tables survive; tables flatten to " | " text lines with a --- separator after the header.',
        'Images are dropped (alt text kept) — no image files are created.',
        'Exact fonts, colors, spacing and page layout are lost (minimal Normal + Heading1-3 styles).',
        'Underline stays underlined but re-imports as plain text; spoilers export revealed as plain text.',
        'Dropdowns expand statically (title + body); tasks become \u2610/\u2612 literals; footnotes, subtext and definition lists flatten to text.',
        'Graphs flatten to "Label=Value" text lines (bar/line scales and pie slices do not survive as graphics).',
      ]
    case 'rtf':
      return [
        'Headings, bold, italic, lists, code and basic tables survive; tables flatten to " | " text lines with a --- separator after the header.',
        'Images are dropped (alt text kept) — no image files are created.',
        'Exact fonts, colors, spacing and layout are lost (Calibri/Consolas only).',
        'Underline stays underlined but re-imports as plain text; spoilers export revealed as plain text.',
        'Dropdowns expand statically (title + body); tasks become \u2610/\u2612 literals; footnotes, subtext and definition lists flatten to text.',
        'Graphs flatten to "Label=Value" text lines (bar/line scales and pie slices do not survive as graphics).',
      ]
  }
}

// --- Shared file-local block/inline parser (not exported) -------------------
// ONE small parser feeds BOTH converters so RTF and DOCX agree on structure.
// Blocks: heading/bullet(task)/ordered/code-fence/blockquote/table/hr/
// dropdown-fence/footnote-def/subtext-kept-literal/para (blank-line joined).

interface ExportSeg {
  t: string
  b: boolean
  i: boolean
  u: boolean
  strike: boolean
  mark: boolean
  sup: boolean
  sub: boolean
  code: boolean
}

interface InlineFlags {
  b: boolean
  i: boolean
  u: boolean
  strike: boolean
  mark: boolean
  sup: boolean
  sub: boolean
  code: boolean
}

const PLAIN_FLAGS: InlineFlags = {
  b: false, i: false, u: false, strike: false, mark: false, sup: false, sub: false, code: false,
}

function plainSeg(t: string): ExportSeg {
  return { t, ...PLAIN_FLAGS }
}

function findUnescaped(src: string, ch: string, from: number): number {
  for (let k = from; k < src.length; k++) {
    if (src[k] === '\\') {
      k++
      continue
    }
    if (src[k] === ch) return k
  }
  return -1
}

/** Parse one inline range until `closer` (or end when null). Handles nesting. */
function parseInlineRange(
  src: string,
  pos: number,
  closer: string | null,
  flags: InlineFlags,
): { segs: ExportSeg[]; pos: number } {
  const segs: ExportSeg[] = []
  let buf = ''
  const flush = (): void => {
    if (buf !== '') {
      segs.push({ t: buf, ...flags })
      buf = ''
    }
  }
  /** Parse `inner` with extra flags and append the result. */
  const nest = (inner: string, extra: Partial<InlineFlags>): void => {
    const r = parseInlineRange(inner, 0, null, { ...flags, ...extra })
    segs.push(...r.segs)
  }
  while (pos < src.length) {
    if (closer !== null && src.startsWith(closer, pos)) {
      flush()
      return { segs, pos: pos + closer.length }
    }
    const c = src[pos]
    // Backslash escape.
    if (c === '\\' && pos + 1 < src.length) {
      buf += src[pos + 1]
      pos += 2
      continue
    }
    // Backtick code span (same-length closer; content stays literal).
    if (c === '`') {
      let n = 0
      while (src[pos + n] === '`') n++
      const run = '`'.repeat(n)
      const end = src.indexOf(run, pos + n)
      if (end === -1) {
        buf += run
        pos += n
        continue
      }
      flush()
      segs.push({ t: src.slice(pos + n, end), ...flags, code: true })
      pos = end + n
      continue
    }
    // Image `![alt](src)` / `![alt][ref]` / bare `![alt]` → alt text only.
    if (c === '!' && src[pos + 1] === '[') {
      const close = findUnescaped(src, ']', pos + 2)
      if (close === -1) {
        buf += '!'
        pos++
        continue
      }
      const alt = src.slice(pos + 2, close)
      let next = close + 1
      if (src[next] === '(') {
        const paren = findUnescaped(src, ')', next + 1)
        if (paren !== -1) next = paren + 1
      } else if (src[next] === '[') {
        const ref = findUnescaped(src, ']', next + 1)
        if (ref !== -1) next = ref + 1
      }
      flush()
      nest(alt, {})
      pos = next
      continue
    }
    // Link `[t](u)` → `t (u)`; `[t][ref]` → `t`.
    if (c === '[') {
      const close = findUnescaped(src, ']', pos + 1)
      const after = close !== -1 ? src[close + 1] : ''
      if (close !== -1 && after === '(') {
        const paren = findUnescaped(src, ')', close + 2)
        if (paren !== -1) {
          const text = src.slice(pos + 1, close)
          let url = src.slice(close + 2, paren).trim()
          const ws = url.search(/\s/)
          if (ws !== -1) url = url.slice(0, ws)
          url = url.replace(/^<|>$/g, '').trim()
          flush()
          nest(text, {})
          if (url !== '') segs.push({ t: ` (${url})`, ...flags })
          pos = paren + 1
          continue
        }
      } else if (close !== -1 && after === '[') {
        const ref = findUnescaped(src, ']', close + 2)
        if (ref !== -1) {
          flush()
          nest(src.slice(pos + 1, close), {})
          pos = ref + 1
          continue
        }
      }
      buf += '['
      pos++
      continue
    }
    // Multi-char markers first (`***` before `**`, or the bold half pairs and
    // strands a literal `*`: "***__~~all~~__***" must read bold+italic
    // outside. `||` is spoiler, revealed as plain).
    const multi: Array<[string, Partial<InlineFlags>]> = [
      ['***', { b: true, i: true }],
      ['**', { b: true }],
      ['__', { u: true }],
      ['~~', { strike: true }],
      ['==', { mark: true }],
      ['||', {}],
    ]
    let matched: [string, Partial<InlineFlags>] | null = null
    for (const cand of multi) {
      if (src.startsWith(cand[0], pos)) {
        matched = cand
        break
      }
    }
    if (matched !== null) {
      const [marker, extra] = matched
      const end = src.indexOf(marker, pos + marker.length)
      if (end === -1) {
        buf += marker
        pos += marker.length
        continue
      }
      flush()
      nest(src.slice(pos + marker.length, end), extra)
      pos = end + marker.length
      continue
    }
    // Single-char runs: * _ → italic, ^ → super, ~ → sub.
    if (c === '*' || c === '_' || c === '^' || c === '~') {
      const end = src.indexOf(c, pos + 1)
      if (end === -1) {
        buf += c
        pos++
        continue
      }
      flush()
      const extra: Partial<InlineFlags> =
        c === '^' ? { sup: true } : c === '~' ? { sub: true } : { i: true }
      nest(src.slice(pos + 1, end), extra)
      pos = end + 1
      continue
    }
    buf += c
    pos++
  }
  flush()
  return { segs, pos }
}

/**
 * Tokenize one inline string into styled segments (links flattened).
 * Exported for tests (lets PDF unit tests build flows from real syntax).
 */
export function parseExportInline(src: string): ExportSeg[] {
  return parseInlineRange(src, 0, null, PLAIN_FLAGS).segs
}

type ExportBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'ordered'; num: string; text: string }
  | { kind: 'task'; checked: boolean; text: string }
  | { kind: 'code'; lines: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'dropdown'; title: string; body: ExportBlock[] }
  | { kind: 'para'; text: string }

/** A `|---|---|` separator row (cells of optional colons + dashes). */
function isTableSep(line: string): boolean {
  if (!line.includes('-')) return false
  // Aware split (Packet D): a `|` inside a `<tag>` span or code span can never
  // start a separator cell, so route through splitTableRow (which also trims).
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell))
}

const TABLE_CELL_ESC = String.fromCharCode(0)

// PACKET-D INTENTIONAL DUPLICATE: this pipe-aware splitter is duplicated
// verbatim in src/editor/livePreview.ts (parseTableRow). Packet A creates
// src/app/table.ts concurrently — neither copy may import from it; dedupe
// both copies into that module once it lands.

/**
 * Split a table row into cells (Packet D: pipe-aware). Strips ONE
 * leading/trailing edge pipe, then splits on `|` EXCEPT when the pipe is
 * (a) an escaped `\|` (via the NUL placeholder trick), (b) inside a `<...>`
 * tag span (e.g. `<a href="a|b">`), or (c) inside a backtick code span (any
 * run length, matched open/close; unclosed runs are literal). Cells are
 * trimmed. Delimiter acceptance lives in isTableSep (/^:?-{1,}:?$/).
 */
function splitTableRow(line: string): string[] {
  const tmp = line.replace(/\\\|/g, TABLE_CELL_ESC)
  let t = tmp.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  let i = 0
  while (i < t.length) {
    const ch = t[i]
    // Backtick code span: an opener run of N closes only at a run of exactly
    // N (same rule as the spoiler code-span guard); unclosed runs are literal.
    if (ch === '`') {
      let n = 0
      while (t[i + n] === '`') n++
      const run = '`'.repeat(n)
      const end = t.indexOf(run, i + n)
      if (end === -1) {
        cur += run
        i += n
      } else {
        cur += t.slice(i, end + n)
        i = end + n
      }
      continue
    }
    // Tag span: `<...>` (e.g. `<a href="a|b">`) protects pipes in attributes.
    if (ch === '<') {
      const end = t.indexOf('>', i + 1)
      if (end === -1) {
        cur += ch
        i++
      } else {
        cur += t.slice(i, end + 1)
        i = end + 1
      }
      continue
    }
    if (ch === '|') {
      cells.push(cur.trim().split(TABLE_CELL_ESC).join('|'))
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  cells.push(cur.trim().split(TABLE_CELL_ESC).join('|'))
  return cells
}

/**
 * Packet D — flatten nested-table HTML in a table cell to plain text for the
 * TXT-grid converters (RTF/DOCX/PDF share parseExportBlocks+parseExportInline).
 * `<br>` → space, `</tr>`/`</td>`/`</th>` → ` / `, all other tags → space,
 * then whitespace is collapsed, `/`-only runs merge, and edge separators are
 * trimmed (a legit leading `/usr`-style slash has no space after it, so the
 * edge trim requires one and leaves it alone). Fast gate: cells without
 * `<tag>` pass through byte-identical.
 *
 * v1 KNOWN LIMIT (documented): no real nested grids — RTF/DOCX get no nested
 * w:tbl, PDF gets no sub-grid; nested content degrades to `a / b`-style text
 * so no data is lost. TXT export stays verbatim (raw source, untouched).
 * Exported for tests.
 */
export function stripNestedTableHtml(cell: string): string {
  if (!/<[a-zA-Z/!][^>]*>/.test(cell)) return cell
  let out = cell.replace(/<br\s*\/?>/gi, ' ')
  out = out.replace(/<\/(tr|td|th)\s*>/gi, ' / ')
  out = out.replace(/<[^>]*>/g, ' ')
  out = out.replace(/\s+/g, ' ')
  out = out.replace(/\/(\s+\/)+/g, '/')
  out = out.replace(/^\s*\/\s+|\s+\/\s*$/g, '')
  return out.trim()
}

/** Classify + join plain lines into blocks (CRLF normalized first). */
function parseExportBlocks(src: string): ExportBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ExportBlock[] = []
  const listTracker = new ListDepthTracker()
  let para: string[] = []
  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', text: para.join('\n') })
      para = []
    }
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '') {
      flushPara()
      listTracker.noteBlank()
      i++
      continue
    }
    const hrLine = /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)
    const preList = hrLine ? null : parseListItem(line)
    // A non-list line ends the list context unless it is continuation text
    // indented inside the current list item; list lines are fed exactly once
    // in their own branches below.
    if (preList === null) listTracker.noteNonList(lineIndentWidth(line))
    // Fenced code (``` or ~~~, closer = same char, ≥3 long).
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence !== null) {
      flushPara()
      const ch = fence[1][0]
      const closerRe = new RegExp(`^ {0,3}${ch === '`' ? '`{3,}' : '~{3,}'}\\s*$`)
      const buf: string[] = []
      i++
      while (i < lines.length && !closerRe.test(lines[i])) {
        buf.push(lines[i].replace(/\t/g, '    '))
        i++
      }
      if (i < lines.length) i++ // consume closer
      blocks.push({ kind: 'code', lines: buf })
      continue
    }
    // >>> dropdown fence → title line + body (unclosed stays literal text).
    const dd = /^\s*>>>\s*(.*)$/.exec(line)
    if (dd !== null) {
      flushPara()
      const title = (dd[1] ?? '').trim()
      const inner: string[] = []
      i++
      while (i < lines.length && !/^\s*>>>\s*$/.test(lines[i])) {
        inner.push(lines[i])
        i++
      }
      if (i < lines.length) {
        i++ // consume closer
        blocks.push({ kind: 'dropdown', title, body: parseExportBlocks(inner.join('\n')) })
      } else {
        para.push(line.trim())
        for (const l of inner) {
          if (l.trim() === '') flushPara()
          else para.push(l.trim())
        }
      }
      continue
    }
    if (hrLine) {
      flushPara()
      blocks.push({ kind: 'hr' })
      i++
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (h !== null) {
      flushPara()
      blocks.push({ kind: 'heading', level: h[1].length, text: h[2].trim().replace(/\s+#+$/, '').trim() })
      i++
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      flushPara()
      const parts: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', text: parts.join('\n') })
      continue
    }
    // Graph text fallback (pure-export path): a line that is exactly one
    // `%% ... %%` tag degrades to its plain-text form so RTF/DOCX/PDF (which
    // share this parser) never show raw `%%` source. Fenced code is consumed
    // above (stays literal); multi-tag lines and `%%%%` stay literal (v1
    // grace). Placed before table detection so a `|` inside a tag can never
    // misparse as a table header. Never throws.
    if (/^%%[\s\S]*?%%$/.test(trimmed)) {
      let fallback: string | null = null
      try {
        const inner = trimmed.replace(/^%%([\s\S]*?)%%$/, '$1').trim()
        if (inner !== '') {
          const parsed = parseGraphTag(inner)
          fallback = parsed.ok ? graphToTextFallback(parsed.spec) : `Graph error: ${parsed.error}`
        }
      } catch {
        fallback = null
      }
      if (fallback !== null) {
        flushPara()
        blocks.push({ kind: 'para', text: fallback })
        i++
        continue
      }
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara()
      const rows: string[][] = [splitTableRow(line)]
      i += 2
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', rows })
      continue
    }
    // WHY no-space shorthand (round-10 export round-trip, bug 2): mirrors
    // TASK_MARKER_RE above — `-[]`/`-[ ]`/`-[x]` with NO space after the
    // bullet are tasks in preview, so they must be tasks here too (otherwise
    // adjacent task lines merge into one paragraph). `(?=\s|$)` keeps
    // `-[]glued` literal, exactly like the preview normalizer.
    const task = /^\s*[-*+•]\s*\[([ xX]?)\](?=\s|$)\s*(.*)$/.exec(line)
    if (task !== null) {
      flushPara()
      listTracker.feed({ indent: /^\s*/.exec(line)![0], marker: '', kind: 'task' })
      blocks.push({ kind: 'task', checked: task[1].toLowerCase() === 'x', text: task[2] })
      i++
      continue
    }
    if (preList !== null && preList.kind === 'ordered') {
      flushPara()
      const res = listTracker.feed(preList)
      blocks.push({
        kind: 'ordered',
        num: res.orderedLabel ?? '1',
        text: line.slice(preList.indent.length + preList.marker.length).trim(),
      })
      i++
      continue
    }
    const bul = /^\s*([-*+•])\s+(.*)$/.exec(line)
    if (bul !== null) {
      flushPara()
      listTracker.feed({ indent: /^\s*/.exec(line)![0], marker: '', kind: 'unordered' })
      blocks.push({ kind: 'bullet', text: bul[2] })
      i++
      continue
    }
    // Footnote defs stay literal (reversibility wins); normal ref defs drop.
    if (/^\s*\[\^[^\]]+\]:/.test(line)) {
      flushPara()
      blocks.push({ kind: 'para', text: trimmed })
      i++
      continue
    }
    if (/^\s{0,3}\[[^\]]+\]:\s*\S/.test(line)) {
      i++
      continue
    }
    // `-# ` subtext falls through here unchanged (no bullet match: no space
    // after `-`), keeping the literal marker so re-import preserves it.
    para.push(trimmed)
    i++
  }
  flushPara()
  return blocks
}

// --- RTF -------------------------------------------------------------------

/** Escape text to 7-bit ASCII RTF (reversibility: \'xx ≤0xFF, \uN? above). */
function rtfEscapeText(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch === '\\') out += '\\\\'
    else if (ch === '{') out += '\\{'
    else if (ch === '}') out += '\\}'
    else {
      const cp = ch.codePointAt(0) as number
      if (cp < 32) {
        if (cp === 9) out += '\\tab '
      } else if (cp < 128) {
        out += ch
      } else if (cp <= 255) {
        out += `\\'${cp.toString(16).padStart(2, '0')}`
      } else if (cp <= 0xffff) {
        out += `\\u${cp > 32767 ? cp - 65536 : cp}?`
      } else {
        // Astral code points → two signed-16-bit \u surrogates (RTF readers
        // expect UTF-16 units); `?` is the \uc1 fallback char.
        const t = cp - 0x10000
        const hi = (t >> 10) + 0xd800
        const lo = (t & 0x3ff) + 0xdc00
        const s16 = (v: number): number => (v > 32767 ? v - 65536 : v)
        out += `\\u${s16(hi)}?\\u${s16(lo)}?`
      }
    }
  }
  return out
}

/**
 * Wrap code text in literal backtick markers so the words round-trip as code
 * (round-10 export round-trip, bug 4): RTF/DOCX carry code as Consolas styling
 * that mammoth and our rtfToMarkdown both drop. Tick length is one past the
 * longest run inside (CommonMark-style), space-padded when an edge touches a
 * backtick.
 */
function wrapCodeTicks(t: string): string {
  let run = 0
  let longest = 0
  for (const ch of t) {
    if (ch === '`') {
      run++
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }
  const fence = '`'.repeat(longest + 1)
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${t}${pad}${fence}`
}

/** Styled segments → RTF control words (caller supplies paragraph scope). */
function exportSegsToRtf(segs: ExportSeg[]): string {
  let out = ''
  for (const s of segs) {
    let pre = ''
    let post = ''
    if (s.code) {
      pre += '{\\f1 '
      post = '}' + post
    }
    if (s.b) {
      pre += '\\b '
      post = '\\b0 ' + post
    }
    if (s.i) {
      pre += '\\i '
      post = '\\i0 ' + post
    }
    if (s.u) {
      pre += '\\ul '
      post = '\\ulnone ' + post
    }
    if (s.strike) {
      pre += '\\strike '
      post = '\\strike0 ' + post
    }
    if (s.mark) {
      pre += '\\highlight7 '
      post = '\\highlight0 ' + post
    }
    if (s.sup) {
      // WHY grouped (round-10 export round-trip, bug 3): a bare `\nosupersub `
      // trailing delimiter space is re-emitted as content by our own
      // rtfToMarkdown (round-8 D2), so "~sub~text" reimported with a phantom
      // space. Closing the group with `}` terminates the control word with NO
      // delimiter space, and the group end resets the style for strict readers
      // too. `\b0`-style resets keep their swallowed space (importer-safe).
      pre += '{\\super '
      post = '\\nosupersub}' + post
    }
    if (s.sub) {
      // Same grouping as \super above (same D2 delimiter-space leak).
      pre += '{\\sub '
      post = '\\nosupersub}' + post
    }
    // WHY soft breaks (single `\n` inside a para/quote block): blank lines
    // flush paras, so an interior `\n` is a soft break, not a new paragraph.
    // rtfEscapeText drops `\n`, so joining with `\n` alone would silently
    // merge words — emit an explicit `\line ` between the escaped pieces.
    // Each piece re-opens/re-closes the formatting (no style spans the
    // `\line`), and empty pieces contribute nothing but the separator, so a
    // segment that is only `\n` still produces a break.
    const pieces = s.t.split('\n')
    const formatted: string[] = []
    for (const piece of pieces) {
      if (piece === '') {
        formatted.push('')
        continue
      }
      // WHY backticks (round-10 export round-trip, bug 4): the importer is
      // font-blind (ignores \f1/Consolas), so bare code text reimported as plain
      // prose and fences vanished. Literal markers survive as text.
      const esc = rtfEscapeText(s.code ? wrapCodeTicks(piece) : piece)
      if (esc === '') {
        formatted.push('')
        continue
      }
      formatted.push(pre + esc + post)
    }
    if (pieces.length === 1 && formatted[0] === '') continue
    out += formatted.join('\\line ')
  }
  return out
}

/** Blocks → RTF paragraph bodies (joined with \par by the caller). */
function exportBlocksToRtfParas(blocks: ExportBlock[]): string[] {
  const paras: string[] = []
  // WHY literal list prefixes (round-9 unified export): real RTF list tables
  // (\listtable/\listoverridetable) are verbose and our RTF-import path reads
  // literal `- `/`1. ` text back losslessly — the same convention as tables
  // (` | ` separators), so exports round-trip through Import.
  const inline = (t: string): string => exportSegsToRtf(parseExportInline(t))
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': {
        // WHY literal `#` prefix, NO bold (round-10 export round-trip, bug 5):
        // size+bold alone reimports as `**header**` (levels lost), and bold
        // around the prefix reimports as `**# header**` (a bold literal, still
        // not a heading). Plain size + literal `#… ` text reimports as a real
        // heading; the font size keeps WordPad/Word pretty. (DOCX keeps real
        // Heading1-3 styles — mammoth recovers them — so no prefix needed.)
        const sizes = [56, 48, 40, 32, 28, 24]
        const sz = sizes[Math.min(Math.max(b.level, 1), 6) - 1]
        paras.push(`{\\f0\\fs${sz} ${rtfEscapeText(`${'#'.repeat(b.level)} `)}${inline(b.text)}}`)
        break
      }
      case 'bullet':
        paras.push(`{\\f0\\fs24 - ${inline(b.text)}}`)
        break
      case 'ordered':
        paras.push(`{\\f0\\fs24 ${rtfEscapeText(`${b.num}. `)}${inline(b.text)}}`)
        break
      case 'task':
        paras.push(`{\\f0\\fs24 ${rtfEscapeText(b.checked ? '☒ ' : '☐ ')}${inline(b.text)}}`)
        break
      case 'code': {
        // WHY literal fences (bug 4): Consolas styling alone is invisible to
        // the importer, so ``` lines bracket the block (blank lines stay
        // inside the fences instead of splitting it on reimport).
        for (const l of [`\`\`\``, ...b.lines, `\`\`\``]) {
          const esc = rtfEscapeText(l)
          paras.push(esc === '' ? '' : `{\\f1 ${esc}}`)
        }
        break
      }
      case 'quote':
        paras.push(`{\\f0\\fs24 > ${inline(b.text)}}`)
        break
      case 'hr':
        // WHY literal `---` (round-10 verification): an empty para reimports
        // as a blank line (marker lost); literal text round-trips through our
        // own importer and re-exports as an hr again.
        paras.push(`{\\f0\\fs24 ---}`)
        break
      case 'table': {
        // WHY literal separator (round-10, bug 7): static expansion stays (no
        // real RTF tables), but a `--- | ---` line after the header keeps the
        // header/body structure visible instead of N identical text lines.
        // Packet D: stripNestedTableHtml flattens single-line nested-table
        // HTML to `a / b`-style text (no nested RTF tables in v1 — see its
        // comment); non-HTML cells pass through byte-identical.
        b.rows.forEach((row, idx) => {
          paras.push(`{\\f0\\fs24 ${row.map((cell) => inline(stripNestedTableHtml(cell))).join(' | ')}}`)
          if (idx === 0) paras.push(`{\\f0\\fs24 ${row.map(() => '---').join(' | ')}}`)
        })
        break
      }
      case 'dropdown': {
        if (b.title !== '') paras.push(`{\\f0\\fs24 ${inline(b.title)}}`)
        paras.push(...exportBlocksToRtfParas(b.body))
        break
      }
      case 'para':
        paras.push(`{\\f0\\fs24 ${inline(b.text)}}`)
        break
    }
  }
  return paras
}

/**
 * Zero-dependency Markdown → RTF (round-9 unified export). Returns a full
 * ASCII RTF document (Calibri body + Consolas code). Tables flatten to
 * ` | ` lines and lists keep literal prefixes so the app's RTF-import
 * convention reads them back; `-# ` subtext and footnote defs stay literal.
 */
export function markdownToRtf(markdown: string): string {
  const paras = exportBlocksToRtfParas(parseExportBlocks(markdown))
  const body = paras.length > 0 ? paras.join('\\par\n') + '\\par' : '\\par'
  return (
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}{\\f1 Consolas;}}\\viewkind4\\uc1\\f0\\fs24 ' +
    body +
    '}'
  )
}

// --- DOCX ------------------------------------------------------------------

/** CRC32 table for the STORED zip writer (polynomial 0xEDB88320). */
const ZIP_CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function zipCrc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let k = 0; k < data.length; k++) crc = (crc >>> 8) ^ ZIP_CRC_TABLE[(crc ^ data[k]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

/** Minimal STORED (method 0) zip writer — no compression, no new deps. */
function buildStoredZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder()
  const names = entries.map((e) => enc.encode(e.name))
  let total = 22 // EOCD
  for (let k = 0; k < entries.length; k++) total += 30 + names[k].length + entries[k].data.length
  for (const n of names) total += 46 + n.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let off = 0
  const u16 = (v: number): void => {
    view.setUint16(off, v, true)
    off += 2
  }
  const u32 = (v: number): void => {
    view.setUint32(off, v >>> 0, true)
    off += 4
  }
  const bytes = (b: Uint8Array): void => {
    out.set(b, off)
    off += b.length
  }
  const offsets: number[] = []
  for (let k = 0; k < entries.length; k++) {
    const data = entries[k].data
    const crc = zipCrc32(data)
    offsets.push(off)
    u32(0x04034b50)
    u16(20) // version needed
    u16(0) // flags
    u16(0) // method: STORED
    u16(0) // mod time
    u16(0x0021) // mod date (1980-01-01)
    u32(crc)
    u32(data.length)
    u32(data.length)
    u16(names[k].length)
    u16(0) // extra length
    bytes(names[k])
    bytes(data)
  }
  const centralStart = off
  for (let k = 0; k < entries.length; k++) {
    const data = entries[k].data
    u32(0x02014b50)
    u16(20) // version made by
    u16(20) // version needed
    u16(0) // flags
    u16(0) // method
    u16(0) // mod time
    u16(0x0021) // mod date
    u32(zipCrc32(data))
    u32(data.length)
    u32(data.length)
    u16(names[k].length)
    u16(0) // extra
    u16(0) // comment
    u16(0) // disk start
    u16(0) // internal attrs
    u32(0) // external attrs
    u32(offsets[k])
    bytes(names[k])
  }
  // P0 (round-10 DOCX corruption): snapshot the central-directory size BEFORE
  // writing the EOCD header. `off` advances 12 bytes through the EOCD
  // signature + disk fields below, so `u32(off - centralStart)` here
  // overstated cdSize by exactly 12 — strict parsers (JSZip/mammoth) failed
  // with "missing 12 bytes" while lenient ones (.NET) ignored it. cdOff was
  // always correct; only cdSize lied.
  const centralSize = off - centralStart
  u32(0x06054b50)
  u16(0) // disk number
  u16(0) // central-dir disk
  u16(entries.length)
  u16(entries.length)
  u32(centralSize)
  u32(centralStart)
  u16(0) // comment length
  // Consistency assert: the precomputed `total` must equal the bytes written
  // (guards future field-size drift between the prologue and the writers).
  if (off !== total) throw new Error(`buildStoredZip: wrote ${off} bytes, expected ${total}`)
  return out
}

/** XML-escape docx text (strips chars illegal in XML 1.0). */
function docxEscape(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Styled segments → Word runs (b/i/u/strike/highlight/sub+super/mono). */
function exportSegsToDocxRuns(segs: ExportSeg[]): string {
  let out = ''
  for (const s of segs) {
    if (s.t === '') continue
    let rpr = ''
    if (s.b) rpr += '<w:b/>'
    if (s.i) rpr += '<w:i/>'
    if (s.u) rpr += '<w:u w:val="single"/>'
    if (s.strike) rpr += '<w:strike w:val="true"/>'
    if (s.mark) rpr += '<w:highlight w:val="yellow"/>'
    if (s.sup) rpr += '<w:vertAlign w:val="superscript"/>'
    else if (s.sub) rpr += '<w:vertAlign w:val="subscript"/>'
    if (s.code) {
      rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/>'
    }
    // WHY soft breaks (RTF twin): a single `\n` inside a para/quote block is
    // a soft break, not a new paragraph. Split the run text on `\n` and emit
    // `<w:br/>` between `<w:t>` pieces inside the SAME `<w:r>` (same rPr) so
    // mammoth maps it back to a line break. Empty pieces contribute nothing
    // but the separator, so a segment that is only `\n` still breaks.
    const pieces = s.t.split('\n')
    const inner = pieces
      .map((piece) => {
        if (piece === '') return ''
        // WHY backticks (bug 4, RTF twin): mammoth drops Consolas styling, so
        // inline code keeps literal ` markers as text to reimport as code.
        const text = s.code ? wrapCodeTicks(piece) : piece
        const esc = docxEscape(text)
        if (esc === '') return ''
        return `<w:t xml:space="preserve">${esc}</w:t>`
      })
      .join('<w:br/>')
    if (inner === '') continue
    out += `<w:r>${rpr !== '' ? `<w:rPr>${rpr}</w:rPr>` : ''}${inner}</w:r>`
  }
  return out
}

/** Blocks → Word paragraphs. */
function exportBlocksToDocxParas(blocks: ExportBlock[]): string[] {
  // WHY literal list prefixes (round-9 unified export): real OOXML numbering
  // needs numbering.xml + abstractNum plumbing, and mammoth extracts literal
  // `- `/`1. ` text back as words — simple AND round-trips, so keep literals.
  const paras: string[] = []
  const p = (ppr: string, runs: string): string =>
    `<w:p>${ppr !== '' ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`
  const runsFor = (t: string): string => exportSegsToDocxRuns(parseExportInline(t))
  // Merge the prefix into a leading plain run so the common case stays ONE
  // <w:t> (nicer XML; mammoth concatenates runs either way).
  const prefixed = (prefix: string, t: string): string => {
    const inner = parseExportInline(t)
    const first = inner[0]
    if (
      first !== undefined &&
      !first.b && !first.i && !first.u && !first.strike && !first.mark &&
      !first.sup && !first.sub && !first.code
    ) {
      return exportSegsToDocxRuns([{ ...first, t: prefix + first.t }, ...inner.slice(1)])
    }
    return exportSegsToDocxRuns([plainSeg(prefix), ...inner])
  }
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': {
        const style = b.level <= 1 ? 'Heading1' : b.level === 2 ? 'Heading2' : 'Heading3'
        paras.push(p(`<w:pStyle w:val="${style}"/>`, runsFor(b.text)))
        break
      }
      case 'bullet':
        paras.push(p('', prefixed('- ', b.text)))
        break
      case 'ordered':
        paras.push(p('', prefixed(`${b.num}. `, b.text)))
        break
      case 'task':
        paras.push(p('', prefixed(b.checked ? '☒ ' : '☐ ', b.text)))
        break
      case 'code': {
        // WHY literal fences+lines (RTF twin): wrapCodeTicks is for genuine
        // inline code only — fences/inner lines stay literal or each line
        // reimports as inline code. Consolas styling kept for Word; text
        // goes through docxEscape only, no tick wrapping.
        const mono = (t: string): string =>
          `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${docxEscape(t)}</w:t></w:r>`
        const fence = mono('```')
        paras.push(p('', fence))
        for (const l of b.lines) {
          if (l === '') {
            paras.push('<w:p/>')
            continue
          }
          // Code lines stay literal (no inline parsing, no tick wrap).
          paras.push(p('', mono(l)))
        }
        paras.push(p('', fence))
        break
      }
      case 'quote':
        paras.push(p('<w:ind w:left="720"/>', prefixed('> ', b.text)))
        break
      case 'hr':
        // WHY literal `---` (RTF twin): an empty para reimports as a blank
        // line (marker lost); literal text round-trips and re-exports as hr.
        paras.push(p('', exportSegsToDocxRuns([plainSeg('---')])))
        break
      case 'table': {
        // WHY literal separator (round-10, bug 7 — RTF twin): see above.
        // Packet D: same nested-table flatten as RTF (no nested w:tbl in v1).
        b.rows.forEach((row, ridx) => {
          const joined: ExportSeg[] = []
          row.forEach((cell, cidx) => {
            if (cidx > 0) joined.push(plainSeg(' | '))
            joined.push(...parseExportInline(stripNestedTableHtml(cell)))
          })
          paras.push(p('', exportSegsToDocxRuns(joined)))
          if (ridx === 0) {
            paras.push(p('', exportSegsToDocxRuns([plainSeg(row.map(() => '---').join(' | '))])))
          }
        })
        break
      }
      case 'dropdown': {
        if (b.title !== '') paras.push(p('', runsFor(b.title)))
        paras.push(...exportBlocksToDocxParas(b.body))
        break
      }
      case 'para':
        paras.push(p('', runsFor(b.text)))
        break
    }
  }
  return paras
}

/**
 * Zero-dependency Markdown → .docx bytes (round-9 unified export). Minimal
 * OOXML with STORED zip entries; Word must open it and mammoth must extract
 * the words back. Images become alt text only; tables/lists use the same
 * literal conventions as the RTF path so both round-trip through Import.
 */
export function markdownToDocxBytes(markdown: string): Uint8Array {
  const paras = exportBlocksToDocxParas(parseExportBlocks(markdown))
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.join('') +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>' +
    '</w:body></w:document>'
  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
    '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
    '<w:rPr><w:b/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
    '<w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>' +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
    '<w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>' +
    '</w:styles>'
  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>'
  const relsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>'
  const enc = new TextEncoder()
  return buildStoredZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypesXml) },
    { name: '_rels/.rels', data: enc.encode(relsXml) },
    { name: 'word/document.xml', data: enc.encode(documentXml) },
    { name: 'word/styles.xml', data: enc.encode(stylesXml) },
  ])
}

// --- PDF (direct text-based export via pdf-lib) -------------------------------
// Reuses the shared parseExportBlocks / parseExportInline / wrapCodeTicks
// helpers so PDF agrees with RTF/DOCX on structure (tables as " | " lines +
// "---" separator, literal ``` fences, expanded dropdowns, literal footnote /
// subtext paras). pdf-lib is lazy-loaded INSIDE the functions below so the
// main bundle stays small (same discipline as the pdfjs/mammoth/turndown lazy
// chunks). Pure: no document/window/DOM access — pdf-lib is pure math + bytes.

/** Result of the image-aware PDF export (mirrors {@link InlineResult}). */
export interface PdfExportResult {
  bytes: Uint8Array
  inlined: string[]
  skipped: Array<{ src: string; reason: string }>
}

const PDF_PAGE_W = 595.28
const PDF_PAGE_H = 841.89
const PDF_MARGIN = 34
/** Exported for tests. */
export const PDF_CONTENT_W = PDF_PAGE_W - PDF_MARGIN * 2
const PDF_BASE_SIZE = 11
const PDF_HEADING_SIZES = [20, 17, 14, 12, 11, 10]
const PDF_CODE_SIZE = 9
const PDF_LINE_FACTOR = 1.3

/** Cell horizontal padding inside PDF table cells. Exported for tests. */
export const PDF_TABLE_PAD_X = 5
/** Cell vertical padding inside PDF table cells. Exported for tests. */
export const PDF_TABLE_PAD_Y = 4
/** Minimum column width when shrinking wide tables. Exported for tests. */
export const PDF_TABLE_MIN_COL_W = 36

/**
 * Wrap slack for table cells (consumed in `pdfDrawTable`, file-local so the
 * exported width contract of `pdfTableColumnWidths` is untouched). WHY: the
 * wrap width is the column width minus padding, but a cell whose natural width
 * EXACTLY fills its column — e.g. a bold `Col 1` header that set the column
 * natural — can still split onto two lines: the +2*PAD_X/−2*PAD_X round-trip
 * loses ~1ulp versus the summed token widths, and bold-vs-regular advances can
 * differ by ~1pt, so greedy `pdfWrapItems` sees `curW + w > avail` by dust and
 * breaks `Col 1` into `Col`/`1`. A 2pt tolerance keeps exact-fit headers on one
 * line; it stays well inside the 5pt cell padding so text never touches the
 * border, and genuinely long cells still wrap normally.
 */
const PDF_TABLE_WRAP_SLACK = 2

/**
 * WinAnsi sanitize for pdf-lib standard fonts (Helvetica/Courier): every
 * drawn string passes through here so the renderer never throws. Chars above
 * U+00FF (emoji, CJK, ☐/☒ — tasks use ASCII so they never arrive) and C0/C1
 * controls become '?'; WORDS always survive as '?' placeholders.
 */
function sanitizePdfText(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number
    if (cp < 32 || (cp >= 127 && cp <= 159) || cp > 255) out += '?'
    else out += ch
  }
  return out
}

/** Embedded standard fonts (all WinAnsi-only). `any` avoids a static pdf-lib import. */
interface PdfFonts {
  regular: any
  bold: any
  italic: any
  boldItalic: any
  mono: any
  monoBold: any
  monoItalic: any
  monoBoldItalic: any
}

interface PdfState {
  doc: any
  rgb: any
  page: any
  y: number
  fonts: PdfFonts
  imageCache: Map<string, any>
}

/** Segment → font: b/i map to Helvetica variants, code maps to Courier. */
function pdfFontForSeg(seg: ExportSeg, fonts: PdfFonts, forceBold: boolean): any {
  if (seg.code) {
    if (seg.b || forceBold) return seg.i ? fonts.monoBoldItalic : fonts.monoBold
    return seg.i ? fonts.monoItalic : fonts.mono
  }
  const b = seg.b || forceBold
  if (b && seg.i) return fonts.boldItalic
  if (b) return fonts.bold
  if (seg.i) return fonts.italic
  return fonts.regular
}

/** Measured width of already-sanitized text (falls back to ½em per char). */
function pdfTextWidth(font: any, text: string, size: number): number {
  const clean = sanitizePdfText(text)
  try {
    return font.widthOfTextAtSize(clean, size)
  } catch {
    return clean.length * size * 0.5
  }
}

const PDF_IMAGE_DATA_RE = /^data:image\/(png|jpe?g);base64,/i

/**
 * Collect embeddable PNG/JPEG data-URL images from a raw text fragment.
 * Reuses the file-local markdown image scanner so tokenizing matches the
 * inliner. SVG data URLs never match (alt text only, never embedded).
 */
function collectPdfImagesFromText(text: string): Array<{ alt: string; dataUrl: string }> {
  const out: Array<{ alt: string; dataUrl: string }> = []
  for (const t of scanMarkdownImages(text)) {
    const { src } = extractImageTarget(t.inside)
    const clean = src.trim()
    if (PDF_IMAGE_DATA_RE.test(clean)) out.push({ alt: t.alt, dataUrl: clean })
  }
  return out
}

/** Base64 data-URL payload → bytes (atob is a pure global, not DOM). */
function decodePdfDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  const b64 = dataUrl.slice(comma + 1).replace(/\s/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k)
  return out
}

function pdfNewPage(state: PdfState): void {
  state.page = state.doc.addPage([PDF_PAGE_W, PDF_PAGE_H])
  state.y = PDF_PAGE_H - PDF_MARGIN
}

/** Exported for tests. */
export interface PdfDrawRun {
  text: string
  font: any
  size: number
  u: boolean
  strike: boolean
  mark: boolean
  sup: boolean
  sub: boolean
  dy: number
}

/** Exported for tests. */
export type PdfFlowItem =
  | { kind: 'br' }
  | { kind: 'tok'; text: string; font: any; size: number; u: boolean; strike: boolean; mark: boolean; sup: boolean; sub: boolean; dy: number }

/**
 * Segments → flow items. Code segs get literal backtick markers via
 * wrapCodeTicks (same round-trip convention as RTF/DOCX); interior '\n'
 * becomes a forced break; whitespace runs collapse to single-space tokens.
 * Underline/strike/highlight flags ride on every token (including inter-word
 * spaces so `__a b__` underlines the gap, and char-split fragments
 * downstream) so the draw step can rule them. Sup/sub runs use 0.7× size
 * with a baseline shift (sup +0.35×base, sub −0.25×base; sup wins if both).
 * Exported for tests.
 */
export function pdfFlowItems(segs: ExportSeg[], fonts: PdfFonts, size: number, forceBold: boolean): PdfFlowItem[] {
  const items: PdfFlowItem[] = []
  for (const s of segs) {
    const font = pdfFontForSeg(s, fonts, forceBold)
    let tokSize = size
    let tokDy = 0
    if (s.sup) {
      tokSize = size * 0.7
      tokDy = size * 0.35
    } else if (s.sub) {
      tokSize = size * 0.7
      tokDy = size * -0.25
    }
    const pieces = s.t.split('\n')
    for (let pi = 0; pi < pieces.length; pi++) {
      if (pi > 0) items.push({ kind: 'br' })
      const piece = pieces[pi] as string
      if (piece === '') continue
      const wrapped = s.code ? wrapCodeTicks(piece) : piece
      for (const part of wrapped.split(/(\s+)/)) {
        if (part === '') continue
        if (/^\s+$/.test(part)) items.push({ kind: 'tok', text: ' ', font, size: tokSize, u: s.u, strike: s.strike, mark: s.mark, sup: s.sup, sub: s.sub, dy: tokDy })
        else items.push({ kind: 'tok', text: part, font, size: tokSize, u: s.u, strike: s.strike, mark: s.mark, sup: s.sup, sub: s.sub, dy: tokDy })
      }
    }
  }
  return items
}

/** Greedy word-wrap with char-splitting for over-long words. Exported for tests. */
export function pdfWrapItems(items: PdfFlowItem[], maxFirst: number, maxCont: number): PdfDrawRun[][] {
  const lines: PdfDrawRun[][] = []
  let cur: PdfDrawRun[] = []
  let curW = 0
  let lineIdx = 0
  const maxFor = (): number => (lineIdx === 0 ? maxFirst : maxCont)
  const pushLine = (): void => {
    while (cur.length > 0 && cur[cur.length - 1].text === ' ') {
      cur.pop()
    }
    // Recompute width after trimming (cheap: sum again).
    curW = 0
    for (const r of cur) curW += pdfTextWidth(r.font, r.text, r.size)
    lines.push(cur)
    cur = []
    curW = 0
    lineIdx++
  }
  for (const it of items) {
    if (it.kind === 'br') {
      if (cur.length > 0) pushLine()
      continue
    }
    if (it.text === ' ') {
      if (cur.length === 0) continue // no leading spaces
      const w = pdfTextWidth(it.font, ' ', it.size)
      if (curW + w > maxFor()) pushLine()
      else {
        cur.push({ text: ' ', font: it.font, size: it.size, u: it.u, strike: it.strike, mark: it.mark, sup: it.sup, sub: it.sub, dy: it.dy })
        curW += w
      }
      continue
    }
    const w = pdfTextWidth(it.font, it.text, it.size)
    if (curW + w <= maxFor()) {
      cur.push({ text: it.text, font: it.font, size: it.size, u: it.u, strike: it.strike, mark: it.mark, sup: it.sup, sub: it.sub, dy: it.dy })
      curW += w
      continue
    }
    if (cur.length === 0) {
      // Over-long word on an empty line: split by chars.
      for (const ch of it.text) {
        const cw = pdfTextWidth(it.font, ch, it.size)
        if (curW + cw > maxFor() && cur.length > 0) pushLine()
        cur.push({ text: ch, font: it.font, size: it.size, u: it.u, strike: it.strike, mark: it.mark, sup: it.sup, sub: it.sub, dy: it.dy })
        curW += cw
      }
      continue
    }
    pushLine()
    const w2 = pdfTextWidth(it.font, it.text, it.size)
    if (w2 <= maxFor()) {
      cur.push({ text: it.text, font: it.font, size: it.size, u: it.u, strike: it.strike, mark: it.mark, sup: it.sup, sub: it.sub, dy: it.dy })
      curW = w2
    } else {
      curW = 0
      for (const ch of it.text) {
        const cw = pdfTextWidth(it.font, ch, it.size)
        if (curW + cw > maxFor() && cur.length > 0) pushLine()
        cur.push({ text: ch, font: it.font, size: it.size, u: it.u, strike: it.strike, mark: it.mark, sup: it.sup, sub: it.sub, dy: it.dy })
        curW += cw
      }
    }
  }
  if (cur.length > 0) pushLine()
  return lines
}

/**
 * Draw one wrapped line's runs at (x0, yBase). Single home for the
 * mark/u/strike geometry so body text and table cells agree byte-for-byte:
 * highlight rect behind the text, text at the shifted baseline, then the
 * underline/strike rules anchored on the DRAWN baseline. Returns final x.
 */
function pdfDrawRunsAt(page: any, rgb: any, runs: PdfDrawRun[], x0: number, yBase: number): number {
  let x = x0
  for (const run of runs) {
    const txt = sanitizePdfText(run.text)
    if (txt === '') continue
    const w = pdfTextWidth(run.font, txt, run.size)
    const drawnY = yBase + (run.dy ?? 0)
    if (run.mark) {
      page.drawRectangle({
        x,
        y: drawnY - run.size * 0.25,
        width: w,
        height: run.size * 1.05,
        color: rgb(1, 1, 0.55),
        borderWidth: 0,
      })
    }
    page.drawText(txt, { x, y: drawnY, size: run.size, font: run.font, color: rgb(0, 0, 0) })
    if (run.u) {
      const uy = drawnY - run.size * 0.12
      page.drawLine({
        start: { x, y: uy },
        end: { x: x + w, y: uy },
        thickness: Math.max(0.5, run.size * 0.06),
        color: rgb(0, 0, 0),
      })
    }
    if (run.strike) {
      const sy = drawnY + run.size * 0.28
      page.drawLine({
        start: { x, y: sy },
        end: { x: x + w, y: sy },
        thickness: Math.max(0.5, run.size * 0.05),
        color: rgb(0, 0, 0),
      })
    }
    x += w
  }
  return x
}

/**
 * Draw wrapped lines; codeBg paints the light-grey code rect behind each.
 * Underlined / struck / highlighted / raised-lowered runs are drawn per-run
 * via pdfDrawRunsAt (mark rect behind, text at state.y + dy, u/strike rules
 * anchored on the drawn baseline). Visual only — pdfjs text extraction
 * ignores drawn rects/rules, so re-import yields the plain words. Line height
 * still comes from opts.size (sup/sub never expand the line). Exported for tests.
 */
export function pdfDrawLines(
  state: PdfState,
  lines: PdfDrawRun[][],
  opts: { size: number; indent: number; prefixW: number; codeBg: boolean },
): void {
  const lineH = opts.size * PDF_LINE_FACTOR
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] as PdfDrawRun[]
    if (state.y - lineH < PDF_MARGIN) pdfNewPage(state)
    state.y -= lineH
    if (opts.codeBg) {
      state.page.drawRectangle({
        x: PDF_MARGIN,
        y: state.y - 3,
        width: PDF_CONTENT_W,
        height: lineH + 1,
        color: state.rgb(0.953, 0.953, 0.945),
        borderWidth: 0,
      })
    }
    if (line.length === 0) continue
    const x = PDF_MARGIN + opts.indent + (li > 0 ? opts.prefixW : 0)
    pdfDrawRunsAt(state.page, state.rgb, line, x, state.y)
  }
}

/** Generic paragraph: prefix is one atomic token (markers never split). */
function pdfDrawPara(
  state: PdfState,
  segs: ExportSeg[],
  opts: { size: number; forceBold: boolean; indent: number; prefix: string; gapAfter: number; codeBg: boolean },
): void {
  const items = pdfFlowItems(segs, state.fonts, opts.size, opts.forceBold)
  if (opts.prefix !== '') {
    items.unshift({ kind: 'tok', text: opts.prefix, font: state.fonts.regular, size: opts.size, u: false, strike: false, mark: false, sup: false, sub: false, dy: 0 })
  }
  const prefixW = opts.prefix !== '' ? pdfTextWidth(state.fonts.regular, opts.prefix, opts.size) : 0
  const maxFirst = PDF_CONTENT_W - opts.indent
  const maxCont = PDF_CONTENT_W - opts.indent - prefixW
  const lines = pdfWrapItems(items, maxFirst, maxCont)
  if (lines.length === 0) {
    state.y -= opts.gapAfter
    if (state.y < PDF_MARGIN) pdfNewPage(state)
    return
  }
  pdfDrawLines(state, lines, { size: opts.size, indent: opts.indent, prefixW, codeBg: opts.codeBg })
  state.y -= opts.gapAfter
  if (state.y < PDF_MARGIN) pdfNewPage(state)
}

/** One literal code line (no inline parsing): preserves leading indent. */
function pdfDrawCodeLine(state: PdfState, line: string): void {
  const size = PDF_CODE_SIZE
  const lineH = size * PDF_LINE_FACTOR
  if (line === '') {
    if (state.y - lineH < PDF_MARGIN) pdfNewPage(state)
    state.y -= lineH
    state.page.drawRectangle({
      x: PDF_MARGIN,
      y: state.y - 3,
      width: PDF_CONTENT_W,
      height: lineH + 1,
      color: state.rgb(0.953, 0.953, 0.945),
      borderWidth: 0,
    })
    return
  }
  let indentSpaces = 0
  while (indentSpaces < line.length && line[indentSpaces] === ' ') indentSpaces++
  const spaceW = pdfTextWidth(state.fonts.mono, ' ', size)
  const indent = indentSpaces * spaceW
  const rest = line.slice(indentSpaces)
  const items: PdfFlowItem[] = []
  for (const part of rest.split(/(\s+)/)) {
    if (part === '') continue
    if (/^\s+$/.test(part)) items.push({ kind: 'tok', text: ' ', font: state.fonts.mono, size, u: false, strike: false, mark: false, sup: false, sub: false, dy: 0 })
    else items.push({ kind: 'tok', text: part, font: state.fonts.mono, size, u: false, strike: false, mark: false, sup: false, sub: false, dy: 0 })
  }
  const max = PDF_CONTENT_W - indent
  const lines = pdfWrapItems(items, max, max)
  if (lines.length === 0) {
    if (state.y - lineH < PDF_MARGIN) pdfNewPage(state)
    state.y -= lineH
    return
  }
  pdfDrawLines(state, lines, { size, indent, prefixW: 0, codeBg: true })
}

/**
 * Column widths for a table's raw rows (rows[0] is the header). Normalizes
 * ragged rows, measures each cell's single-line natural width (header cells
 * forceBold to match preview `th`), and either uses naturals when they fit
 * or scales proportionally with a MIN floor then renormalizes to exactly
 * PDF_CONTENT_W. Exported for tests.
 */
export function pdfTableColumnWidths(rows: string[][], fonts: PdfFonts): number[] {
  if (rows.length === 0) return []
  let cols = 0
  for (const r of rows) cols = Math.max(cols, r.length)
  if (cols === 0) return []
  const naturals: number[] = new Array(cols).fill(0)
  for (let c = 0; c < cols; c++) {
    let best = 0
    for (let r = 0; r < rows.length; r++) {
      // Packet D: measure the flattened text (same strip pdfDrawTable draws)
      // so nested-table cells size to their `a / b` fallback, not raw HTML.
      const cell = stripNestedTableHtml((rows[r] as string[])[c] ?? '')
      const items = pdfFlowItems(parseExportInline(cell), fonts, PDF_BASE_SIZE, r === 0)
      let w = 0
      for (const it of items) {
        if (it.kind === 'br') continue
        w += pdfTextWidth(it.font, it.text, it.size)
      }
      const natural = w + 2 * PDF_TABLE_PAD_X
      if (natural > best) best = natural
    }
    naturals[c] = best
  }
  const total = naturals.reduce((a, b) => a + b, 0)
  if (total <= PDF_CONTENT_W) return naturals
  // Proportional shrink with a MIN floor, then renormalize to exactly
  // PDF_CONTENT_W (clamp + rescale loop; final drift fix keeps it total-exact).
  let widths = naturals.map((n) => (n * PDF_CONTENT_W) / total)
  for (let iter = 0; iter < 10; iter++) {
    let deficit = 0
    let flexSum = 0
    for (let i = 0; i < cols; i++) {
      const w = widths[i] as number
      if (w < PDF_TABLE_MIN_COL_W) deficit += PDF_TABLE_MIN_COL_W - w
      else flexSum += w
    }
    if (deficit === 0) break
    for (let i = 0; i < cols; i++) {
      if ((widths[i] as number) < PDF_TABLE_MIN_COL_W) widths[i] = PDF_TABLE_MIN_COL_W
    }
    if (flexSum === 0) break
    for (let i = 0; i < cols; i++) {
      if ((widths[i] as number) > PDF_TABLE_MIN_COL_W) {
        widths[i] = (widths[i] as number) - deficit * ((widths[i] as number) / flexSum)
      }
    }
  }
  const sum = widths.reduce((a, b) => a + b, 0)
  if (sum !== 0) {
    const k = PDF_CONTENT_W / sum
    widths = widths.map((w) => w * k)
    const drift = PDF_CONTENT_W - widths.reduce((a, b) => a + b, 0)
    widths[cols - 1] = (widths[cols - 1] as number) + drift
  }
  return widths
}

/**
 * Draw a real bordered table grid (no `|` separators, no `---` line).
 * Ragged rows are padded with empty bordered cells; inline styles
 * (bold/code/highlight/underline/sup/sub) work via the shared
 * pdfDrawRunsAt path. Rows that don't fit break to a fresh page with the
 * header row repeated first. Exported for tests.
 */
export function pdfDrawTable(state: PdfState, rows: string[][]): void {
  if (rows.length === 0) return
  let cols = 0
  for (const r of rows) cols = Math.max(cols, r.length)
  if (cols === 0) return
  const norm: string[][] = rows.map((r) => {
    const out = r.slice()
    while (out.length < cols) out.push('')
    return out
  })
  const colWs = pdfTableColumnWidths(rows, state.fonts)
  const lineH = PDF_BASE_SIZE * PDF_LINE_FACTOR
  const cellLines = norm.map((row) => row.map(() => [] as PdfDrawRun[][]))
  for (let r = 0; r < norm.length; r++) {
    for (let c = 0; c < cols; c++) {
      // Packet D: no nested sub-grids in v1 — flatten nested-table HTML to
      // `a / b`-style text (see stripNestedTableHtml); widths above measured
      // the same fallback so layout stays consistent.
      const cell = stripNestedTableHtml((norm[r] as string[])[c] as string)
      // +WRAP_SLACK: exact-fit guard (see its comment) — without it a header
      // like `Col 1` that exactly fills its column wraps to `Col`/`1`, while
      // legitimate long cells are far past avail and still wrap normally.
      const avail = Math.max(10, (colWs[c] as number) - 2 * PDF_TABLE_PAD_X + PDF_TABLE_WRAP_SLACK)
      const items = pdfFlowItems(parseExportInline(cell), state.fonts, PDF_BASE_SIZE, r === 0)
      ;(cellLines[r] as PdfDrawRun[][][])[c] = pdfWrapItems(items, avail, avail)
    }
  }
  const rowHs: number[] = cellLines.map((cells) => {
    let ml = 1
    for (const lines of cells as PdfDrawRun[][][]) {
      const n = (lines as PdfDrawRun[][]).length === 0 ? 1 : (lines as PdfDrawRun[][]).length
      if (n > ml) ml = n
    }
    return ml * lineH + 2 * PDF_TABLE_PAD_Y
  })
  const drawRow = (rIdx: number): void => {
    const rowH = rowHs[rIdx] as number
    const rowTop = state.y
    const cells = cellLines[rIdx] as PdfDrawRun[][][]
    let cellX = PDF_MARGIN
    for (let c = 0; c < cols; c++) {
      const isHeader = rIdx === 0
      state.page.drawRectangle({
        x: cellX,
        y: rowTop - rowH,
        width: colWs[c],
        height: rowH,
        color: isHeader ? state.rgb(0.949, 0.949, 0.945) : state.rgb(1, 1, 1),
        borderColor: state.rgb(0.7, 0.7, 0.7),
        borderWidth: 0.75,
      })
      const lines = (cells[c] as PdfDrawRun[][]) ?? []
      for (let li = 0; li < lines.length; li++) {
        const yBase = rowTop - PDF_TABLE_PAD_Y - PDF_BASE_SIZE - li * lineH
        pdfDrawRunsAt(state.page, state.rgb, lines[li] as PdfDrawRun[], cellX + PDF_TABLE_PAD_X, yBase)
      }
      cellX += colWs[c] as number
    }
    state.y = rowTop - rowH
  }
  for (let r = 0; r < norm.length; r++) {
    const rh = rowHs[r] as number
    if (state.y - rh < PDF_MARGIN) {
      pdfNewPage(state)
      if (r !== 0) drawRow(0)
    }
    drawRow(r)
  }
}

/**
 * Embed PNG/JPEG images below the current cursor. Never throws: undecodable
 * bytes, unsupported kinds and oversized payloads fall back to the alt-text
 * line already drawn. Images are centered, scaled to fit the content width
 * (never upscaled) and page-break-avoid (fresh page when they don't fit).
 */
async function pdfEmbedImages(state: PdfState, images: Array<{ alt: string; dataUrl: string }>): Promise<void> {
  for (const img of images) {
    let bytes: Uint8Array
    try {
      bytes = decodePdfDataUrl(img.dataUrl)
    } catch {
      continue
    }
    const isPng = /^data:image\/png/i.test(img.dataUrl)
    const isJpg = /^data:image\/jpe?g/i.test(img.dataUrl)
    if (!isPng && !isJpg) continue
    try {
      let pdfImg = state.imageCache.get(img.dataUrl)
      if (pdfImg === undefined) {
        pdfImg = isPng ? await state.doc.embedPng(bytes) : await state.doc.embedJpg(bytes)
        state.imageCache.set(img.dataUrl, pdfImg)
      }
      const w = pdfImg.width as number
      const h = pdfImg.height as number
      if (!(w > 0 && h > 0)) continue
      const scale = Math.min(1, PDF_CONTENT_W / w, (PDF_PAGE_H - PDF_MARGIN * 2) / h)
      const sw = w * scale
      const sh = h * scale
      if (state.y - (sh + 12) < PDF_MARGIN) pdfNewPage(state)
      state.y -= sh + 4
      const x = PDF_MARGIN + (PDF_CONTENT_W - sw) / 2
      state.page.drawImage(pdfImg, { x, y: state.y, width: sw, height: sh })
      state.y -= 8
    } catch {
      continue
    }
  }
}

/** Blocks → PDF pages. `withImages` gates embedding (plain path: text only). */
async function pdfRenderBlocks(state: PdfState, blocks: ExportBlock[], withImages: boolean): Promise<void> {
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': {
        const level = Math.min(Math.max(b.level, 1), 6)
        const size = PDF_HEADING_SIZES[level - 1] as number
        const before = level === 1 ? 14 : level === 2 ? 12 : 8
        if (state.y !== PDF_PAGE_H - PDF_MARGIN) {
          state.y -= before
          if (state.y < PDF_MARGIN + size * PDF_LINE_FACTOR) pdfNewPage(state)
        }
        pdfDrawPara(state, parseExportInline(b.text), {
          size,
          forceBold: true,
          indent: 0,
          prefix: '',
          gapAfter: 6,
          codeBg: false,
        })
        if (withImages) await pdfEmbedImages(state, collectPdfImagesFromText(b.text))
        break
      }
      case 'bullet':
        pdfDrawPara(state, parseExportInline(b.text), {
          size: PDF_BASE_SIZE,
          forceBold: false,
          indent: 0,
          prefix: '- ',
          gapAfter: 2,
          codeBg: false,
        })
        if (withImages) await pdfEmbedImages(state, collectPdfImagesFromText(b.text))
        break
      case 'ordered':
        pdfDrawPara(state, parseExportInline(b.text), {
          size: PDF_BASE_SIZE,
          forceBold: false,
          indent: 0,
          prefix: `${b.num}. `,
          gapAfter: 2,
          codeBg: false,
        })
        if (withImages) await pdfEmbedImages(state, collectPdfImagesFromText(b.text))
        break
      case 'task':
        pdfDrawPara(state, parseExportInline(b.text), {
          size: PDF_BASE_SIZE,
          forceBold: false,
          indent: 0,
          prefix: b.checked ? '- [x] ' : '- [ ] ',
          gapAfter: 2,
          codeBg: false,
        })
        if (withImages) await pdfEmbedImages(state, collectPdfImagesFromText(b.text))
        break
      case 'code': {
        for (const l of ['```', ...b.lines, '```']) pdfDrawCodeLine(state, l)
        state.y -= 6
        if (state.y < PDF_MARGIN) pdfNewPage(state)
        break
      }
      case 'quote':
        pdfDrawPara(state, parseExportInline(b.text), {
          size: PDF_BASE_SIZE,
          forceBold: false,
          indent: 18,
          prefix: '> ',
          gapAfter: 6,
          codeBg: false,
        })
        if (withImages) await pdfEmbedImages(state, collectPdfImagesFromText(b.text))
        break
      case 'hr': {
        if (state.y - 22 < PDF_MARGIN) pdfNewPage(state)
        state.y -= 10
        state.page.drawLine({
          start: { x: PDF_MARGIN, y: state.y },
          end: { x: PDF_PAGE_W - PDF_MARGIN, y: state.y },
          thickness: 1,
          color: state.rgb(0.6, 0.6, 0.6),
        })
        state.y -= 10
        break
      }
      case 'table': {
        pdfDrawTable(state, b.rows)
        if (withImages) {
          for (const row of b.rows) {
            for (const cell of row) {
              const imgs = collectPdfImagesFromText(cell)
              if (imgs.length > 0) await pdfEmbedImages(state, imgs)
            }
          }
        }
        state.y -= 4
        if (state.y < PDF_MARGIN) pdfNewPage(state)
        break
      }
      case 'dropdown': {
        if (b.title !== '') {
          pdfDrawPara(state, parseExportInline(b.title), {
            size: PDF_BASE_SIZE,
            forceBold: false,
            indent: 0,
            prefix: '',
            gapAfter: 3,
            codeBg: false,
          })
          if (withImages) await pdfEmbedImages(state, collectPdfImagesFromText(b.title))
        }
        await pdfRenderBlocks(state, b.body, withImages)
        break
      }
      case 'para':
        pdfDrawPara(state, parseExportInline(b.text), {
          size: PDF_BASE_SIZE,
          forceBold: false,
          indent: 0,
          prefix: '',
          gapAfter: 6,
          codeBg: false,
        })
        if (withImages) await pdfEmbedImages(state, collectPdfImagesFromText(b.text))
        break
    }
  }
}

/** Embed the 8 standard fonts (Helvetica + Courier families). */
async function pdfEmbedFonts(doc: any, StandardFonts: any): Promise<PdfFonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
    monoBold: await doc.embedFont(StandardFonts.CourierBold),
    monoItalic: await doc.embedFont(StandardFonts.CourierOblique),
    monoBoldItalic: await doc.embedFont(StandardFonts.CourierBoldOblique),
  }
}

/**
 * Markdown → PDF bytes (text-based, selectable, re-importable via Import).
 * Empty input yields one blank page (never empty/invalid bytes).
 */
export async function markdownToPdfBytes(markdown: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const fonts = await pdfEmbedFonts(doc, StandardFonts)
  const state: PdfState = {
    doc,
    rgb,
    page: doc.addPage([PDF_PAGE_W, PDF_PAGE_H]),
    y: PDF_PAGE_H - PDF_MARGIN,
    fonts,
    imageCache: new Map(),
  }
  await pdfRenderBlocks(state, parseExportBlocks(markdown), false)
  return await doc.save()
}

/**
 * Markdown → PDF bytes with local PNG/JPG images embedded. Inlines images via
 * {@link inlineMarkdownImagesDetailed} first (inlined/skipped report is
 * returned verbatim); SVG / remote / unreadable sources fall back to their
 * alt-text lines and never throw.
 */
export async function markdownToPdfBytesWithImages(
  markdown: string,
  docPath: string | null,
  expose: (absPath: string) => Promise<string>,
): Promise<PdfExportResult> {
  const detailed = await inlineMarkdownImagesDetailed(markdown, docPath, expose)
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const fonts = await pdfEmbedFonts(doc, StandardFonts)
  const state: PdfState = {
    doc,
    rgb,
    page: doc.addPage([PDF_PAGE_W, PDF_PAGE_H]),
    y: PDF_PAGE_H - PDF_MARGIN,
    fonts,
    imageCache: new Map(),
  }
  await pdfRenderBlocks(state, parseExportBlocks(detailed.markdown), true)
  const bytes = await doc.save()
  return { bytes, inlined: detailed.inlined, skipped: detailed.skipped }
}
