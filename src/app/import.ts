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
        'Only text is extracted — images and vector graphics are dropped.',
        'Page layout, columns and tables may be flattened or reordered.',
        'Fonts, sizes and colors are not preserved.',
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
    const result = await mammoth.convertToHtml({ arrayBuffer })
    for (const message of result.messages.slice(0, 5)) losses.push(`Word warning: ${message.message}`)
    const service = await createTurndown()
    return { markdown: service.turndown(DOMPurify.sanitize(result.value)).trim(), losses }
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
      const text = pdfPageToText(content.items)
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
 * Reconstruct one page's text from pdfjs text items (round-7 C4). Items carry
 * per-span fragments plus `hasEOL` line-break flags: spans are space-joined
 * within a line, lines break on `hasEOL`, and whitespace-only lines are
 * dropped. Items without `hasEOL` (older shapes) fall back to the legacy
 * space-join so text still survives.
 */
function pdfPageToText(items: readonly unknown[]): string {
  const seg = (item: unknown): string =>
    typeof item === 'object' && item !== null && 'str' in item && typeof (item as { str: unknown }).str === 'string'
      ? (item as { str: string }).str
      : ''
  const hasEol = (item: unknown): boolean | undefined =>
    typeof item === 'object' && item !== null && 'hasEOL' in item
      ? (item as { hasEOL: unknown }).hasEOL as boolean | undefined
      : undefined
  if (!items.some((item) => typeof hasEol(item) === 'boolean')) {
    // Text items are per-span fragments in visual order; join with spaces
    // and collapse runs. Multi-column order and table structure are NOT
    // reconstructed (documented loss).
    return items
      .map(seg)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  const lines: string[] = []
  let segs: string[] = []
  for (const item of items) {
    segs.push(seg(item))
    if (hasEol(item) === true) {
      lines.push(segs.join(' '))
      segs = []
    }
  }
  if (segs.length > 0) lines.push(segs.join(' '))
  return lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
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
