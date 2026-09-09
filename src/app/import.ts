/**
 * Import pipeline (P3): convert foreign formats (HTML / PDF / DOCX / RTF /
 * plain text) to Markdown for the editor.
 *
 * Package boundary: this module owns format detection + conversion only. File
 * picking stays behind `src/platform/` (`FileIO.importFile`); UI confirmation
 * lives in `importDialog.ts`; app wiring (menu/menu.ts, app.ts) is the
 * orchestrator's packet — this module never touches menus, state, or invoke().
 *
 * Bundle discipline: the heavy converters (turndown, mammoth, pdfjs-dist) are
 * loaded with `import()` INSIDE the functions that need them, so they split
 * into lazy async chunks and the app-shell chunk stays lean (same rationale as
 * the cm-editor async chunk in vite.config.ts). `dompurify` is a static import
 * — it already ships in the app shell via export.ts, so it costs nothing here.
 *
 * SECURITY (non-negotiable, AGENTS.md): imported HTML/DOCX content is
 * untrusted. It is DOMPurify-sanitized before Turndown parses it (Turndown
 * uses DOM APIs internally) and the raw input is never injected into the DOM.
 * Text is decoded with `TextDecoder(fatal: false)` so hostile byte sequences
 * become U+FFFD instead of throwing.
 */

import DOMPurify from 'dompurify'
// Type-only: pdfVector is loaded lazily inside convertPdf (never statically —
// the app shell must not gain a new eager chunk). Types erase at build.
import type { PdfRect, PdfTableGrid } from './pdfVector'

export type ImportFormat = 'markdown' | 'txt' | 'html' | 'pdf' | 'docx' | 'rtf'

export interface ImportConversion {
  markdown: string
  /** Honest per-import data-loss notes, shown in the loss dialog. */
  losses: string[]
}

/** Map a file name to its import format by extension (case-insensitive). */
export function detectFormat(name: string): ImportFormat {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'txt':
      return 'txt'
    case 'html':
    case 'htm':
      return 'html'
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    case 'rtf':
      return 'rtf'
    default:
      // Unknown / missing extension: best-effort plain-text decode rather
      // than refusing the import.
      return 'txt'
  }
}

/**
 * Static pre-import warnings per format (shown BEFORE conversion, so the user
 * can cancel). `convertToMarkdown` may append import-specific notes (e.g. a
 * docx fallback) to the returned `losses`.
 */
export function lossSummaryFor(format: ImportFormat): string[] {
  switch (format) {
    case 'markdown':
    case 'txt':
      return []
    case 'html':
      return [
        'Scripts, styles and interactive elements are stripped (security).',
        'Page layout (multi-column, floats, positioning) becomes linear text.',
        'Images are dropped — no image files are created or linked.',
        'Embedded (data:) images are stripped — no image files are created.',
        'Exact fonts, colors and spacing are not preserved.',
      ]
    case 'pdf':
      return [
        'Only text is extracted — images are dropped; underlines, highlights and table rulings inform markup but are not preserved visually.',
        'Tables with clear ruling grids are rebuilt as Markdown tables; other layouts and columns may flatten or reorder.',
        'Bold/italic (from each font\'s style name in the PDF\'s font resources, resolved per span), headings (from relative type size) and sub/superscript (from baseline position) survive as best-effort heuristics — exact fonts, sizes and colors are not preserved.',
        'Scanned (image-only) PDFs contain no extractable text and import as empty.',
        'Password-protected PDFs cannot be imported.',
      ]
    case 'docx':
      return [
        'Embedded images are dropped — no image files are created or linked.',
        'Exact fonts, colors, spacing and page layout are not preserved.',
        'Headers, footers, footnotes and tracked changes may be simplified or dropped.',
        'Text boxes and complex floating elements may lose content or order.',
        'Word checkbox / task-list items may simplify to plain bullets when the checkbox does not survive conversion.',
      ]
    case 'rtf':
      return [
        'Converted with a minimal built-in converter: paragraphs, line breaks, bold/italic, strikethrough, sub/superscript, highlight, bullets/numbered lists and plain tables survive.',
        'Embedded images and objects are dropped.',
        'Fonts, colors and exact spacing are not preserved.',
        'Strikethrough → ~~text~~, subscript → ~text~, superscript → ^text^, highlight → ==text==.',
        'Underlined text loses its underline (Markdown has no underline); bullets normalize to "-" and numbered lists keep their numbers.',
        'Tables are flattened with " | " between cells.',
      ]
  }
}

/**
 * Convert a picked payload to Markdown. `raw` is raw bytes for binary formats
 * (pdf/docx) or decoded text for text formats — both shapes are accepted for
 * every format so Tauri and browser backends stay interchangeable.
 */
export async function convertToMarkdown(
  raw: Uint8Array | string,
  format: ImportFormat,
): Promise<ImportConversion> {
  switch (format) {
    case 'markdown':
    case 'txt':
      // Verbatim import (BOM stripped, line endings normalized); lossless.
      return { markdown: decodeText(raw), losses: [] }
    case 'html':
      return convertHtml(decodeText(raw))
    case 'docx':
      return convertDocx(toBytes(raw))
    case 'pdf':
      return convertPdf(toBytes(raw))
    case 'rtf':
      return { markdown: rtfToMarkdown(decodeText(raw)), losses: lossSummaryFor('rtf') }
  }
}

// --- byte/text helpers -----------------------------------------------------

function toBytes(raw: Uint8Array | string): Uint8Array {
  return typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
}

function decodeText(raw: Uint8Array | string): string {
  if (typeof raw === 'string') return raw
  const text = new TextDecoder('utf-8', { fatal: false }).decode(raw)
  // Strip a UTF-8 BOM and normalize CRLF/CR to LF (the editor is LF-based).
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

// --- Turndown (HTML + DOCX share it) ----------------------------------------

/** Minimal structural typing for the Turndown instance we use. */
interface TurndownRule {
  filter: string | string[] | ((node: HTMLElement, options: unknown) => boolean)
  replacement: (content: string, node: HTMLElement, options: unknown) => string
}

interface TurndownLike {
  use(plugin: (service: unknown) => void): void
  addRule(key: string, rule: TurndownRule): void
  turndown(html: string): string
}

/** Class check on a Turndown node (Turndown hands rules the raw DOM element). */
function hasClass(node: HTMLElement, name: string): boolean {
  try {
    if (node.classList !== undefined) return node.classList.contains(name)
  } catch {
    /* fall through to the attribute check */
  }
  return (node.getAttribute?.('class') ?? '').split(/\s+/).includes(name)
}

/** Attribute read on a Turndown node that never throws. */
function nodeAttr(node: HTMLElement, name: string): string {
  try {
    return node.getAttribute?.(name) ?? ''
  } catch {
    return ''
  }
}

/**
 * True for a <sup> that is really a footnote reference (markdown-it-footnote
 * renders `<sup class="footnote-ref"><a href="#fn1">…</a></sup>`), so the
 * Notedown `^sup^` rule leaves it alone for the footnote rules below.
 */
function isFootnoteSup(node: HTMLElement): boolean {
  if (hasClass(node, 'footnote-ref')) return true
  try {
    const anchor = node.querySelector?.('a[href]') ?? null
    const href = (anchor?.getAttribute?.('href') ?? '').trim()
    return /^#(fn|footnote)/i.test(href) && !/^#fnref/i.test(href)
  } catch {
    return false
  }
}

/**
 * Notedown-dialect + footnote rules layered on top of Turndown+GFM (round-7
 * C2a/C2b). Called AFTER `service.use(gfm)` — Turndown checks the most
 * recently added rule first, so these win on overlap while GFM keeps owning
 * tables/strikethrough/task-lists. Every replacement returns pure Markdown —
 * never raw HTML.
 */
function addNotedownRules(service: TurndownLike): void {
  // Footnote numbering shared by refs and definitions: explicit digits in the
  // href/id win (`#fn1` ↔ `fn1` map to the same number); numberless ids fall
  // back to encounter order.
  let footnoteSeq = 0
  const footnoteNums = new Map<string, number>()
  const footnoteNum = (key: string | null, hint: string): string => {
    const norm = (key ?? '').trim().toLowerCase()
    if (norm !== '' && footnoteNums.has(norm)) return String(footnoteNums.get(norm))
    const m = /(\d+)/.exec(hint)
    if (m?.[1] !== undefined) {
      if (norm !== '') footnoteNums.set(norm, parseInt(m[1], 10))
      return m[1]
    }
    footnoteSeq += 1
    if (norm !== '') footnoteNums.set(norm, footnoteSeq)
    return String(footnoteSeq)
  }

  // C2b — highlight: <mark> → ==text==
  service.addRule('notedownMark', {
    filter: 'mark',
    replacement: (content) => (content !== '' ? `==${content}==` : ''),
  })

  // C2b — subscript: <sub> → ~text~
  service.addRule('notedownSub', {
    filter: 'sub',
    replacement: (content) => (content !== '' ? `~${content}~` : ''),
  })

  // C2b — superscript (non-footnote): <sup> → ^text^
  service.addRule('notedownSup', {
    filter: (node) => node.nodeName === 'SUP' && !isFootnoteSup(node),
    replacement: (content) => (content !== '' ? `^${content}^` : ''),
  })

  // Underline: <u>/<ins> → __text__ (Notedown underline dialect). Turndown
  // and GFM have no <u> rule, so export-side <u> would otherwise import as
  // plain text.
  service.addRule('notedownUnderline', {
    filter: ['u', 'ins'],
    replacement: (content) => (content !== '' ? `__${content}__` : ''),
  })

  // Strikethrough: pin ~~text~~ explicitly. The bundled GFM plugin (v1.0.2)
  // emits single ~text~, which is SUBSCRIPT in our dialect — ambiguous.
  service.addRule('notedownStrikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: (content) => (content !== '' ? `~~${content}~~` : ''),
  })

  // Emphasis: pin *text* (Notedown italic dialect). Turndown defaults to
  // `_`, and `__` is UNDERLINE here — never emit `_`/`__` for em/strong
  // (strong stays on Turndown's `**` default; GFM does not touch it).
  service.addRule('notedownEm', {
    filter: ['em', 'i'],
    replacement: (content) => (content !== '' ? `*${content}*` : ''),
  })

  // Thematic break: `---` (source convention in formatting.ts); Turndown
  // defaults to `* * *`. Footnote-separator <hr>s are excluded — the
  // notedownFootnoteSep rule below owns those.
  service.addRule('notedownHr', {
    filter: (node) => node.nodeName === 'HR' && !hasClass(node, 'footnotes-sep'),
    replacement: () => '\n\n---\n\n',
  })

  // Headings: ATX like Turndown's default, but a non-empty id attribute is
  // preserved as a ` {#id}` suffix (markdown-it-attrs dialect). Id-less
  // headings render exactly as before.
  service.addRule('notedownHeadings', {
    filter: (node) => /^H[1-6]$/.test(node.nodeName),
    replacement: (content, node) => {
      const level = Number(node.nodeName.charAt(1))
      const id = nodeAttr(node, 'id').trim()
      const suffix = id !== '' ? ` {#${id}}` : ''
      return `\n\n${'#'.repeat(level)} ${content.trim()}${suffix}\n\n`
    },
  })

  // C2b — spoiler: <span class="md-spoiler"> → ||text|| (any data-revealed state).
  // Turndown hoists flanking whitespace outside the replacement, so restore a
  // single edge space inside ||…|| when the source had one (Notedown writes
  // `|| Spoiler ||`).
  service.addRule('notedownSpoiler', {
    filter: (node) => node.nodeName === 'SPAN' && hasClass(node, 'md-spoiler'),
    replacement: (content, node) => {
      if (content === '') return ''
      let raw = ''
      try {
        raw = node.textContent ?? ''
      } catch {
        raw = ''
      }
      const lead = /^[ \t\r\n]/.test(raw) ? ' ' : ''
      const trail = /[ \t\r\n]$/.test(raw) ? ' ' : ''
      return `||${lead}${content}${trail}||`
    },
  })

  // C2b — definition lists: <dl>/<dt>/<dd> → `Term\n: Definition`
  // (matches `insertDefListSpec` in formatting.ts). The dt/dd rules frame each
  // item with newlines so Turndown's join() separates them; the dl rule trims
  // the frame back off, leaving `Term\n: Def` pairs split by blank lines.
  service.addRule('notedownDefDt', {
    filter: 'dt',
    replacement: (content) => `\n\n${content.trim()}\n`,
  })
  service.addRule('notedownDefDd', {
    filter: 'dd',
    replacement: (content) => `: ${content.trim()}\n`,
  })
  service.addRule('notedownDefDl', {
    filter: 'dl',
    replacement: (content) => `\n\n${content.trim().replace(/\n{3,}/g, '\n\n')}\n\n`,
  })

  // C2b — dropdown: <details class="md-dropdown"><summary>Title</summary>… →
  // `>>> Title\n\n…\n\n>>>` (bare `>>>` when the summary is empty).
  service.addRule('notedownDropdown', {
    filter: (node) => node.nodeName === 'DETAILS' && hasClass(node, 'md-dropdown'),
    replacement: (content, node) => {
      let title = ''
      let summaryMd = ''
      try {
        const summary = node.querySelector?.('summary') ?? null
        title = (summary?.textContent ?? '').trim().split('\n')[0]?.trim() ?? ''
        if (summary !== null) {
          try {
            summaryMd = service.turndown(summary.innerHTML).trim()
          } catch {
            summaryMd = title
          }
        }
      } catch {
        title = ''
      }
      // `content` still starts with the summary's converted text — strip that
      // first occurrence so the title does not double as body text.
      let body = content.trim()
      const marker = summaryMd !== '' ? summaryMd : title
      if (marker !== '') {
        const idx = body.indexOf(marker)
        if (idx !== -1) body = `${body.slice(0, idx)}${body.slice(idx + marker.length)}`.trim()
      }
      const open = title !== '' ? `>>> ${title}` : '>>>'
      return body !== '' ? `\n\n${open}\n\n${body}\n\n>>>\n\n` : `\n\n${open}\n\n>>>\n\n`
    },
  })

  // C2b — subtext: <p class="md-subtext"> and generic <small> → `-# text`
  // prefixed per paragraph (blank lines inside stay blank).
  service.addRule('notedownSubtext', {
    filter: (node) =>
      (node.nodeName === 'P' && hasClass(node, 'md-subtext')) || node.nodeName === 'SMALL',
    replacement: (content) => {
      const text = content.trim()
      if (text === '') return ''
      const lines = text
        .split('\n')
        .map((line) => (line.trim() === '' ? '' : `-# ${line.replace(/^\s+/, '')}`))
      return `\n\n${lines.join('\n')}\n\n`
    },
  })

  // C2a — footnote refs: <a href="#fn1"> / <a href="#footnote-1"> (including
  // the <sup class="footnote-ref">-wrapped form) → [^1].
  service.addRule('notedownFootnoteRef', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false
      return /^#(?:fn\d|fn[:_-]|fn$|footnote)/i.test(nodeAttr(node, 'href').trim())
    },
    replacement: (content, node) => {
      const href = nodeAttr(node, 'href').trim()
      const text = (node.textContent ?? content ?? '').trim()
      return `[^${footnoteNum(href.replace(/^#/, ''), `${href} ${text}`)}]`
    },
  })

  // C2a — footnote backrefs (<a href="#fnref1">↩</a>) carry no content: drop
  // them (added after the ref rule so backrefs win on overlap).
  service.addRule('notedownFootnoteBackref', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false
      if (hasClass(node, 'footnote-backref')) return true
      return /^#fnref/i.test(nodeAttr(node, 'href').trim())
    },
    replacement: () => '',
  })

  // C2a — a footnote <sup> whose anchor is gone (or already converted to
  // [^n]) still becomes a footnote marker, never ^…^.
  service.addRule('notedownFootnoteSup', {
    filter: (node) => node.nodeName === 'SUP' && isFootnoteSup(node),
    replacement: (content, node) => {
      const text = content.trim()
      if (/^\[\^\d+\]$/.test(text)) return text
      const raw = (node.textContent ?? text).trim()
      const already = /(\[\^\d+\])/.exec(raw)
      if (already?.[1] !== undefined) return already[1]
      return `[^${footnoteNum(null, raw)}]`
    },
  })

  // C2a — footnote definitions (<li id="fn1">…↩</li> in section.footnotes) →
  // `[^1]: text`. Trailing backref glyphs/whitespace are stripped and internal
  // runs collapse to spaces; one definition per block.
  service.addRule('notedownFootnoteDef', {
    filter: (node) => {
      if (node.nodeName !== 'LI') return false
      if (/^fn(\d|[:_-]|$)/i.test(nodeAttr(node, 'id').trim())) return true
      try {
        return (node.closest?.('section.footnotes, ol.footnotes-list, .footnotes') ?? null) !== null
      } catch {
        return false
      }
    },
    replacement: (content, node) => {
      const id = nodeAttr(node, 'id').trim().replace(/^#/, '')
      const text = content
        .trim()
        .replace(/[ \t\r\n\u21A9\uFE00-\uFE0F]+$/u, '')
        .trim()
        .replace(/\s+/g, ' ')
      if (text === '') return ''
      return `\n\n[^${footnoteNum(id !== '' ? id : null, `${id} ${text}`)}]: ${text}\n\n`
    },
  })

  // C2a — the <hr class="footnotes-sep"> divider has no Markdown equivalent.
  service.addRule('notedownFootnoteSep', {
    filter: (node) => node.nodeName === 'HR' && hasClass(node, 'footnotes-sep'),
    replacement: () => '',
  })
}

/**
 * Lazily build a Turndown service with GFM extensions (tables, strikethrough,
 * task lists). `headingStyle: atx` + fenced code blocks match the editor's
 * own Markdown dialect.
 */
async function createTurndown(): Promise<TurndownLike> {
  // Neither package ships bundled types (@types/turndown is intentionally NOT
  // installed — keeps the dep surface minimal), so each dynamic import is
  // suppress-typed once here and narrowed to TurndownLike immediately.
  // @ts-expect-error — turndown has no bundled types; narrowed via TurndownLike below.
  const { default: TurndownService } = await import('turndown')
  // @ts-expect-error — turndown-plugin-gfm has no bundled types either.
  const { gfm } = await import('turndown-plugin-gfm')
  const Ctor = TurndownService as new (options?: Record<string, string>) => TurndownLike
  const service = new Ctor({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  service.use(gfm as (service: unknown) => void)
  addNotedownRules(service)
  return service
}

async function convertHtml(html: string): Promise<ImportConversion> {
  // SECURITY: imported HTML is untrusted — sanitize before it touches the DOM
  // (Turndown parses via DOM APIs) and never inject the raw input anywhere.
  // `details`/`summary` are allow-listed so Notedown dropdown imports survive.
  const clean = DOMPurify.sanitize(html, { ADD_TAGS: ['details', 'summary'] })
  // C2c — embedded data: URL images would otherwise convert to a giant
  // `![](data:…)` text blob. Drop them from the sanitized DOM BEFORE Turndown
  // (no image files are created on import) and record the loss below.
  const stripped = stripDataImages(clean)
  const service = await createTurndown()
  const markdown = service.turndown(stripped.html).replace(/\n{3,}/g, '\n\n').trim()
  const losses = lossSummaryFor('html')
  if (stripped.removed > 0) {
    losses.push('Embedded (data:) images were stripped — no image files were created.')
  }
  return { markdown, losses }
}

/**
 * Remove `<img src="data:…">` nodes from already-sanitized HTML (round-7
 * C2c). Parses via a detached DOMParser document — the input is never
 * injected into the live page. Normal (http/relative) images are left alone.
 */
function stripDataImages(clean: string): { html: string; removed: number } {
  try {
    const doc = new DOMParser().parseFromString(clean, 'text/html')
    const imgs = doc.querySelectorAll('img')
    let removed = 0
    imgs.forEach((img) => {
      if (/^\s*data:/i.test(img.getAttribute('src') ?? '')) {
        // Keep the alt text as plain words so the image's label survives as
        // text (no image files are created on import); the image itself is
        // still dropped and counted below.
        const alt = (img.getAttribute('alt') ?? '').trim()
        if (alt !== '') img.replaceWith(doc.createTextNode(alt))
        else img.remove()
        removed += 1
      }
    })
    return { html: doc.body.innerHTML, removed }
  } catch {
    return { html: clean, removed: 0 }
  }
}

// --- DOCX (mammoth) ----------------------------------------------------------

/**
 * DOCX reimport repair: the .docx exporter writes literal Markdown prefixes
 * (`- `, `1. `, `> `, ```` ``` ````, `---`, `[^1]`, `` `code` ``) as plain
 * <w:p> text. Mammoth maps each to a plain <p> (no list/table semantics), so
 * Turndown's escapeMarkdown escapes them (`\-`, `1\.`, `\>`, `` \` ``,
 * `\[`, `\_`) and splits every <w:p> with a blank line (fragmenting
 * tables/fences/lists). Ballot task prefixes also convert (`☐`→`-[]`, `☒`/`☑`→`-[x]`, outside fences).
 * This reverses ONLY those exporter conventions —
 * generic `*`/`_` mid-text escapes stay, so the sibling convertHtml path is
 * untouched. Idempotent on clean Markdown except intentional loose→tight
 * list/fence collapsing (still valid Markdown); `\\` literal backslashes stay.
 */
export function postprocessDocxMarkdown(md: string): string {
  if (md === '') return ''
  // Pass 1 — per-line unescapes. Fence-aware so literal code content is never
  // touched (inline/footnote/sup fixes apply outside fences only).
  const fixed: string[] = []
  let inFence = false
  for (const raw of md.split('\n')) {
    let line = fixDocxBlockStart(raw)
    if (isDocxFenceMarker(line)) {
      // Fence markers: every backtick arrived escaped (`\`\`\``) — strip the
      // single-escapes parity-aware so `\\` (literal backslash) would survive.
      line = line.replace(/(\\+)`/g, (m: string, run: string) => `${docxDropOne(run)}${m.slice(-1)}`)
      fixed.push(line)
      inFence = !inFence
      continue
    }
    if (!inFence) line = fixDocxInline(line)
    if (!inFence) line = fixDocxTaskbox(line)
    fixed.push(line)
  }
  // Pass 2 — rejoin the blank lines Turndown inserted per <w:p> between pipe
  // table rows, inside fences, and between same-kind list items.
  const out: string[] = []
  let inF = false
  let i = 0
  while (i < fixed.length) {
    const line: string = fixed[i] ?? ''
    if (isDocxFenceMarker(line)) {
      out.push(line)
      inF = !inF
      i += 1
      continue
    }
    if (inF) {
      // Inside fences Turndown's `\n\n` per paragraph is just noise — drop
      // blank lines (simplest per spec: `\n\n` → `\n` while inside fences).
      if (line.trim() === '') {
        i += 1
        continue
      }
      out.push(line)
      i += 1
      continue
    }
    if (line.trim() !== '') {
      out.push(line)
      i += 1
      continue
    }
    // Blank run outside fences — peek at the neighbours before deciding.
    let j = i + 1
    while (j < fixed.length && (fixed[j] ?? '').trim() === '') j += 1
    const prev: string = out.length > 0 ? (out[out.length - 1] ?? '') : ''
    const next: string = j < fixed.length ? (fixed[j] ?? '') : ''
    // Tables: blanks between two pipe-lines invalidate the table — drop all.
    if (prev.trim() !== '' && next.trim() !== '' && !isDocxFenceMarker(next) && prev.includes('|') && next.includes('|')) {
      i = j
      continue
    }
    // Lists: one blank between two same-kind items → tight list. Loose lists
    // stay valid so stay conservative (same kind only, single blank only).
    if (j - i === 1 && prev.trim() !== '' && next.trim() !== '') {
      const a = docxListKind(prev)
      const b = docxListKind(next)
      if (a !== null && a === b) {
        i = j
        continue
      }
    }
    // Otherwise keep a single blank (collapse longer runs).
    out.push('')
    i = j
  }
  return out.join('\n')
}

/** Strip ONE backslash from odd-length runs (Turndown single-escape); even runs (`\\` literal) stay. */
function docxDropOne(run: string): string {
  return run.length % 2 === 1 ? run.slice(1) : run
}

/**
 * True for a fence marker line in either shape: ```` ``` ```` (clean) or
 * `\`\`\`` (Turndown-escaped) plus an optional info string, nothing else.
 */
function isDocxFenceMarker(line: string): boolean {
  return /^(?:\\`|`){3,}[^`]*$/.test(line.trim())
}

/** Classify a line for the conservative same-kind list rejoin (`- `, `N. `, `☐`/`☒`, `-# `, `> `). */
function docxListKind(line: string): string | null {
  const t = line.trimStart()
  if (t.startsWith('>')) return 'blockquote'
  if (/^-#(\s|$)/.test(t)) return 'subtext'
  if (/^\d+\.\s/.test(t)) return 'ordered'
  if (/^[☐☑☒](\s|$)/.test(t)) return 'taskbox'
  if (/^-(?:\[[ xX]?\]| \[[ xX]?\])(?=\s|$)/.test(t)) return 'taskbox'
  if (/^-\s/.test(t)) return 'bullet'
  return null
}

/**
 * Line-leading unescapes for the exporter's literal prefixes. Only the FIRST
 * char was escaped by Turndown (`^-` → `\-`, `^>` → `\>`, `^N\.` → `N\.`),
 * so only the leading run is stripped, parity-aware. A `> ` prefix is split
 * off first so list/hr fixes also apply to `> \- item`-style remainders.
 */
function fixDocxBlockStart(raw: string): string {
  let line = raw.replace(/^(\s*)(\\+)>/, (_m: string, indent: string, run: string) => `${indent}${docxDropOne(run)}>`)
  const bq = /^(\s*(?:>\s?)*)(.*)$/.exec(line)
  const prefix = bq?.[1] ?? ''
  let rest = bq?.[2] ?? line
  // Nested second-level `\>` after a `> ` prefix (e.g. `> \> nested`).
  rest = rest.replace(/^(\s*)(\\+)>/, (_m: string, indent: string, run: string) => `${indent}${docxDropOne(run)}>`)
  // Subtext `-#` before bullets so `\-# Subtext` restores to `-# Subtext`.
  rest = rest.replace(/^(\s*)(\\+)-#(?=\s|$)/, (_m: string, indent: string, run: string) => `${indent}${docxDropOne(run)}-#`)
  // Bullets `\- ` → `- ` (start-anchored, so mid-line `\-` stays escaped).
  rest = rest.replace(/^(\s*)(\\+)-(?=[ \t])/, (_m: string, indent: string, run: string) => `${indent}${docxDropOne(run)}-`)
  // Ordered `1\. ` → `1. `.
  rest = rest.replace(/^(\s*)(\d+)(\\+)\.(?=[ \t])/, (_m: string, indent: string, num: string, run: string) => `${indent}${num}${docxDropOne(run)}.`)
  // HR / table separators: only the first dash was escaped (`\---` → `---`).
  rest = rest.replace(/^(\s*)(\\+)-(?=-)/, (_m: string, indent: string, run: string) => `${indent}${docxDropOne(run)}-`)
  return `${prefix}${rest}`
}

/** Inline unescapes for full lines outside fences (surgical — never global `*`/`_` unescaping). */
function fixDocxInline(line: string): string {
  let out = line
  // Inline code ticks: replace single-escape `` \` `` with `` ` `` only when
  // they form plausible spans (even count ≥ 2), parity-aware so `\\` survives.
  const tickRuns = out.match(/(\\+)`/g) ?? []
  let singles = 0
  for (const m of tickRuns) {
    if ((m.length - 1) % 2 === 1) singles += 1
  }
  if (singles >= 2 && singles % 2 === 0) {
    out = out.replace(/(\\+)`/g, (m: string, run: string) => `${docxDropOne(run)}${m.slice(-1)}`)
  }
  // Footnotes only (`\[^1\]` → `[^1]`, defs included via the same match) —
  // never bare `[text]` (would risk accidental links). Each bracket's run is
  // stripped independently so `\\[` (literal backslash) stays escaped.
  out = out.replace(/(\\*)\[\^(\d+)(\\*)\]/g, (_m: string, pre: string, num: string, post: string) => `${docxDropOne(pre)}[^${num}${docxDropOne(post)}]`)
  // Superscript/subscript `_`: Turndown escapes every `_`, so literal `^_^`
  // arrives as `^\_^`. Unescape `\_` → `_` ONLY inside `^...^` / `~...~`
  // spans (single markers — `~~strike~~` is excluded via the lookarounds).
  out = out.replace(/(?<!\^)\^([^^\n]+?)\^(?!\^)/g, (_m: string, inner: string) => `^${inner.replace(/(\\+)_/g, (_mm: string, run: string) => `${docxDropOne(run)}_`)}^`)
  out = out.replace(/(?<!~)~([^~\n]+?)~(?!~)/g, (_m: string, inner: string) => `~${inner.replace(/(\\+)_/g, (_mm: string, run: string) => `${docxDropOne(run)}_`)}~`)
  return out
}

/**
 * WHY: the exporter writes tasks as literal ballot-box prefixes (`☐ `/`☒ `)
 * as plain <w:p> text; Mammoth/Turndown pass the ballot chars through, so a
 * reimport would hold raw `☐`/`☒` instead of task tags. Convert a leading
 * ballot to its Notedown task tag (`☐` → `-[]`, `☒`/`☑` → `-[x]` — `☑` is
 * what the editor widgets use and is common in real Word docs). Start-anchored
 * with `(?=\s|$)` (mirroring the exporter's rule) so `☐glued` and mid-line
 * ballots stay literal; the separator after the ballot normalizes to one space.
 */
function fixDocxTaskbox(line: string): string {
  const m = /^(\s*(?:>\s?)*\s*)([☐☑☒])(?=\s|$)(.*)$/.exec(line)
  if (m === null) return line
  const prefix = m[1] ?? ''
  const ballot = m[2] ?? ''
  const rest = m[3] ?? ''
  const tag = ballot === '☐' ? '-[]' : '-[x]'
  if (rest.trim() === '') return `${prefix}${tag}`
  return `${prefix}${tag} ${rest.replace(/^\s+/, '')}`
}

async function convertDocx(bytes: Uint8Array): Promise<ImportConversion> {
  // mammoth is lazy-loaded (large, import-only). NOTE: mammoth performs NO
  // sanitisation of the source document, so its HTML goes through DOMPurify
  // before Turndown (SECURITY). mammoth intentionally ignores most styling and
  // emits semantic HTML — that is why the docx loss list is long by design.
  const mammoth = await import('mammoth')
  // Exact-size copy honoring byteOffset/byteLength: the incoming view may sit
  // on a larger pool (e.g. a Node Buffer slice shares its pool), so `.buffer`
  // alone could prepend unrelated bytes and corrupt the zip.
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const losses = lossSummaryFor('docx')
  try {
    // WHY: mammoth drops w:highlight without an explicit style-map rule (no
    // default mapping), so map it to <mark> which the notedownMark Turndown
    // rule converts back to ==text==. The bare `highlight` matcher
    // intentionally matches all highlight colors; exact spelling matters —
    // mammoth warns-and-ignores unknown mappings (surfaced via result.messages).
    const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: 'highlight => mark' })
    for (const message of result.messages.slice(0, 5)) losses.push(`Word warning: ${message.message}`)
    const service = await createTurndown()
    return { markdown: postprocessDocxMarkdown(service.turndown(DOMPurify.sanitize(result.value))).trim(), losses }
  } catch {
    // Formatted conversion failed (corrupt zip, legacy .doc renamed to .docx,
    // …) — still recover the words as raw text.
    const fallback = await mammoth.extractRawText({ arrayBuffer })
    losses.push('Formatted conversion failed — fell back to raw text (all formatting lost).')
    return { markdown: fallback.value.trim(), losses }
  }
}

// --- PDF (pdfjs-dist) --------------------------------------------------------

async function convertPdf(bytes: Uint8Array): Promise<ImportConversion> {
  // pdfjs-dist is lazy-loaded (the largest import dep by far). The worker is
  // resolved through Vite's `?url` import (typed via vite/client), so the
  // worker file is emitted as a hashed asset and loads identically in browser
  // dev mode and the Tauri bundle. Pinned to the pdfjs v5 line in
  // package.json — v6 may move/rename the `build/pdf.worker.min.mjs` asset.
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  // A copy: getDocument may detach/transfer the buffer it is given.
  // Encrypted/corrupt input rejects here (never hangs) — surface it as a
  // readable error so the caller can show "Import failed: …".
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | undefined
  try {
    doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  } catch (err) {
    throw readablePdfError(err)
  }
  if (doc === undefined) throw readablePdfError(new Error('empty document'))
  try {
    const pages: string[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      // Vector pass (best-effort): ruling grids → tables, horizontal rules →
      // underline/strike, standalone fills → highlight (see pdfPageToText).
      // pdfVector rides a lazy import (never an app-shell chunk); OPS comes
      // off the already-loaded pdfjs module. Any failure here (weird page,
      // odd operator stream) falls back to the text layer for that page.
      let decorations: PdfPageDecorations | undefined
      try {
        const opList = (await page.getOperatorList()) as unknown as {
          fnArray?: ArrayLike<number>
          argsArray?: ArrayLike<unknown>
        }
        const OPS = (pdfjs as unknown as { OPS?: Record<string, number> }).OPS
        if (
          OPS !== undefined &&
          opList !== null &&
          typeof opList === 'object' &&
          opList.fnArray !== undefined &&
          opList.argsArray !== undefined
        ) {
          const { analyzePdfVectors, classifyHorizontalRule } = await import('./pdfVector')
          const analysis = analyzePdfVectors(opList.fnArray, opList.argsArray, OPS)
          if (
            analysis.tables.length > 0 ||
            analysis.underlines.length > 0 ||
            analysis.highlights.length > 0
          ) {
            decorations = {
              tables: analysis.tables,
              rules: analysis.underlines,
              highlights: analysis.highlights,
              classifyRule: classifyHorizontalRule,
            }
          }
        }
      } catch {
        decorations = undefined
      }
      // Font-resource pass (best-effort, never fails the import): resolve each
      // opaque text-layer font id through page.commonObjs to its true BaseFont
      // style (see pdfCollectFontStyles). Runs AFTER getOperatorList above —
      // that call pulls the font dependencies to the main thread, which is
      // what makes the synchronous-looking commonObjs.get callbacks fire.
      try {
        const fontStyles = await pdfCollectFontStyles(
          page.commonObjs as unknown as PdfFontStore,
          pdfContentFontNames(content.items),
        ).catch(() => new Map<string, PdfFontStyle>())
        if (fontStyles.size > 0) {
          decorations = { ...(decorations ?? {}), fontStyles }
        }
      } catch {
        /* style resolution never fails the import */
      }
      const text = pdfPageToText(content.items, content.styles, decorations)
      if (text.length > 0) pages.push(text)
    }
    const markdown = pages.join('\n\n')
    const losses = lossSummaryFor('pdf')
    if (pages.length === 0) {
      // Every page extracted empty (scanned/image-only PDF) — a silent empty
      // import would look like data loss, so note it. Never throw: this is a
      // valid flow, not an import failure.
      losses.push('No extractable text found — the PDF may be a scanned or image-only PDF; nothing was imported.')
    }
    return { markdown, losses }
  } finally {
    await doc.destroy()
  }
}

/** Map a getDocument rejection to a readable import error (round-7 C4). */
function readablePdfError(err: unknown): Error {
  const msg = err instanceof Error && err.message !== '' ? err.message : String(err)
  if (/passw|encrypt/i.test(msg)) {
    return new Error(`Password-protected PDFs cannot be imported (${msg})`)
  }
  return new Error(`Could not read PDF (${msg})`)
}

/**
 * Classify a PDF font name as bold/italic (text-layer import heuristic).
 *
 * Fully generic: matches on the PostScript-style name only — an optional
 * `XXXXXX+` subset prefix (6 uppercase alphanumerics + '+') is stripped, then
 * /bold/i → bold and /italic|oblique/i → italic, so `ABCDEF+Helvetica-Bold`
 * is bold, `Times-Oblique` is italic and `Helvetica-BoldOblique` is both.
 * Anything else (regular names, empty, non-strings) is regular. Never throws.
 */
export function pdfStyleOfFont(fontName: string): { bold: boolean; italic: boolean } {
  try {
    if (typeof fontName !== 'string' || fontName === '') return { bold: false, italic: false }
    const base = fontName.replace(/^[A-Z0-9]{6}\+/, '')
    return { bold: /bold/i.test(base), italic: /italic|oblique/i.test(base) }
  } catch {
    return { bold: false, italic: false }
  }
}

/** Resolved style for one page font (from its PDF font-resource object). */
export interface PdfFontStyle {
  bold: boolean
  italic: boolean
}

/**
 * Classify a pdfjs main-thread font object as bold/italic (pure, never throws,
 * defensive reads only). OR-combines two layers:
 *
 * (a) pdfjs's own booleans when strictly `=== true` (`.bold` / `.italic` on
 *     the resolved FontFaceObject); (b) the existing {@link pdfStyleOfFont}
 *     keyword match on `.name` when it is a string (the true BaseFont, e.g.
 *     `Helvetica-Bold`, subset prefixes like `ABCDEF+Helvetica-Bold` intact —
 *     subset-prefix aware via the same `/^[A-Z0-9]{6}\+/` strip pdfjs itself
 *     uses, worker lines 26807-26808).
 *
 * Mechanism (orchestrator probe, do not re-derive): pdfjs `TextItem.fontName`
 * is opaque (`g_d0_f1`), so text-layer keyword matching can never fire on real
 * output — but after `page.getOperatorList()` runs, `page.commonObjs.get(id)`
 * resolves each id to a FontFaceObject carrying the true BaseFont as `.name`
 * plus `.bold`/`.italic` (proven: g_d0_f1 → Helvetica-Bold/bold,
 * g_d0_f2 → Helvetica/regular, g_d0_f3 → Helvetica-Oblique/italic). Anything
 * else (null, garbage, keyword-free names) classifies as regular.
 */
export function pdfClassifyFontObject(font: unknown): PdfFontStyle {
  try {
    if (typeof font !== 'object' || font === null) return { bold: false, italic: false }
    const rec = font as Record<string, unknown>
    let bold = false
    let italic = false
    try {
      if (rec['bold'] === true) bold = true
      if (rec['italic'] === true) italic = true
    } catch {
      /* ignore boolean reads */
    }
    try {
      const name = rec['name']
      if (typeof name === 'string' && name !== '') {
        const named = pdfStyleOfFont(name)
        if (named.bold) bold = true
        if (named.italic) italic = true
      }
    } catch {
      /* ignore name reads */
    }
    return { bold, italic }
  } catch {
    return { bold: false, italic: false }
  }
}

/** Structural minimum of pdfjs PDFObjects (page.commonObjs) for style resolution. */
export interface PdfFontStore {
  get(id: string, callback: (font: unknown) => void): void
}

/**
 * Distinct non-empty string `fontName`s from text items, in first-seen order
 * (pure, exported for tests). Non-object items, missing/non-string/empty
 * `fontName`s are skipped.
 */
export function pdfContentFontNames(items: readonly unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  try {
    for (const item of items) {
      let name: unknown
      try {
        name =
          typeof item === 'object' && item !== null && 'fontName' in item
            ? (item as { fontName: unknown }).fontName
            : undefined
      } catch {
        continue
      }
      if (typeof name !== 'string' || name === '' || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  } catch {
    /* untrusted shape — return what we have */
  }
  return out
}

/**
 * Resolve each distinct font id through the page font store and classify it
 * (never rejects, never hangs).
 *
 * TIMING CONTRACT: works because `convertPdf` calls it AFTER
 * `page.getOperatorList()`, which pulls the page's font dependencies to the
 * main thread — so `store.get(id, cb)` callbacks fire promptly for live ids.
 * BOUND: each id races its `get`+callback against a `timeoutMs` (default
 * 1500ms) timer; a timed-out id is simply absent from the returned map and
 * the caller treats it as regular. Ids are deduped, empties skipped, and all
 * ids resolve in parallel.
 *
 * Defensive: a null/undefined store, a non-function `store.get`, a
 * synchronously-throwing `get`, or an odd callback value all degrade to that
 * id being absent (regular) — the import never fails on style resolution.
 *
 * KNOWN LIMIT (do NOT implement): fully-obfuscated BaseFonts (random,
 * keyword-free names) cannot be classified — the raw FontDescriptor
 * (FontWeight/Flags) is not exposed on main-thread font objects and text
 * items carry no resource id to join a PDF-level parse against
 * (orchestrator-verified). Those words still survive as plain text.
 */
export async function pdfCollectFontStyles(
  store: PdfFontStore | null | undefined,
  fontNames: readonly string[],
  timeoutMs = 1500,
): Promise<Map<string, PdfFontStyle>> {
  const out = new Map<string, PdfFontStyle>()
  try {
    if (store === null || store === undefined) return out
    let getFn: unknown
    try {
      getFn = (store as PdfFontStore).get
    } catch {
      return out
    }
    if (typeof getFn !== 'function') return out
    const ids: string[] = []
    const seen = new Set<string>()
    try {
      for (const name of fontNames ?? []) {
        if (typeof name !== 'string' || name === '' || seen.has(name)) continue
        seen.add(name)
        ids.push(name)
      }
    } catch {
      return out
    }
    if (ids.length === 0) return out
    let bound = timeoutMs
    try {
      if (typeof bound !== 'number' || !Number.isFinite(bound) || bound < 0) bound = 1500
    } catch {
      bound = 1500
    }
    const get = getFn as (id: string, cb: (font: unknown) => void) => void
    const jobs = ids.map(
      (id) =>
        new Promise<{ id: string; style: PdfFontStyle } | null>((resolve) => {
          let settled = false
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            timer = setTimeout(() => {
              if (!settled) {
                settled = true
                resolve(null)
              }
            }, bound)
            // Do not pin the process on a never-firing font callback.
            try {
              const maybeUnref = (timer as unknown as { unref?: () => void }).unref
              if (typeof maybeUnref === 'function') maybeUnref.call(timer)
            } catch {
              /* browser or odd timer — ignore */
            }
          } catch {
            resolve(null)
            return
          }
          try {
            get.call(store, id, (font: unknown) => {
              if (settled) return
              settled = true
              try {
                if (timer !== undefined) clearTimeout(timer)
              } catch {
                /* ignore */
              }
              try {
                if (font === null || font === undefined) {
                  resolve(null)
                  return
                }
                resolve({ id, style: pdfClassifyFontObject(font) })
              } catch {
                resolve(null)
              }
            })
          } catch {
            if (!settled) {
              settled = true
              try {
                if (timer !== undefined) clearTimeout(timer)
              } catch {
                /* ignore */
              }
              resolve(null)
            }
          }
        }),
    )
    let results: Array<{ id: string; style: PdfFontStyle } | null>
    try {
      results = await Promise.all(jobs)
    } catch {
      return out
    }
    for (const r of results) {
      if (r !== null) out.set(r.id, r.style)
    }
    return out
  } catch {
    return out
  }
}

/** Nominal font-style lookup for a page's `styles` dict (pdfjs `TextContent.styles`). */
export interface PdfImportFontStyle {
  fontFamily?: unknown
}

/**
 * A raw styled span from one pdfjs text item. Geometry (`height`, `y`) is
 * kept alongside the text so the size/baseline heuristics can run per line;
 * `x0`/`x1` (transform[4] .. +width, user space) ride along for the
 * vector-decoration pass — absent (non-finite source) when unknown, in which
 * case the span simply skips vector marks (graceful degradation).
 */
export interface PdfRawSpan {
  text: string
  bold: boolean
  italic: boolean
  height: number
  y: number
  x0?: number
  x1?: number
}

/**
 * A line span with super/subscript resolved — the emission input. `u`,
 * `strike` and `mark` are set ONLY by the vector-decoration pass inside
 * {@link pdfPageToText} (never by {@link pdfFlagSupSub}, whose output shape
 * is pinned by tests) — absent means undecorated.
 */
export interface PdfImportSpan {
  text: string
  bold: boolean
  italic: boolean
  sup: boolean
  sub: boolean
  u?: boolean
  strike?: boolean
  mark?: boolean
}

/** Text of a pdfjs item, or null for non-text items (marked content, junk). */
function pdfItemText(item: unknown): string | null {
  if (typeof item !== 'object' || item === null || !('str' in item)) return null
  const str = (item as { str: unknown }).str
  return typeof str === 'string' ? str : null
}

/** Font name of a pdfjs item ('' when absent — classifies as regular). */
function pdfItemFontName(item: unknown): string {
  if (typeof item === 'object' && item !== null && 'fontName' in item) {
    const name = (item as { fontName: unknown }).fontName
    if (typeof name === 'string') return name
  }
  return ''
}

/** Item `height` as a finite number, else NaN (excluded from size stats). */
function pdfItemHeight(item: unknown): number {
  if (typeof item === 'object' && item !== null && 'height' in item) {
    const height = (item as { height: unknown }).height
    if (typeof height === 'number' && Number.isFinite(height)) return height
  }
  return NaN
}

/** Item `transform[4]` (x origin, user space) as a finite number, else NaN. */
function pdfItemX(item: unknown): number {
  if (typeof item === 'object' && item !== null && 'transform' in item) {
    const transform = (item as { transform: unknown }).transform
    if (Array.isArray(transform)) {
      const x = transform[4]
      if (typeof x === 'number' && Number.isFinite(x)) return x
    }
  }
  return NaN
}

/** Item advance `width` (user space) as a finite non-negative number, else NaN. */
function pdfItemWidth(item: unknown): number {
  if (typeof item === 'object' && item !== null && 'width' in item) {
    const width = (item as { width: unknown }).width
    if (typeof width === 'number' && Number.isFinite(width) && width >= 0) return width
  }
  return NaN
}

/** Item baseline `transform[5]` as a finite number, else NaN. */
function pdfItemY(item: unknown): number {
  if (typeof item === 'object' && item !== null && 'transform' in item) {
    const transform = (item as { transform: unknown }).transform
    if (Array.isArray(transform)) {
      const y = transform[5]
      if (typeof y === 'number' && Number.isFinite(y)) return y
    }
  }
  return NaN
}

function pdfItemHasEol(item: unknown): boolean | undefined {
  return typeof item === 'object' && item !== null && 'hasEOL' in item
    ? (item as { hasEOL: unknown }).hasEOL as boolean | undefined
    : undefined
}

/**
 * Resolve one item's emphasis. The item's own `fontName` wins; when it is
 * style-free (notably pdfjs v5's opaque `docId_fontId` ids, which carry no
 * style), the resolved font-resource map (`fontStyles`, from
 * `pdfCollectFontStyles` over `page.commonObjs`) is tried next, and only then
 * the page `styles` dict's `fontFamily` for that id — a generic family
 * (`sans-serif`, …) classifies as regular, so real pdfjs output never gains
 * phantom markers from this step. Direct matches keep all existing synthetic
 * tests green (style-carrying names hit first); opaque real ids fall through
 * to the map.
 */
function pdfSpanStyle(
  fontName: string,
  styles: Readonly<Record<string, PdfImportFontStyle>> | undefined,
  fontStyles?: ReadonlyMap<string, PdfFontStyle> | undefined,
): { bold: boolean; italic: boolean } {
  const direct = pdfStyleOfFont(fontName)
  if (direct.bold || direct.italic) return direct
  try {
    if (fontName !== '' && fontStyles !== undefined) {
      const hit = fontStyles.get(fontName)
      if (hit !== undefined && hit !== null && typeof hit === 'object') {
        const rec = hit as { bold?: unknown; italic?: unknown }
        return { bold: rec.bold === true, italic: rec.italic === true }
      }
    }
  } catch {
    /* untrusted map shape — fall through */
  }
  try {
    const family = fontName !== '' ? styles?.[fontName]?.fontFamily : undefined
    if (typeof family === 'string') return pdfStyleOfFont(family)
  } catch {
    /* untrusted shape — fall through to the direct result */
  }
  return direct
}

/**
 * Group text items into raw lines, preserving the legacy `hasEOL` grouping
 * (spans accumulate until an item with `hasEOL: true`, which closes the line)
 * and the legacy no-`hasEOL` fallback (everything is one line). Items without
 * a string `str` (pdfjs `TextMarkedContent` `{type,id}` shapes and any junk)
 * are skipped entirely — never emitted and never injecting phantom spaces or
 * line breaks.
 */
export function pdfItemsToRawLines(
  items: readonly unknown[],
  styles?: Readonly<Record<string, PdfImportFontStyle>>,
  fontStyles?: ReadonlyMap<string, PdfFontStyle> | undefined,
): PdfRawSpan[][] {
  const eolMode = items.some((item) => typeof pdfItemHasEol(item) === 'boolean')
  const lines: PdfRawSpan[][] = []
  let cur: PdfRawSpan[] = []
  for (const item of items) {
    const text = pdfItemText(item)
    if (text === null) continue
    const span: PdfRawSpan = {
      text,
      ...pdfSpanStyle(pdfItemFontName(item), styles, fontStyles),
      height: pdfItemHeight(item),
      y: pdfItemY(item),
    }
    // Horizontal geometry for the vector-decoration pass (rules/highlights
    // correlate against span boxes). Set only when finite — absent otherwise.
    const x0 = pdfItemX(item)
    const w = pdfItemWidth(item)
    if (Number.isFinite(x0) && Number.isFinite(w) && w > 0) {
      span.x0 = x0
      span.x1 = x0 + w
    }
    cur.push(span)
    if (eolMode && pdfItemHasEol(item) === true) {
      lines.push(cur)
      cur = []
    }
  }
  if (!eolMode || cur.length > 0) lines.push(cur)
  return lines
}

/** Median of a numeric list (NaN when empty). Even counts average the middles. */
function pdfMedian(values: readonly number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  if (sorted.length % 2 === 1) return sorted[mid] as number
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

// A span is small (super/subscript CANDIDATE) at ≤85% of the line body height
// and shifted at ≥15% of it — loose enough for any producer's script sizing
// (e.g. 70% size at ±25-35% baseline) while ignoring rounding noise.
const PDF_SUP_SUB_SIZE_RATIO = 0.85
const PDF_SUP_SUB_SHIFT_RATIO = 0.15

/**
 * Flag super/subscript spans within one line. Reference metrics come from the
 * line's own normal-size spans (median `height`/`y`), so the test is relative
 * and producer-independent: a span is sup iff it is small AND raised, sub iff
 * small AND lowered; small-but-unshifted spans stay plain. A line with no
 * normal-size reference (empty, zero-height or uniformly tiny items) keeps
 * every span plain, avoiding whole-line misfires.
 */
export function pdfFlagSupSub(line: readonly PdfRawSpan[]): PdfImportSpan[] {
  const plain = (s: PdfRawSpan): PdfImportSpan => ({
    text: s.text,
    bold: s.bold,
    italic: s.italic,
    sup: false,
    sub: false,
  })
  // Fake-space/degenerate items (height ≤ 0) carry no size information:
  // pdfjs emits inter-word gaps as zero-height space items, and letting one
  // into the pool drags medH onto script-sized spans — blinding detection
  // (real-world case: `H^up^` measured medH 7.7 instead of 11, so the 7.7pt
  // script failed its own candidacy gate). Exclude them up front.
  const pool = line.filter((s) => s.text.length > 0 && Number.isFinite(s.height) && s.height > 0)
  if (pool.length === 0) return line.map(plain)
  const medH = pdfMedian(pool.map((s) => s.height))
  if (!Number.isFinite(medH) || medH <= 0) return line.map(plain)
  const normalSet = new Set(pool.filter((s) => s.height > PDF_SUP_SUB_SIZE_RATIO * medH))
  if (normalSet.size === 0) return line.map(plain)
  const normals = [...normalSet]
  const baseH = pdfMedian(normals.map((s) => s.height))
  const baseY = pdfMedian(normals.map((s) => s.y).filter((y) => Number.isFinite(y)))
  if (!Number.isFinite(baseH) || baseH <= 0 || !Number.isFinite(baseY)) return line.map(plain)
  return line.map((s) => {
    const out = plain(s)
    // Only non-normal spans with real (positive) size are script candidates:
    // zero-height items (pdfjs inter-word fake spaces) carry no size
    // information and must never classify — one once dragged its own shifted
    // baseline into a superscript and split `^up^` into `^up ^`.
    if (normalSet.has(s) || !Number.isFinite(s.y) || !(s.height > 0)) return out
    if (s.height <= PDF_SUP_SUB_SIZE_RATIO * baseH && s.y - baseY >= PDF_SUP_SUB_SHIFT_RATIO * baseH) {
      out.sup = true
    } else if (s.height <= PDF_SUP_SUB_SIZE_RATIO * baseH && baseY - s.y >= PDF_SUP_SUB_SHIFT_RATIO * baseH) {
      out.sub = true
    }
    return out
  })
}

/**
 * Page body-size reference: median `height` of normal (non-sup/sub) spans
 * with text, across the page. Sup/sub candidates are excluded so a page heavy
 * with scripts cannot drag the reference down and inflate plain lines into
 * headers. NaN when the page has no measurable body text (no headers then).
 */
export function pdfPageBodyMedian(
  rawLines: readonly (readonly PdfRawSpan[])[],
  flaggedLines: readonly (readonly PdfImportSpan[])[],
): number {
  const heights: number[] = []
  rawLines.forEach((line, i) => {
    const flagged = flaggedLines[i]
    line.forEach((s, j) => {
      const f = flagged?.[j]
      // Zero-height spans (pdfjs fake-space items) carry no size information
      // and are numerous enough to drag the median down to ~half the body
      // size — which would promote every body line to a header. Skip them.
      if (f !== undefined && !f.sup && !f.sub && s.text.length > 0 && Number.isFinite(s.height) && s.height > 0) {
        heights.push(s.height)
      }
    })
  })
  return pdfMedian(heights)
}

// Header bands are deliberately conservative: every judged span must clear
// 1.15× the body, so mixed-size lines never promote.
const PDF_HEADER_MIN_RATIO = 1.15
const PDF_HEADER_H1_RATIO = 1.6
const PDF_HEADER_H2_RATIO = 1.35

/**
 * Header level for one line from its normal-span heights (see rationale
 * below). Returns 0 (body) when the line has no judged span or any judged
 * span is body-sized.
 *
 * RATIONALE (generic, conservative): real PDFs signal headings with larger
 * type, but absolute sizes vary by producer (10pt vs 12pt bodies, A4 vs
 * Letter layouts), so the test is RELATIVE to the page's own body median
 * instead of matching any fixed point size. Requiring EVERY normal span in
 * the line to clear 1.15× the body keeps mixed-size body lines (e.g. a large
 * drop-cap or inline logo text) from promoting; the level follows the
 * largest span (≥1.6 → `#`, ≥1.35 → `##`, else `###`). A page with no
 * measurable body (NaN/zero median) yields no headers rather than a guess.
 */
export function pdfHeaderLevel(
  normalHeights: readonly number[],
  bodyMedian: number,
): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(bodyMedian) || bodyMedian <= 0 || normalHeights.length === 0) return 0
  if (!normalHeights.every((h) => h >= PDF_HEADER_MIN_RATIO * bodyMedian)) return 0
  const maxRatio = Math.max(...normalHeights) / bodyMedian
  if (maxRatio >= PDF_HEADER_H1_RATIO) return 1
  if (maxRatio >= PDF_HEADER_H2_RATIO) return 2
  return 3
}

/**
 * Wrap one merged span's text; '' when there is nothing (or only air) to mark.
 *
 * Marker precedence is fixed outer→inner: emphasis (`**`/`*`/`***`), then
 * strikethrough (`~~`), underline (`__`), highlight (`==`), with the script
 * marker (`^`/`~`) innermost so it stays adjacent to the text
 * (`**^x^**`, `__==x==__`, …). Every layer nests through the Notedown export
 * parser (verified: `**`, `__`, `~~`, `==` multi-char runs plus single-char
 * `^`/`~`/`*` all recurse), so emission round-trips back through export.
 */
function pdfWrapImportSpan(g: PdfImportSpan): string {
  if (g.text === '') return '' // never emit empty pairs (`****`, `^^^^`, …)
  const markers: string[] = []
  if (g.bold && g.italic) markers.push('***')
  else if (g.bold) markers.push('**')
  else if (g.italic) markers.push('*')
  if (g.strike === true) markers.push('~~')
  if (g.u === true) markers.push('__')
  if (g.mark === true) markers.push('==')
  if (g.sup) markers.push('^')
  else if (g.sub) markers.push('~')
  if (markers.length === 0) return g.text
  if (/^\s*$/.test(g.text)) return g.text // whitespace-only → bare, never `** **`-style pairs
  // Flanking whitespace stays OUTSIDE the markers (Turndown convention):
  // pdfjs emits inter-word gaps as separate space items that inherit the
  // neighboring font, so a bold word arrives as `bold`+` ` merged — wrapping
  // the pair whole would leak the space inside (`**bold **`).
  const lead = /^[\s]*/.exec(g.text)?.[0] ?? ''
  const trail = /[\s]*$/.exec(g.text)?.[0] ?? ''
  const core = g.text.slice(lead.length, g.text.length - trail.length)
  if (core === '') return g.text
  let out = core
  for (let k = markers.length - 1; k >= 0; k--) out = `${markers[k]}${out}${markers[k]}`
  return `${lead}${out}${trail}`
}

/**
 * Render one flagged line: merge adjacent spans with identical
 * (bold,italic,sup,sub), wrap each group (`**`/`*`/`***`, `^`/`~`), join
 * normal spans with single spaces (legacy behavior) while super/subscript
 * groups attach DIRECTLY to the previous span (one pending join space popped,
 * none added around the marker), then collapse whitespace runs, trim, drop
 * empties, and prefix any header level. Words stay verbatim — only markers
 * are added.
 */
export function pdfRenderLine(spans: readonly PdfImportSpan[], headerLevel: 0 | 1 | 2 | 3): string {
  const groups: PdfImportSpan[] = []
  for (const s of spans) {
    const g = groups[groups.length - 1]
    if (
      g !== undefined &&
      g.bold === s.bold &&
      g.italic === s.italic &&
      g.sup === s.sup &&
      g.sub === s.sub &&
      (g.u ?? false) === (s.u ?? false) &&
      (g.strike ?? false) === (s.strike ?? false) &&
      (g.mark ?? false) === (s.mark ?? false)
    ) {
      g.text += s.text
    } else {
      groups.push({ ...s })
    }
  }
  // Redundant full-line emphasis: a header whose EVERY word shares one
  // emphasis style renders bold/italic by virtue of being a header (and our
  // own exporter force-bolds all headings), so `# **Title**` carries nothing
  // `# Title` lacks — drop it for clean round-trips. Partial emphasis
  // (`# A **bold** word`) is meaningful and kept, as are scripts/decorations.
  if (headerLevel > 0) {
    const words = groups.filter((g) => g.text.trim() !== '')
    if (
      words.length > 0 &&
      words.every((g) => g.bold === words[0]?.bold && g.italic === words[0]?.italic) &&
      ((words[0]?.bold ?? false) || (words[0]?.italic ?? false))
    ) {
      for (const g of words) {
        g.bold = false
        g.italic = false
      }
    }
  }
  let out = ''
  for (const g of groups) {
    const styled = pdfWrapImportSpan(g)
    if (styled === '') continue
    if (g.sup || g.sub) {
      out = out.replace(/ $/, '') + styled
    } else {
      out += (out === '' ? '' : ' ') + styled
    }
  }
  const line = out.replace(/\s+/g, ' ').trim()
  if (line === '') return ''
  return headerLevel > 0 ? `${'#'.repeat(headerLevel)} ${line}` : line
}

/**
 * Optional vector-layer decorations for {@link pdfPageToText}, produced by
 * the orchestrator from `analyzePdfVectors` (src/app/pdfVector.ts, lazy).
 * All geometry is PDF user space (pt, y-up) — the same space as text-item
 * transforms (proven by the pdf-vector round-trip test). Every match is
 * conservative: spans without finite geometry are skipped, and anything
 * ambiguous falls back to plain text. `rules` without `classifyRule` are
 * ignored (the classifier lives in pdfVector, which import.ts must not
 * statically import — bundle discipline).
 */
export interface PdfPageDecorations {
  /** Ruling grids → rebuilt Markdown tables (rejected grids flatten as before). */
  tables?: readonly PdfTableGrid[]
  /** Non-grid horizontal rules → underline/strike via `classifyRule`. */
  rules?: readonly PdfRect[]
  /** Standalone fills → `==highlight==` (table-cell fills never reach here). */
  highlights?: readonly PdfRect[]
  /** pdfVector.classifyHorizontalRule, passed in by the (async) caller. */
  classifyRule?: (rule: PdfRect, baseY: number, size: number) => 'underline' | 'strike' | 'none'
  /** Resolved per-font styles from `page.commonObjs` (bold/italic by font id). */
  fontStyles?: ReadonlyMap<string, PdfFontStyle>
}

/** One word's char range plus its proportional x-range inside the span box. */
interface PdfWordBox {
  /** Char offsets into the span text ([w0, w1), non-space run). */
  w0: number
  w1: number
  /** Proportional x-range (monospace assumption — containment slack absorbs drift). */
  x0: number
  x1: number
}

/**
 * Split span text into word boxes. pdfjs merges same-font runs, so one span
 * often holds a whole line (`ul and st`); per-word boxes let rules mark the
 * decorated words instead of all-or-nothing whole-span marking.
 */
function pdfSpanWords(text: string, x0: number, x1: number): PdfWordBox[] {
  const out: PdfWordBox[] = []
  const n = text.length
  if (n === 0 || !(x1 > x0)) return out
  for (const m of text.matchAll(/\S+/g)) {
    const w0 = m.index ?? 0
    const w1 = w0 + m[0].length
    out.push({ w0, w1, x0: x0 + (w0 / n) * (x1 - x0), x1: x0 + (w1 / n) * (x1 - x0) })
  }
  return out
}

// A rule marks a word when it covers the word's proportional x-range (±25%
// of the word width slack for proportional-font drift). Whole-word rules —
// the dominant case (per-word export rules, Word/LibreOffice runs) — match
// exactly; partial-word rules conservatively mark nothing.
const PDF_WORD_COVER_SLACK = 0.25

/** True when a rule covers a word box (see slack rationale above). */
function pdfRuleCoversWord(rule: PdfRect, word: PdfWordBox): boolean {
  const slack = PDF_WORD_COVER_SLACK * (word.x1 - word.x0)
  return rule.x0 <= word.x0 + slack && rule.x1 >= word.x1 - slack
}

/**
 * Split one span into ordered pieces, marking words covered by vector
 * decorations (pieces inherit every flag of the source span). Spaces and
 * uncovered words stay plain; adjacent same-mark words merge downstream in
 * {@link pdfRenderLine}. Returns [f] untouched when nothing applies, so
 * single-word spans behave exactly like whole-span marking.
 */

/**
 * A highlight covers a word when the word's proportional x-range sits inside
 * the fill (± the same word slack) and the text baseline band crosses it
 * (1pt tolerance). Center-band (not area-overlap) so per-word rects match
 * while full-bleed shade bands are judged by the width guard at the call site.
 */
function pdfHighlightCoversWord(
  hl: PdfRect,
  word: PdfWordBox,
  baseY: number,
  size: number,
): boolean {
  const slack = PDF_WORD_COVER_SLACK * (word.x1 - word.x0)
  if (!(hl.x0 <= word.x0 + slack && hl.x1 >= word.x1 - slack)) return false
  const cy = baseY + 0.3 * size
  return cy >= hl.y0 - 1 && cy <= hl.y1 + 1
}

/** Median y of a line's placed spans (NaN when the line has no geometry). */
function pdfLineY(line: readonly PdfRawSpan[]): number {
  const ys = line
    .filter((s) => s.text.trim() !== '' && Number.isFinite(s.y))
    .map((s) => s.y as number)
    .sort((a, b) => a - b)
  if (ys.length === 0) return NaN
  const mid = ys.length >> 1
  return ys.length % 2 === 1 ? (ys[mid] as number) : (((ys[mid - 1] as number) + (ys[mid] as number)) / 2)
}

/** Text extent (min x0 .. max x1) of a line's boxed spans, or null. */
function pdfLineExtent(line: readonly PdfRawSpan[]): { x0: number; x1: number } | null {
  let x0 = Infinity
  let x1 = -Infinity
  for (const s of line) {
    if (s.text.trim() === '' || !Number.isFinite(s.x0) || !Number.isFinite(s.x1)) continue
    const a = s.x0 as number
    const b = s.x1 as number
    if (!(b > a)) continue
    if (a < x0) x0 = a
    if (b > x1) x1 = b
  }
  return x1 > x0 ? { x0, x1 } : null
}

// Full-bleed shade bands (code-block backgrounds, paragraph shading, …) are
// geometrically identical to highlights: a fill spanning ~the whole line.
// Our highlight fills hug their runs, so a fill is only eligible when it is
// no wider than the line's own text plus a small padding allowance.
const PDF_HIGHLIGHT_LINE_PAD = 16

/**
 * Stamp vector marks onto flagged spans, splitting merged multi-word spans
 * into marked/plain pieces (mutates `flaggedLines` in place — the arrays are
 * freshly created per {@link pdfPageToText} call; table-member lines are
 * skipped so grid borders can never misfire and index correspondence holds
 * for the table path).
 */
function pdfApplyVectorMarks(
  rawLines: readonly (readonly PdfRawSpan[])[],
  flaggedLines: PdfImportSpan[][],
  decorations: PdfPageDecorations,
  memberLines: ReadonlySet<number>,
): void {
  const rules = decorations.rules ?? []
  const highlights = decorations.highlights ?? []
  const classifyRule = decorations.classifyRule
  if (rules.length === 0 && highlights.length === 0) return
  rawLines.forEach((line, i) => {
    if (memberLines.has(i)) return
    const extent = highlights.length > 0 ? pdfLineExtent(line) : null
    const out: PdfImportSpan[] = []
    line.forEach((s, j) => {
      const f = flaggedLines[i]?.[j]
      if (f === undefined) return
      out.push(...pdfMarkSpanPieces(s, f, rules, highlights, classifyRule, extent))
    })
    flaggedLines[i] = out
  })
}

/**
 * Split one span around vector decorations. Each word fully covered by a
 * rule becomes `__`/`~~` (via `classifyRule` against the span's own baseline
 * — shifted baselines for sup/sub match the exporter's anchoring); each word
 * inside a hugging fill becomes `==`. Uncovered text (including all spaces)
 * stays plain. Pieces inherit every flag of `f`, so `__^x^__` and friends
 * compose through the normal merge/wrap path. Returns `[f]` untouched when
 * nothing applies.
 */
function pdfMarkSpanPieces(
  s: PdfRawSpan,
  f: PdfImportSpan,
  rules: readonly PdfRect[],
  highlights: readonly PdfRect[],
  classifyRule: PdfPageDecorations['classifyRule'],
  lineExtent: { x0: number; x1: number } | null,
): PdfImportSpan[] {
  if (s.text === '' || !Number.isFinite(s.y) || !Number.isFinite(s.height) || !(s.height > 0)) return [f]
  if (!Number.isFinite(s.x0) || !Number.isFinite(s.x1)) return [f]
  const x0 = s.x0 as number
  const x1 = s.x1 as number
  if (!(x1 > x0)) return [f]
  const y = s.y as number
  const h = s.height as number
  const words = pdfSpanWords(s.text, x0, x1)
  if (words.length === 0) return [f]
  const kinds = words.map(() => ({ u: false, strike: false, mark: false }))
  words.forEach((word, wi) => {
    const kind = kinds[wi] as { u: boolean; strike: boolean; mark: boolean }
    if (classifyRule !== undefined) {
      for (const rule of rules) {
        if (!pdfRuleCoversWord(rule, word)) continue
        const cls = classifyRule(rule, y, h)
        if (cls === 'underline') kind.u = true
        else if (cls === 'strike') kind.strike = true
      }
    }
    for (const hl of highlights) {
      // Width guard: reject full-bleed shade bands (code-block backgrounds,
      // paragraph shading) — genuine highlight fills hug their runs.
      if (lineExtent !== null && hl.x1 - hl.x0 > lineExtent.x1 - lineExtent.x0 + PDF_HIGHLIGHT_LINE_PAD) continue
      if (pdfHighlightCoversWord(hl, word, y, h)) {
        kind.mark = true
        break
      }
    }
  })
  if (kinds.every((k) => !k.u && !k.strike && !k.mark)) return [f]
  // Cut pieces at kind boundaries: marked words exactly, plain runs (words +
  // spaces) extended to the next marked word so gaps stay merge-friendly.
  const owner = new Array<number>(s.text.length).fill(-1)
  words.forEach((word, wi) => {
    for (let k = word.w0; k < word.w1; k++) owner[k] = wi
  })
  const out: PdfImportSpan[] = []
  const push = (text: string, kind: { u: boolean; strike: boolean; mark: boolean } | null): void => {
    if (text === '') return
    if (kind === null) out.push({ ...f, text })
    else {
      const piece: PdfImportSpan = { ...f, text }
      if (kind.u) piece.u = true
      if (kind.strike) piece.strike = true
      if (kind.mark) piece.mark = true
      out.push(piece)
    }
  }
  let k = 0
  while (k < s.text.length) {
    const wi = owner[k] as number
    if (wi < 0) {
      let e = k + 1
      while (e < s.text.length && (owner[e] as number) < 0) e++
      push(s.text.slice(k, e), null)
      k = e
      continue
    }
    const kind = kinds[wi] as { u: boolean; strike: boolean; mark: boolean }
    if (!kind.u && !kind.strike && !kind.mark) {
      let e = (words[wi] as PdfWordBox).w1
      while (e < s.text.length) {
        const nwi = owner[e] as number
        if (nwi < 0) {
          e++
          continue
        }
        const nk = kinds[nwi] as { u: boolean; strike: boolean; mark: boolean }
        if (nk.u || nk.strike || nk.mark) break
        e = (words[nwi] as PdfWordBox).w1
      }
      push(s.text.slice(k, e), null)
      k = e
      continue
    }
    const w = words[wi] as PdfWordBox
    push(s.text.slice(w.w0, w.w1), kind)
    k = w.w1
  }
  return out.length > 0 ? out : [f]
}

/** One accepted grid plus its member line indexes (stream order). */
interface PdfDetectedTable {
  grid: PdfTableGrid
  members: number[]
}

/** Column index for a span center, or -1 when outside every column. */
function pdfTableColumn(grid: PdfTableGrid, cx: number): number {
  for (let k = 0; k < grid.cols; k++) {
    const lo = grid.colEdges[k] as number
    const hi = grid.colEdges[k + 1] as number
    if (cx >= lo - 1 && cx <= hi + 1) return k
  }
  return -1
}

/** Escape pipes + collapse whitespace for a table cell (single-line). */
function pdfTableCellText(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

/** Render one cell's spans; header-row cells drop uniform full-cell emphasis.
 *
 * Same rationale as the header strip in {@link pdfRenderLine}: markdown table
 * headers render bold regardless of markers, so uniform `**`/`*` across a
 * whole header cell (notably our own exporter's force-bold header row) is
 * noise — `| a |` round-trips cleaner than `| **a** |`. Partial emphasis
 * (`| **key** | value |`) is meaningful and kept, as is every body cell.
 */
function pdfTableCellMarkdown(parts: readonly PdfImportSpan[], headerRow: boolean): string {
  let list = parts
  if (headerRow) {
    const words = parts.filter((p) => p.text.trim() !== '')
    if (
      words.length > 0 &&
      words.every((p) => p.bold === words[0]?.bold && p.italic === words[0]?.italic) &&
      ((words[0]?.bold ?? false) || (words[0]?.italic ?? false))
    ) {
      list = parts.map((p) => ({ ...p, bold: false, italic: false }))
    }
  }
  return list
    .map((p) => pdfWrapImportSpan(p))
    .filter((c) => c !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Row-band tolerance (pt, PDF user space, y-up): matches the ±2pt y-range
// slack in pdfDetectTables, so a line claimed for a grid always lands in a
// band and band edges agree with the claim window.
const PDF_TABLE_BAND_TOL = 2

/**
 * Grid row band containing a line baseline, or -1 when outside every band.
 *
 * `grid.rowEdges` ascends y-up, so band r spans
 * `[rowEdges[r], rowEdges[r+1]]`, widened by PDF_TABLE_BAND_TOL on each side.
 * A y within tolerance of a shared edge matches two bands — the nearest band
 * center wins, which keeps wrapped lines (well inside their grown row, far
 * from any edge) deterministically in their own row. Non-finite y or a
 * malformed edge list yields -1 (caller rejects the grid conservatively).
 */
function pdfTableRowBand(grid: PdfTableGrid, y: number): number {
  if (!Number.isFinite(y)) return -1
  const edges = grid.rowEdges
  if (!Array.isArray(edges) || edges.length < 2) return -1
  const count = Math.min(grid.rows, edges.length - 1)
  if (!(count >= 1)) return -1
  let best = -1
  let bestDist = Infinity
  for (let r = 0; r < count; r++) {
    const lo = edges[r] as number
    const hi = edges[r + 1] as number
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
    if (y < lo - PDF_TABLE_BAND_TOL || y > hi + PDF_TABLE_BAND_TOL) continue
    const dist = Math.abs(y - (lo + hi) / 2)
    if (dist < bestDist) {
      bestDist = dist
      best = r
    }
  }
  return best
}

/**
 * Render one grid's Markdown rows (top-down) from member lines, or null to
 * reject the grid (caller falls back to normal line emission). Conservative:
 * every non-blank span must sit inside a column, and at least two non-empty
 * rows must survive — single-row "tables" and ragged leftovers flatten.
 *
 * ROW-BAND MERGE (why not 1-line-1-row): the exporter grows row heights for
 * wrapped cells (pdfDrawTable multi-line cells), so one grid row can hold
 * several visual lines — e.g. a narrow header cell wrapping as `Col` on one
 * line and `1` on the next, each with hasEOL. Treating each rawLine as its own
 * Markdown row would split that header into diagonal fragments (`| Col | |`,
 * `| | **Col** |`, …) and strand the bold strip on the first fragment only.
 * Instead, each member line is assigned to its grid row band (consecutive
 * rowEdges, via pdfLineY) and all lines in one band merge into ONE Markdown
 * row: per-column buckets accumulate top-down (highest y first) and
 * pdfTableCellMarkdown joins them with a single space, so `Col` + `1` in the
 * same column becomes `Col 1`. Single-line rows hold one line per band, which
 * is exactly the old behavior (byte-identical output).
 */
function pdfRenderDetectedTable(
  grid: PdfTableGrid,
  members: Array<{ spans: readonly PdfImportSpan[]; raw: readonly PdfRawSpan[] }>,
): string | null {
  // Group member lines by row band first; emission below walks bands top-down
  // (highest band index first — rowEdges ascend y-up).
  const byBand = new Map<number, Array<{ spans: readonly PdfImportSpan[]; raw: readonly PdfRawSpan[] }>>()
  for (const m of members) {
    let hasText = false
    for (const s of m.raw) {
      if (s.text.trim() !== '') {
        hasText = true
        break
      }
    }
    if (!hasText) continue // all-blank line: drop it, keep the table
    const band = pdfTableRowBand(grid, pdfLineY(m.raw))
    if (band < 0) return null // text outside every row band: reject the grid
    const list = byBand.get(band)
    if (list !== undefined) list.push(m)
    else byBand.set(band, [m])
  }
  const bands = [...byBand.keys()].sort((a, b) => b - a)
  const rows: string[][] = []
  for (const band of bands) {
    // Lines within one band merge top-down (highest baseline first); the
    // sort is stable, so same-y lines keep stream order. The caller already
    // passes members top-down, making this a no-op there — it pins the merge
    // rule for any other caller.
    const group = [...(byBand.get(band) ?? [])].sort((a, b) => {
      const ya = pdfLineY(a.raw)
      const yb = pdfLineY(b.raw)
      if (Number.isFinite(ya) && Number.isFinite(yb) && ya !== yb) return (yb as number) - (ya as number)
      return 0
    })
    const buckets: PdfImportSpan[][] = Array.from({ length: grid.cols }, () => [])
    let placed = false
    let ok = true
    for (const m of group) {
      m.raw.forEach((s, j) => {
        if (!ok || s.text.trim() === '') return
        if (!Number.isFinite(s.x0) || !Number.isFinite(s.x1)) {
          ok = false
          return
        }
        const k = pdfTableColumn(grid, (((s.x0 as number) + (s.x1 as number)) / 2))
        if (k < 0) {
          ok = false
          return
        }
        const f = m.spans[j]
        ;(buckets[k] as PdfImportSpan[]).push(
          f === undefined
            ? { text: s.text, bold: false, italic: false, sup: false, sub: false }
            : { ...f },
        )
        placed = true
      })
      if (!ok) break
    }
    if (!ok) return null
    if (!placed) continue // all-blank band: drop it, keep the table
    // The first kept band is the header (uniform full-cell emphasis is
    // redundant there — see pdfTableCellMarkdown).
    const headerRow = rows.length === 0
    rows.push(
      buckets.map((parts) =>
        pdfTableCellText(pdfTableCellMarkdown(parts, headerRow)),
      ),
    )
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c !== ''))
  if (nonEmpty.length < 2) return null
  const out = nonEmpty.map((r) => `| ${r.join(' | ')} |`)
  out.splice(1, 0, `| ${nonEmpty[0]?.map(() => '---').join(' | ') ?? '---'} |`)
  return out.join('\n')
}

/**
 * Match grids to member lines. A line joins a grid when its baseline sits
 * inside the grid's y-range (±2pt) and every placed span sits inside the
 * grid's x-range — anything straddling rejects the grid (conservative:
 * multi-column prose has no rulings, so grids only ever come from real
 * tables or bordered art). Each line is claimed by at most one grid.
 */
function pdfDetectTables(
  rawLines: readonly (readonly PdfRawSpan[])[],
  grids: readonly PdfTableGrid[],
): PdfDetectedTable[] {
  const out: PdfDetectedTable[] = []
  const claimed = new Set<number>()
  for (const grid of grids) {
    if (!(grid.cols >= 2 && grid.rows >= 2)) continue
    const members: number[] = []
    let ok = true
    rawLines.forEach((line, i) => {
      if (!ok || claimed.has(i)) return
      const y = pdfLineY(line)
      if (!Number.isFinite(y) || y < grid.y0 - 2 || y > grid.y1 + 2) return
      let hasText = false
      for (const s of line) {
        if (s.text.trim() === '') continue
        hasText = true
        if (!Number.isFinite(s.x0) || !Number.isFinite(s.x1)) {
          ok = false
          break
        }
        const cx = (((s.x0 as number) + (s.x1 as number)) / 2)
        if (cx < grid.x0 - 2 || cx > grid.x1 + 2) {
          ok = false
          break
        }
      }
      if (ok && hasText) members.push(i)
    })
    if (!ok || members.length === 0) continue
    members.forEach((i) => claimed.add(i))
    out.push({ grid, members })
  }
  return out
}

/**
 * Reconstruct one page's Markdown from pdfjs text items (round-7 C4, Packet A
 * text-layer styles, vector decorations + tables).
 *
 * Text layer: spans group into lines on `hasEOL`; emphasis from the font name
 * (item, then the resolved `decorations.fontStyles` map, falling back to the
 * page `styles` dict family); headings from
 * relative type size; super/subscript from small size plus baseline shift.
 * Vector layer (`decorations`, best-effort): non-grid horizontal rules
 * overlapping a span's baseline band become `__underline__`/`~~strike~~`,
 * standalone fills behind spans become `==highlight==`, and ruling grids
 * with cleanly placeable rows become `| tables |` (rejected grids and
 * grid-less layouts flatten exactly as before). Whitespace-only lines are
 * dropped; whitespace runs collapse. Items without `hasEOL` (older shapes)
 * fall back to the legacy single-line space-join so text still survives.
 */
export function pdfPageToText(
  items: readonly unknown[],
  styles?: Readonly<Record<string, PdfImportFontStyle>>,
  decorations?: PdfPageDecorations,
): string {
  const rawLines = pdfItemsToRawLines(items, styles, decorations?.fontStyles)
  const flaggedLines = rawLines.map(pdfFlagSupSub)
  const grids = decorations?.tables ?? []
  const detected = grids.length > 0 ? pdfDetectTables(rawLines, grids) : []
  // Render tables top-down at their first member line; member lines vanish
  // from the normal flow (their text lives in the table now).
  const tableAt = new Map<number, string>()
  const member = new Set<number>()
  for (const d of detected) {
    const ordered = [...d.members].sort((a, b) => {
      const ya = pdfLineY(rawLines[a] ?? [])
      const yb = pdfLineY(rawLines[b] ?? [])
      if (Number.isFinite(ya) && Number.isFinite(yb) && ya !== yb) return (yb as number) - (ya as number)
      return a - b
    })
    const md = pdfRenderDetectedTable(
      d.grid,
      ordered.map((i) => ({ spans: flaggedLines[i] ?? [], raw: rawLines[i] ?? [] })),
    )
    if (md === null) continue // rejected: lines emit normally below
    ordered.forEach((i) => member.add(i))
    tableAt.set(ordered[0] as number, md)
  }
  // Body-size reference: table-member text is excluded so a table-heavy
  // page cannot inflate the median and suppress real headers — but when the
  // prose sample is tiny (e.g. a lone title above a table), the median of
  // almost nothing is worse than the median of everything, so fall back to
  // the full sample below that floor.
  const proseRaw = rawLines.filter((_, i) => !member.has(i))
  const proseFlagged = flaggedLines.filter((_, i) => !member.has(i))
  let bodyMedian = pdfPageBodyMedian(proseRaw, proseFlagged)
  if (!Number.isFinite(bodyMedian) || pdfCountHeights(proseRaw, proseFlagged) < 3) {
    bodyMedian = pdfPageBodyMedian(rawLines, flaggedLines)
  }
  // Header levels are judged pre-split (splitting changes flagged-array
  // lengths, so judging must not index flagged lines past this point).
  const levels = rawLines.map((raw, i) => {
    if (member.has(i)) return 0 as const
    const spans = flaggedLines[i] ?? []
    const judged: number[] = []
    raw.forEach((s, j) => {
      const f = spans[j]
      if (f !== undefined && !f.sup && !f.sub && s.text.length > 0 && Number.isFinite(s.height)) {
        judged.push(s.height)
      }
    })
    return pdfHeaderLevel(judged, bodyMedian)
  })
  if (decorations !== undefined) pdfApplyVectorMarks(rawLines, flaggedLines, decorations, member)
  const out: string[] = []
  flaggedLines.forEach((spans, i) => {
    const table = tableAt.get(i)
    if (table !== undefined) out.push(table)
    if (member.has(i)) return
    const line = pdfRenderLine(spans, levels[i] ?? 0)
    if (line.length > 0) out.push(line)
  })
  return out.join('\n')
}

/** Count measurable body-height samples (median-sample floor, see above). */
function pdfCountHeights(
  rawLines: readonly (readonly PdfRawSpan[])[],
  flaggedLines: readonly (readonly PdfImportSpan[])[],
): number {
  let n = 0
  rawLines.forEach((line, i) => {
    const flagged = flaggedLines[i]
    line.forEach((s, j) => {
      const f = flagged?.[j]
      if (f !== undefined && !f.sup && !f.sub && s.text.length > 0 && Number.isFinite(s.height) && s.height > 0) {
        n++
      }
    })
  })
  return n
}

// --- RTF (built-in minimal converter, zero-dep) ------------------------------

/**
 * Destination groups whose content is metadata/binary, never document text.
 * When one of these control words opens a group, the whole group is skipped.
 * Deliberately NOT skipped: header/footer/footnote groups (real text — kept
 * inline) and shp/txbxcontent (drawing text boxes — kept so words survive).
 */
const RTF_SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'shppict',
  'object',
  'objdata',
  'objclass',
  'fontemb',
  'fontfile',
  'fldinst', // field instructions (e.g. HYPERLINK "url") — the visible result in fldrslt is kept
  'listtable',
  'listoverridetable',
  'listpicture',
  'revtbl',
  'rsidtbl',
  'colorschememapping',
  'themadata',
  'themedata',
  'datastore',
])

/** Windows-1252 bytes 0x80–0x9F that differ from Unicode code points. */
const RTF_CP1252_EXTRA: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
}

/** Decode a `\'xx` hex escape (Windows-1252). Returns '' on malformed input. */
function rtfHexByte(hex: string): string {
  if (!/^[0-9a-fA-F]{2}$/.test(hex)) return ''
  const code = parseInt(hex, 16)
  const extra = RTF_CP1252_EXTRA[code]
  if (extra !== undefined) return extra
  // 0x81/0x8D/0x8F/0x90/0x9D are unassigned in Windows-1252 — drop them.
  if (code >= 0x81 && code <= 0x9f) return ''
  return String.fromCharCode(code)
}

/**
 * Minimal RTF → Markdown converter (zero dependencies — keeps the bundle lean
 * per the P3 brief; no `rtf-parser` npm dep).
 *
 * Handles: `{`/`}` groups, `\par` `\line` `\cell` `\row` `\tab` `\page`
 * `\sect`, `\b`/`\b0`, `\i`/`\i0`, `\strike`/`\striked`(+`0`), `\sub`
 * `\super`/`\nosupersub`, `\highlight`(+`N`), `\plain`, `\bullet`,
 * typographic quotes and dashes, `\uN` (with fallback-char skip) and `\'xx`
 * (Windows-1252), `\~` (nbsp → space), WordPad `{\pntext...}` list markers
 * (normalized to `- `/`1. `), and skips metadata/binary destinations
 * (font/color tables, `\pict`, embedded objects, field instructions,
 * `{\*\pn...}` list definitions).
 *
 * Known limitations (all listed in `lossSummaryFor('rtf')`): no images,
 * fonts, colors or exact spacing; underline dropped; tables flattened;
 * nested or malformed groups degrade to best-effort text.
 */
function rtfToMarkdown(src: string): string {
  let out = ''
  let depth = 0
  // While non-null, ignore all output at/inside this group depth.
  let skipDepth: number | null = null
  const ignoring = (): boolean => skipDepth !== null && depth >= skipDepth
  // Open markers with their output position, so `\b \b0`-style empty pairs
  // are dropped instead of emitting stray `****`.
  const stack: Array<{ marker: string; pos: number }> = []
  // Markers closed by a paragraph break, waiting to reopen on the next text
  // (lazy reopen — outermost-first — so blank lines never gain trailing `****`).
  let pendingReopen: string[] = []

  /**
   * Append a closer for one open marker, keeping whitespace OUTSIDE the
   * markers (`**bold **` → `**bold** `, `** bold**` → ` **bold**`) and dropping
   * empty/whitespace-only pairs. Adjusts the recorded positions of markers
   * opened after `entry` for the whitespace moved before its opener.
   */
  const emitClose = (entry: { marker: string; pos: number }): void => {
    if (out.length === entry.pos + entry.marker.length) {
      out = out.slice(0, entry.pos)
      return
    }
    let trailing = ''
    const trailingMatch = /[ \t]+$/.exec(out)
    if (trailingMatch !== null) {
      trailing = trailingMatch[0]
      out = out.slice(0, out.length - trailing.length)
      if (out.length === entry.pos + entry.marker.length) {
        out = out.slice(0, entry.pos) + trailing
        return
      }
    }
    const inner = out.slice(entry.pos + entry.marker.length)
    const leadMatch = /^[ \t]+/.exec(inner)
    if (leadMatch !== null) {
      const lead = leadMatch[0]
      out = out.slice(0, entry.pos) + lead + entry.marker + inner.slice(lead.length) + entry.marker + trailing
      for (const s of stack) {
        if (s.pos > entry.pos) s.pos += lead.length
      }
    } else {
      out = out + entry.marker + trailing
    }
  }

  const openFmt = (marker: string): void => {
    if (stack.some((s) => s.marker === marker)) return // already on
    stack.push({ marker, pos: out.length })
    out += marker
  }
  const closeFmt = (marker: string): void => {
    const idx = stack.map((s) => s.marker).lastIndexOf(marker)
    if (idx === -1) return
    const [entry] = stack.splice(idx, 1)
    if (entry === undefined) return
    emitClose(entry)
  }
  // Round-8 D1 — explicit off-switches must cancel a pending lazy-reopen for
  // the same marker (e.g. `\b bold\par\b0...` closed ** at the break, so the
  // later \b0 must drop the pending ** instead of letting the next \i reopen
  // it into `***italic***`). \plain already clears pending (see resetFmt).
  const cancelPending = (marker: string): void => {
    if (pendingReopen.length === 0) return
    pendingReopen = pendingReopen.filter((m) => m !== marker)
  }
  const resetFmt = (): void => {
    // \plain — trim first, then close everything, innermost first.
    pendingReopen = []
    out = out.replace(/[ \t]+$/, '')
    for (let k = stack.length - 1; k >= 0; k--) {
      const entry = stack[k]
      if (entry === undefined) continue
      emitClose(entry)
    }
    stack.length = 0
  }

  /**
   * Emit a paragraph/cell/page break (round-7 C5): markers must never span the
   * break, so close every open marker innermost-first, emit the break, and
   * stash the closed markers for lazy reopen on the next text. Empty pairs
   * are dropped, never reopened.
   */
  const emitBreak = (brk: string): void => {
    out = out.replace(/[ \t]+$/, '')
    if (stack.length > 0) {
      const reopen: string[] = []
      for (let k = stack.length - 1; k >= 0; k--) {
        const entry = stack[k]
        if (entry === undefined) continue
        if (/[^ \t]/.test(out.slice(entry.pos + entry.marker.length))) {
          emitClose(entry)
          reopen.unshift(entry.marker)
        } else {
          // Empty/whitespace-only pair — drop the markers, keep the spaces
          // (the break swallows them; the final `[ \t]+\n` cleanup is backstop).
          out = out.slice(0, entry.pos) + out.slice(entry.pos + entry.marker.length)
        }
      }
      stack.length = 0
      pendingReopen = reopen
    }
    out += brk
  }

  /** Emit document text, reopening break-closed markers first (outermost-first). */
  const emitText = (text: string): void => {
    if (ignoring()) return
    if (text !== '' && pendingReopen.length > 0) {
      for (const marker of pendingReopen) {
        if (!stack.some((s) => s.marker === marker)) {
          stack.push({ marker, pos: out.length })
          out += marker
        }
      }
      pendingReopen = []
    }
    out += text
  }

  let i = 0
  const n = src.length
  const control = (word: string, param: number | null, hadDelimSpace: boolean): void => {
    if (RTF_SKIP_DESTINATIONS.has(word)) {
      if (skipDepth === null) skipDepth = depth
      return
    }
    if (ignoring()) return
    switch (word) {
      case 'par':
      case 'line':
      case 'row':
        emitBreak('\n')
        break
      case 'cell':
        emitBreak(' | ')
        break
      case 'tab':
        emitText('\t')
        break
      case 'page':
      case 'sect':
        emitBreak('\n\n')
        break
      case 'b':
        if (param === null || param !== 0) openFmt('**')
        else {
          cancelPending('**')
          closeFmt('**')
        }
        break
      case 'i':
        if (param === null || param !== 0) openFmt('*')
        else {
          cancelPending('*')
          closeFmt('*')
        }
        break
      // Round-8 D1 — GFM strikethrough (matches the app's own dialect).
      case 'strike':
      case 'striked':
        if (param !== null && param === 0) {
          cancelPending('~~')
          closeFmt('~~')
        } else openFmt('~~')
        break
      // Round-8 D1 — subscript / superscript (Notedown ~ / ^ dialect).
      case 'sub':
        openFmt('~')
        break
      case 'super':
        openFmt('^')
        break
      case 'nosupersub': {
        cancelPending('~')
        cancelPending('^')
        // Close innermost-first so nested ~ / ^ never cross.
        const markers = stack.map((s) => s.marker)
        if (markers.lastIndexOf('~') > markers.lastIndexOf('^')) {
          closeFmt('~')
          closeFmt('^')
        } else {
          closeFmt('^')
          closeFmt('~')
        }
        // Round-8 D2 — WordPad emits boundary-without-space
        // (`subscript\nosupersub text`: the space after \nosupersub is the
        // swallowed control-word delimiter, so output would merge to
        // `subscripttext`). Re-emit one space here only, when a delimiter
        // space was consumed and output doesn't already end with whitespace.
        // Other closers must NOT do this (would corrupt mid-word \b0/\i0).
        if (hadDelimSpace && !ignoring() && out.length > 0 && !/\s$/.test(out)) out += ' '
        break
      }
      // Round-8 D1 — highlight (param 0 / absent = off, nonzero = on).
      case 'highlight':
        if (param === null || param === 0) {
          cancelPending('==')
          closeFmt('==')
        } else openFmt('==')
        break
      case 'plain':
        resetFmt()
        break
      // Underline has no Markdown equivalent — the text is kept, the style dropped.
      case 'ul':
      case 'ulnone':
        break
      case 'bullet':
        emitText('• ')
        break
      case 'emdash':
        emitText('—')
        break
      case 'endash':
        emitText('–')
        break
      case 'lquote':
        emitText('‘')
        break
      case 'rquote':
        emitText('’')
        break
      case 'ldblquote':
        emitText('“')
        break
      case 'rdblquote':
        emitText('”')
        break
      case 'u': {
        const code = param ?? 0
        emitText(String.fromCharCode(code < 0 ? code + 65536 : code))
        // A single fallback char follows \uN for readers without Unicode
        // support — skip it (it may itself be a \'xx escape).
        if (src[i] === '\\' && src[i + 1] === "'") i += 4
        else if (src[i] !== undefined && src[i] !== '\\' && src[i] !== '{' && src[i] !== '}') i += 1
        break
      }
      default:
        // Font/size/color/margin/layout words carry no text — ignore.
        break
    }
  }

  while (i < n) {
    const ch = src[i]
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      if (skipDepth !== null && depth < skipDepth) skipDepth = null
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      i++ // source line breaks carry no content in RTF
      continue
    }
    if (ch !== '\\') {
      emitText(ch)
      i++
      continue
    }
    i++
    if (i >= n) break
    const nx = src[i]
    // Literal escapes \\ \{ \}.
    if (nx === '\\' || nx === '{' || nx === '}') {
      emitText(nx)
      i++
      continue
    }
    // Hex escape \'xx (Windows-1252).
    if (nx === "'") {
      emitText(rtfHexByte(src.slice(i + 1, i + 3)))
      i += 3
      continue
    }
    // Ignorable-destination marker: skip to the end of the current group.
    if (nx === '*') {
      if (!ignoring() && skipDepth === null) skipDepth = depth
      i++
      continue
    }
    // Control symbols.
    if (nx === '~') {
      emitText(' ') // nbsp — plain space is fine for Markdown
      i++
      continue
    }
    if (nx === '-') {
      i++ // optional hyphen — drop
      continue
    }
    if (nx === '_') {
      emitText('-') // non-breaking hyphen
      i++
      continue
    }
    if (nx === '\r' || nx === '\n') {
      i++ // backslash-newline is source formatting, not content
      continue
    }
    // Control word: letters + optional signed numeric param; a single
    // following space (or line break) is the delimiter and is swallowed.
    // Manual index scan (not regex-on-slice) so large files stay O(n).
    let j = i
    while (j < n) {
      const c = src[j]
      if (c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) j++
      else break
    }
    if (j === i) {
      i++ // stray char after backslash — skip
      continue
    }
    const word = src.slice(i, j).toLowerCase()
    i = j
    let param: number | null = null
    let k = i
    if (src[k] === '-') k++
    let digits = 0
    while (k < n) {
      const c = src[k]
      if (c !== undefined && c >= '0' && c <= '9') {
        k++
        digits++
      } else break
    }
    if (digits > 0) {
      param = parseInt(src.slice(i, k), 10)
      i = k
    }
    let hadDelimSpace = false
    if (src[i] === ' ') {
      hadDelimSpace = true
      i++
    } else if (src[i] === '\r' && src[i + 1] === '\n') i += 2
    else if (src[i] === '\r' || src[i] === '\n') i++
    control(word, param, hadDelimSpace)
  }

  resetFmt() // close any dangling markers so output never has unbalanced **/*
  // Round-8 D2 — WordPad list markers arrive as literal text (`·\t...` from
  // {\pntext...} groups; the {\*\pn...} definitions are already skipped via
  // the \* rule). Normalize them here, on the final line split before the
  // existing whitespace cleanup. Round-10: skip pipe-table separator lines
  // (`--- | ---`) — our own exporter emits them literally and the leading
  // `--- ` would otherwise match the bullet run below (`- | --- | ---`).
  const lines = out.split('\n').map((line) => {
    if (/^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$/.test(line)) return line
    if (/^[•·‣⁃○●▪◦\-*o]+[ \t]+/.test(line)) return line.replace(/^[•·‣⁃○●▪◦\-*o]+[ \t]+/, '- ')
    return line.replace(/^(\d+\.)[ \t]+/, '$1 ')
  })
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
