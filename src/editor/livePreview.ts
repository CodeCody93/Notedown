/**
 * Live preview — the ONLY swap/fork point for `codemirror-live-markdown`.
 *
 * Per PLAN §2 / §21, the pinned alpha package (`codemirror-live-markdown@0.5.1-alpha.1`)
 * is a bus-factor risk (single maintainer, v0.5.x-alpha, roadmap stalled). Everything
 * the app needs from it flows through this thin interface so the base can be swapped
 * without touching `editor.ts`, `app.ts` or `main.ts`.
 *
 * FORK NOTE (why we don't use the package's `livePreviewPlugin` as-is):
 * the pinned tarball's inline reveal calls `shouldShowSource(state, mark.from, mark.to)`
 * — i.e. it reveals a mark only when the caret intersects the MARK'S OWN chars (the `**`).
 * PLAN §1/§6A requires TRUE Typora-style: syntax re-appears faded whenever the caret is
 * INSIDE the formatting REGION (e.g. anywhere within `**bold**`). We therefore reimplement
 * the decoration builder here and pass the WHOLE parent element range to the package's
 * exported `shouldShowSource` (which is exactly what the package's own README documents).
 *
 * Reveal scope (§22.1 locked decision: default 'line'):
 * - `'line'`  — block marks (heading/list/quote) reveal on the caret's line (`activeLines`),
 *   computed from the selection ranges. Matches the locked default; no fork needed.
 * - `'block'` — would reveal whole blocks instead of just the caret line. Documented TODO.
 *
 * BEYOND THE PACKAGE — widget/decoration families that fix user-reported M2 issues:
 * - List markers: on inactive lines the collapsed styling hides the raw `- ` / `1. `
 *   (opacity 0), so list items showed no bullet at all. We replace the mark with a
 *   stable `ListMarkerWidget` (`•` / `1.` / `☐` / `☑`) instead, supporting all four
 *   task-list spellings (`-[]`, `- []`, `-[ ]`, `- [ ]`) and toggling the checkbox
 *   bracket on mousedown (Other Noted Issues #4/#7).
 * - Images: `![alt](src)` rendered as raw markdown text in live mode. We replace the
 *   whole `Image` node with a `MarkdownImageWidget` that renders the resolved image
 *   (host-provided `imageResolver`) or falls back to the raw markdown text.
 * - Blockquotes: inactive quote lines get a `.cm-blockquote` line style (E8) so the
 *   quote reads visually once the caret leaves it.
 * - Tables: when no line of a `Table` node contains the caret, the whole node is
 *   replaced by a rendered div-grid `MarkdownTableWidget` (E13). Rendering the caret
 *   inside keeps the raw source.
 * - Graphs: single-line `%% … %%` tags render as a block `MarkdownGraphWidget`
 *   when the caret is elsewhere on the line; the raw tag stays while editing.
 * - Horizontal rules: `---` on an inactive line renders as a `.cm-hr-widget` rule (E14).
 * - Heading IDs: the trailing ` {#custom-id}` is hidden on inactive heading lines (E16).
 * - Sub/sup tags and `==highlight==`: on inactive lines the literal tags/delimiters are
 *   replaced by zero-size widgets and the enclosed text is styled (E18/E19/E20).
 * - `__underline__`: StrongEmphasis with `__` marks gets a content-only `.cm-underline`
 *   decoration on inactive lines (E3).
 * - `-# subtext`: inactive lines starting with `-# ` render the remainder as
 *   `.cm-subtext` (Other Noted Issues #5).
 * - Active-line muted syntax: on caret-inside (raw) lines the task `[ ]`/`[x]`
 *   brackets, table `|` pipes, deflist `:` colons and paired `>>>` markers
 *   previously showed in default text color while every other syntax showed
 *   faded ghost. They now get ghost `*-visible` marks (task/`>>>` via
 *   `cm-formatting-block-visible`, pipes/deflist via
 *   `cm-formatting-inline-visible`) so active lines read consistently. Task
 *   prefix (bullet + bracket) is marked as one range
 *   (`line.from..line.from + prefix.length`); table pipes cover every `|` on
 *   active tables; deflist covers the leading `:`; `>>>` covers the marker
 *   chars when the caret is anywhere inside the pair's range. Marks only,
 *   never replaces.
 *
 * BLOCK-WIDGET NOTE (why tables/HRs live in a StateField, not the ViewPlugin):
 * CM6 ≥ 6.40 throws `RangeError("Block decorations may not be specified via plugins")`
 * and `RangeError("Decorations that replace line breaks may not be specified via
 * plugins")` for decorations provided through plugin functions — block widgets must
 * come from a direct provider. The package's own `tableField` uses a StateField for
 * exactly this reason, and so does `blockRenderField` below (it stays inside this
 * module, wired through `livePreviewExtensions`, so the swap-point contract holds).
 */
import { Prec, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  keymap,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import {
  collapseOnSelectionFacet,
  markdownStylePlugin,
  editorTheme,
  mouseSelectingField,
  setMouseSelecting,
  shouldShowSource,
  checkUpdateAction,
} from 'codemirror-live-markdown'
import { renderInlineMarkdown, renderInlineOnlyMarkdown } from '../app/export'
import DOMPurify from 'dompurify'
import { parseGraphTag, graphToHtml, graphToErrorHtml } from '../app/graph'
// Single-source table chord (never hardcoded): the widget swallows all CM6
// handling (ignoreEvent), so the tableHotkeyMap binding never fires here —
// the keydown handler below matches via this pure, dependency-free module
// (no import cycle: shortcuts.ts imports nothing).
import { matches as matchesShortcut } from '../app/shortcuts'
import { parseListItem, ListDepthTracker } from '../app/lists'
import hljs from 'highlight.js/lib/core'
import markdownLang from 'highlight.js/lib/languages/markdown'
import javascriptLang from 'highlight.js/lib/languages/javascript'
import typescriptLang from 'highlight.js/lib/languages/typescript'
import pythonLang from 'highlight.js/lib/languages/python'
import bashLang from 'highlight.js/lib/languages/bash'
import jsonLang from 'highlight.js/lib/languages/json'
import yamlLang from 'highlight.js/lib/languages/yaml'
import htmlLang from 'highlight.js/lib/languages/xml'
import cssLang from 'highlight.js/lib/languages/css'
import rustLang from 'highlight.js/lib/languages/rust'
import sqlLang from 'highlight.js/lib/languages/sql'
import plaintextLang from 'highlight.js/lib/languages/plaintext'

let hljsRegistered = false
function ensureHljs(): void {
  if (hljsRegistered) return
  hljsRegistered = true
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

export const REVEAL_SCOPE: 'line' | 'block' = 'line'

export interface LivePreviewOptions {
  /** Master on/off: true hides marks (reveal on caret), false = source mode (all marks shown). Default true. */
  collapse?: boolean
  /** Resolve a markdown image src (relative path) to a webview-renderable URL, or null when unresolvable (browser dev mode, unsaved doc, http/data/absolute/rooted paths). Consumed by the image widget in collapsed mode. */
  imageResolver?: (src: string) => Promise<string | null>
  /** Fires when a rendered link is clicked in live-preview mode. Used to open the URL externally. */
  onLinkClick?: (url: string) => void
}

// ---------------------------------------------------------------------------
// Forked live-preview decoration builder (see FORK NOTE above).
// ---------------------------------------------------------------------------

const BLOCK_MARK_TYPES = new Set(['HeaderMark', 'ListMark', 'QuoteMark'])
const INLINE_MARK_TYPES = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark'])
// Marks inside these parents are left unstyled: code blocks (raw text) and
// rendered images (the image widget replaces the whole construct, so its alt
// emphasis must NOT add decorations overlapping the replacement range).
const SKIP_PARENT_TYPES = new Set(['FencedCode', 'CodeBlock', 'Image'])

function isInsideSkippedParent(parent: SyntaxNode | null): boolean {
  while (parent) {
    if (SKIP_PARENT_TYPES.has(parent.name)) return true
    parent = parent.parent
  }
  return false
}

/** Options handed to the plugin instance (via `ViewPlugin.of(...)`). */
interface LivePreviewPluginOptions {
  imageResolver?: (src: string) => Promise<string | null>
  onLinkClick?: (url: string) => void
}

/**
 * Zero-size inline widget: replaces syntax that must disappear from view on
 * inactive lines (heading `{#id}` attributes, `<sub>/<sup>` tags, `==`
 * highlight delimiters, `-# ` subtext prefixes). The doc text stays intact —
 * the widget only hides the range while the caret is elsewhere.
 */
class EmptyInlineWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }

  eq(o: EmptyInlineWidget): boolean {
    return o.from === this.from && o.to === this.to
  }

  toDOM(): HTMLElement {
    return document.createElement('span')
  }
}

/**
 * Stable marker for list items on inactive lines. Replaces the raw `- ` / `1. ` /
 * `- [ ] ` markdown chars so the bullet/number/checkbox stays visible while
 * collapsed. Task markers (☐/☑) also toggle the doc bracket `[ ]` ↔ `[x]` on
 * mousedown (Other Noted Issues #7) — the change dispatches through the view,
 * so it is a normal single undo step.
 */
class ListMarkerWidget extends WidgetType {
  constructor(
    readonly marker: string,
    readonly from: number,
    readonly to: number,
    /** Doc range of the `[ ]` / `[x]` bracket, or -1 for plain bullets/numbers. */
    readonly bracketFrom: number = -1,
    readonly bracketTo: number = -1,
    private readonly view: EditorView | null = null,
  ) {
    super()
  }

  eq(o: ListMarkerWidget): boolean {
    return (
      o.from === this.from &&
      o.to === this.to &&
      o.marker === this.marker &&
      o.bracketFrom === this.bracketFrom &&
      o.bracketTo === this.bracketTo
    )
  }

  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-list-marker'
    s.textContent = this.marker
    if (this.view !== null && this.bracketFrom >= 0 && this.bracketTo > this.bracketFrom) {
      s.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        const checked = this.marker === '☑'
        this.view!.dispatch({
          changes: { from: this.bracketFrom, to: this.bracketTo, insert: checked ? '[ ]' : '[x]' },
        })
      })
    }
    return s
  }
}

/**
 * Rendered image for inactive lines. Replaces `![alt](src)` with an `<img>`
 * resolved through the host-provided `imageResolver`; renders the raw markdown
 * text when there is no resolver or the src is empty/unresolvable. The widget
 * is self-contained — it never touches the EditorView.
 */
class MarkdownImageWidget extends WidgetType {
  private dom: HTMLElement | null = null

  constructor(
    readonly from: number,
    readonly to: number,
    readonly text: string,
    readonly resolver?: (src: string) => Promise<string | null>,
  ) {
    super()
  }

  eq(o: MarkdownImageWidget): boolean {
    return o.from === this.from && o.to === this.to && o.text === this.text && o.resolver === this.resolver
  }

  toDOM(): HTMLElement {
    const m = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(this.text)
    const alt = m ? m[1] : ''
    const src = m ? m[2].trim() : ''
    const span = document.createElement('span')
    span.className = 'cm-image-widget'
    if (src === '' || this.resolver === undefined) {
      span.classList.add('cm-image-unresolved')
      span.textContent = this.text
      return span
    }
    const img = document.createElement('img')
    img.className = 'cm-image-widget-img'
    img.alt = alt
    span.appendChild(img)
    span.classList.add('cm-image-loading')
    this.dom = span
    // Resolve asynchronously; drop silently if the widget was rebuilt/removed
    // before the promise settled (its DOM is no longer connected).
    void Promise.resolve(this.resolver(src))
      .catch(() => null)
      .then((resolved) => {
        if (!this.dom || !this.dom.isConnected) return
        if (resolved !== null) {
          img.src = resolved
          span.classList.remove('cm-image-loading')
        } else {
          img.remove()
          span.classList.replace('cm-image-loading', 'cm-image-unresolved')
          span.textContent = this.text
        }
      })
    return span
  }
}

/**
 * Rendered link for inactive lines. Replaces `[text](url)` with a clickable
 * `<a>` element showing only the link text. Clicking opens the URL via the
 * host-provided `onLinkClick` callback (or `window.open` as fallback). The raw
 * markdown re-appears when the caret enters the line.
 */
class MarkdownLinkWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly text: string,
    readonly onLinkClick?: (url: string) => void,
  ) {
    super()
  }

  eq(o: MarkdownLinkWidget): boolean {
    return o.from === this.from && o.to === this.to && o.text === this.text
  }

  toDOM(): HTMLElement {
    const m = /^\[([^\]]*)\]\(([^)]*)\)/.exec(this.text)
    const label = m ? m[1] : this.text
    const url = m ? m[2].trim() : ''
    const a = document.createElement('a')
    a.className = 'cm-link-widget'
    a.textContent = label
    if (url !== '') {
      a.href = url
      a.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
      })
      a.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (this.onLinkClick !== undefined) {
          this.onLinkClick(url)
        } else {
          window.open(url, '_blank')
        }
      })
    }
    return a
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * Rendered footnote reference for inactive lines. Replaces `[^N]` with a
 * clickable superscript link. Clicking scrolls to the corresponding footnote
 * definition (`[^N]: …`) in the document. The raw markdown re-appears when
 * the caret enters the line.
 */
class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly num: number,
    readonly defFrom: number,
    readonly view: EditorView,
  ) {
    super()
  }

  eq(o: FootnoteRefWidget): boolean {
    return o.num === this.num && o.defFrom === this.defFrom
  }

  toDOM(): HTMLElement {
    const sup = document.createElement('sup')
    sup.className = 'cm-footnote-ref'
    const a = document.createElement('a')
    a.href = '#fn' + this.num
    a.textContent = String(this.num)
    a.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    })
    a.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      this.view.dispatch({ effects: EditorView.scrollIntoView(this.defFrom, { y: 'start' }) })
    })
    sup.appendChild(a)
    return sup
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * Rendered spoiler — 4-step Typora-style flow:
 * 1) caret inside `||...||` → raw source visible with muted/faded `||`
 *    delimiters (decoration builder, not this widget).
 * 2) caret exits → content hidden behind this censored cover widget.
 * 3) click cover → one-way reveal (`data-revealed=false` → `true`).
 * 4) click revealed content → mousedown is let through so CM6 places the
 *    caret naturally, the widget rebuilds to raw source (back to step 1).
 *
 * Mousedown/click split: while hidden, mousedown is swallowed so CM6 does
 * not move the caret (which would rebuild the widget before click fires and
 * make the reveal position-dependent); the click then reveals. Once
 * revealed, both handlers do nothing so CM6 handles the interaction and
 * enters edit mode. The widget never toggles true→false on click.
 */
class SpoilerWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly text: string,
  ) {
    super()
  }

  eq(o: SpoilerWidget): boolean {
    return o.from === this.from && o.to === this.to && o.text === this.text
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-spoiler'
    span.setAttribute('data-revealed', 'false')
    span.title = 'Click to reveal'
    span.textContent = this.text
    span.addEventListener('mousedown', (e: MouseEvent) => {
      if (span.getAttribute('data-revealed') !== 'true') {
        e.preventDefault()
        e.stopPropagation()
      }
    })
    span.addEventListener('click', (e: MouseEvent) => {
      if (span.getAttribute('data-revealed') === 'true') return
      e.preventDefault()
      e.stopPropagation()
      span.setAttribute('data-revealed', 'true')
      span.title = 'Click to edit'
    })
    return span
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * Rendered dropdown for fully-inactive `>>>` blocks. Replaces the entire
 * range (both `>>>` markers + inner content) with a collapsible details-like
 * widget. Clicking the header toggles the content visibility. The inner
 * markdown is rendered via renderInlineMarkdown for a WYSIWYG appearance.
 * The raw markdown re-appears when the caret enters any line of the block.
 * Optional name: `>>> My Title` sets the header label to "My Title".
 */
class DropdownWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly innerText: string,
    readonly name: string = '',
  ) {
    super()
  }

  eq(o: DropdownWidget): boolean {
    return o.from === this.from && o.to === this.to && o.innerText === this.innerText && o.name === this.name
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-dropdown'

    const header = document.createElement('div')
    header.className = 'cm-dropdown-header'

    const chevron = document.createElement('span')
    chevron.className = 'cm-dropdown-chevron'
    chevron.textContent = '\u25B6'

    const label = document.createElement('span')
    label.className = 'cm-dropdown-label'
    label.textContent = this.name || 'Dropdown'

    header.appendChild(chevron)
    header.appendChild(label)

    const content = document.createElement('div')
    content.className = 'cm-dropdown-content'
    content.style.display = 'none'
    if (this.innerText.trim().length > 0) {
      content.innerHTML = renderInlineMarkdown(this.innerText)
    }

    container.appendChild(header)
    container.appendChild(content)

    let open = false
    header.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      open = !open
      content.style.display = open ? 'block' : 'none'
      chevron.style.transform = open ? 'rotate(90deg)' : ''
    })

    // Clicking inside the expanded content enters edit mode by placing the
    // caret at the start of the widget's source range, which removes the
    // widget and shows the raw markdown.
    content.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const view = EditorView.findFromDOM(container)
      if (view) {
        view.focus()
        view.dispatch({ selection: { anchor: this.from } })
      }
    })

    return container
  }

  /**
   * Block CM6 from handling events on this widget. We manage header clicks
   * (toggle open/close) and content clicks (place caret → enter edit mode)
   * manually. Without this, CM6's mousedown handler places the caret before
   * our click handler can stop propagation, preventing toggle.
   */
  ignoreEvent(): boolean {
    return true
  }
}

/**
 * Rendered GFM table for fully-inactive tables (E13). Replaces the whole
 * `Table` node with a simple div grid (`.cm-table-widget` / `.cm-table-row` /
 * `.cm-table-cell` / `.cm-table-head`) styled via editor.css. Clicking a cell
 * places the caret at that cell's source position for precise editing.
 */
class MarkdownTableWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly text: string,
  ) {
    super()
  }

  eq(o: MarkdownTableWidget): boolean {
    return o.from === this.from && o.to === this.to && o.text === this.text
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-table-widget'
    const data = parseMarkdownTable(this.text)
    if (data === null) {
      container.textContent = this.text
      return container
    }
    const headRow = document.createElement('div')
    headRow.className = 'cm-table-row cm-table-head'
    for (const header of data.headers) headRow.appendChild(tableCell(header))
    container.appendChild(headRow)
    for (const row of data.rows) {
      const rowEl = document.createElement('div')
      rowEl.className = 'cm-table-row'
      for (const cell of row) rowEl.appendChild(tableCell(cell))
      container.appendChild(rowEl)
    }

    // Place caret at the clicked cell's source position on mousedown.
    container.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      const cell = target.closest('.cm-table-cell') as HTMLElement | null
      if (!cell) return
      const row = cell.closest('.cm-table-row') as HTMLElement | null
      if (!row) return

      const rows = Array.from(container.querySelectorAll('.cm-table-row'))
      const rowIndex = rows.indexOf(row)
      const cells = Array.from(row.querySelectorAll('.cm-table-cell'))
      const colIndex = cells.indexOf(cell)
      if (rowIndex < 0 || colIndex < 0) return

      const pos = this.cellSourcePos(rowIndex, colIndex)
      if (pos < 0) return

      const view = EditorView.findFromDOM(container)
      if (!view) return
      e.preventDefault()
      e.stopPropagation()
      view.focus()
      view.dispatch({ selection: { anchor: pos } })
    })

    return container
  }

  /** Compute the document offset of the content start for the given cell. */
  private cellSourcePos(rowIndex: number, colIndex: number): number {
    const lines = this.text.split('\n')
    // DOM row 0 → source line 0 (header); DOM row N≥1 → source line N+1 (skip separator)
    const srcLine = rowIndex === 0 ? 0 : rowIndex + 1
    if (srcLine >= lines.length) return -1
    const line = lines[srcLine]
    let pipes = 0
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '|') continue
      pipes++
      if (pipes === colIndex + 1) {
        let j = i + 1
        while (j < line.length && line[j] === ' ') j++
        let lineStart = 0
        for (let k = 0; k < srcLine; k++) lineStart += lines[k].length + 1
        return this.from + lineStart + j
      }
    }
    return -1
  }

  ignoreEvent(event: Event): boolean {
    // Only block CM6 handling for mousedown on cells — we handle those ourselves.
    if (event.type === 'mousedown') {
      const target = (event as MouseEvent).target as HTMLElement
      if (target.closest('.cm-table-cell')) return true
    }
    return false
  }
}

function tableCell(text: string): HTMLElement {
  const cell = document.createElement('span')
  cell.className = 'cm-table-cell'
  if (text.trim().length > 0) {
    // Packet D: renderInlineOnlyMarkdown uses the bare DOMPurify.sanitize
    // (defaults keep table/tr/td/th), so a single-line inline
    // `<table>…</table>` inside a GFM cell survives as a real sub-grid — no
    // extra allow-list, no extra sink (this innerHTML predates the packet).
    cell.innerHTML = renderInlineOnlyMarkdown(text)
  } else {
    cell.textContent = text
  }
  return cell
}

/**
 * Minimal GFM pipe-table parser for the rendered widget. Delimiter rows must
 * be `-`/`:` combinations; body rows are padded to the header width.
 */
function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
  const lines = text.split('\n')
  if (lines.length < 2) return null
  const headers = parseTableRow(lines[0])
  const separator = parseTableRow(lines[1])
  if (headers.length === 0 || separator.length !== headers.length) return null
  // Packet D: delimiter relaxed to `-{1,}` to match export.ts isTableSep
  // (`| - | - |` is a table in preview AND in RTF/DOCX/PDF export). The old
  // widget tests use `---` separators, which still match.
  if (!separator.every((cell) => /^:?-{1,}:?$/.test(cell))) return null
  const rows: string[][] = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const cells = parseTableRow(line)
    rows.push(headers.map((_, idx) => cells[idx] ?? ''))
  }
  return { headers, rows }
}

// PACKET-D INTENTIONAL DUPLICATE: this pipe-aware splitter is duplicated
// verbatim in src/app/export.ts (splitTableRow). Packet A creates
// src/app/table.ts concurrently — neither copy may import from it; dedupe
// both copies into that module once it lands.
const TABLE_CELL_ESC = String.fromCharCode(0)

/**
 * Split a table row into cells (Packet D: pipe-aware). Strips ONE
 * leading/trailing edge pipe, then splits on `|` EXCEPT when the pipe is
 * (a) an escaped `\|` (via the NUL placeholder trick), (b) inside a `<...>`
 * tag span (e.g. `<a href="a|b">`), or (c) inside a backtick code span (any
 * run length, matched open/close; unclosed runs are literal). Cells are
 * trimmed.
 */
function parseTableRow(line: string): string[] {
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
 * Escape plain cell text for safe re-injection into the rebuilt single-line
 * `<table>` HTML (HTML-widget commit path). Everything read back from the
 * live DOM is treated as text, never as HTML — mirroring the export policy.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Read a live `<th>/<td>` cell with nested tables preserved for the commit
 * path. Walks the cell's direct child nodes IN ORDER:
 * - TEXT → raw text
 * - BR → `\n` (round-trips via `\n`→`<br>` on serialize)
 * - TABLE → its single-line outerHTML (nested kept, newlines stripped)
 * - any other ELEMENT → its textContent (flattened, never HTML)
 * Non-table text is escaped (`&<>"'`, `\n`→`<br>`) and preserved table spans
 * are spliced back in unescaped, so user-inserted nested tables survive a
 * cell commit while everything else stays XSS-safe (re-sanitized on render).
 */
function serializeHtmlCell(cell: HTMLElement): string {
  type Part = { type: 'text'; text: string } | { type: 'table'; html: string }
  const parts: Part[] = []
  let buf = ''
  const flush = (): void => {
    if (buf.length > 0) {
      parts.push({ type: 'text', text: buf })
      buf = ''
    }
  }
  for (const node of Array.from(cell.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      buf += node.textContent ?? ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.tagName === 'BR') {
        buf += '\n'
      } else if (el.tagName === 'BUTTON') {
        // Widget chrome (inner-table Edit buttons) is never cell content.
        continue
      } else if (el.tagName === 'TABLE') {
        flush()
        parts.push({ type: 'table', html: (el.outerHTML as string).replace(/\r?\n/g, '') })
      } else if (el.classList.contains('cm-inner-table-wrap')) {
        // Inner-table wrapper (positioning host for the nested Edit button):
        // recurse into its children so the wrapped table survives as a table
        // span and the button is skipped.
        for (const sub of Array.from(el.childNodes)) {
          if (sub.nodeType === Node.TEXT_NODE) {
            buf += sub.textContent ?? ''
          } else if (sub.nodeType === Node.ELEMENT_NODE) {
            const subEl = sub as HTMLElement
            if (subEl.tagName === 'BUTTON') continue
            if (subEl.tagName === 'BR') buf += '\n'
            else if (subEl.tagName === 'TABLE') {
              flush()
              parts.push({ type: 'table', html: (subEl.outerHTML as string).replace(/\r?\n/g, '') })
            } else {
              buf += subEl.textContent ?? ''
            }
          }
        }
      } else {
        buf += el.textContent ?? ''
      }
    }
  }
  flush()
  return parts
    .map((p) => (p.type === 'table' ? p.html : escapeHtml(p.text).replace(/\n/g, '<br>')))
    .join('')
}

/**
 * Cell selection tracking for the toolbar nested-table insert flow
 * (consumed by app.ts). `path` walks from the OUTERMOST table down to the
 * clicked cell (one {row,col} per nesting level; row = all own-trs in
 * document order, col = th/td order) — so inserts land inside nested cells
 * instead of their outer host. Set on every cell click; NOT cleared on
 * focusout/commit (the toolbar flow needs it after commit — replace starts
 * at the same `from`, so `tableFrom` stays valid). Cleared on click-outside
 * via the mousedown domEventHandler. No visual highlight (removed per user
 * feedback); the contenteditable focus ring marks the editing cell.
 */
export interface HtmlCellStep {
  row: number
  col: number
}
export interface SelectedHtmlCell {
  tableFrom: number
  path: HtmlCellStep[]
}
export let selectedHtmlCell: SelectedHtmlCell | null = null

/** Peek the selected HTML-table cell without clearing it. */
export function peekSelectedHtmlTableCell(): SelectedHtmlCell | null {
  return selectedHtmlCell
}

/** Clear the selected HTML-table cell (click-outside). */
export function clearSelectedHtmlTableCell(): void {
  selectedHtmlCell = null
}

/**
 * Pure scan for raw HTML `<table>...</table>` blocks in plain text.
 * Depth-paired (NOT non-greedy): `<table>` increments, `</table>` decrements,
 * and a range closes only when depth returns to 0 — so a nested table can
 * never truncate its outer range (a non-greedy match ends at the INNER
 * `</table>`, leaving the outer tail to render as raw text). Tags inside
 * fenced-code regions are skipped before pairing so literal examples can't
 * corrupt the depth count; ranges overlapping fences or starting on
 * indented-code lines are dropped so literal `<table>` text is never
 * hijacked. Returns offsets into `src`.
 */
export function findHtmlTableRangesInText(src: string): Array<{ from: number; to: number }> {
  const lines = src.split('\n')
  const lineStarts: number[] = new Array(lines.length)
  let off = 0
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = off
    off += lines[i].length + 1
  }
  const lineCount = lines.length
  const lineFrom = (ln1: number): number => lineStarts[ln1 - 1]
  const lineTo = (ln1: number): number =>
    ln1 < lineCount ? lineStarts[ln1] - 1 : src.length
  const lineAtText = (pos: number): string => {
    let lo = 0
    let hi = lineCount - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lines[lo]
  }
  const fenceRanges: { from: number; to: number }[] = []
  const codeFenceRe = /^ {0,3}(`{3,}|~{3,})/
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  let fenceStart = -1
  for (let ln = 1; ln <= lineCount; ln++) {
    const t = lines[ln - 1]
    const m = codeFenceRe.exec(t)
    if (m !== null) {
      const marker = m[1]
      if (inFence) {
        if (marker[0] === fenceChar && marker.length >= fenceLen && /^ {0,3}[`~]+[ \t]*$/.test(t)) {
          fenceRanges.push({ from: lineFrom(fenceStart), to: lineTo(ln) })
          inFence = false
          fenceStart = -1
        }
      } else {
        inFence = true
        fenceChar = marker[0]
        fenceLen = marker.length
        fenceStart = ln
      }
    }
  }
  if (inFence && fenceStart !== -1) {
    fenceRanges.push({ from: lineFrom(fenceStart), to: src.length })
  }
  const isPosInFence = (pos: number): boolean => {
    for (const fr of fenceRanges) {
      if (pos >= fr.from && pos < fr.to) return true
    }
    return false
  }
  // Depth-paired tag scan (mirrors tableDialog.ts TABLE_TAG_RE): a range
  // starts at an outermost `<table>` and ends at the `</table>` that returns
  // depth to 0. Stray closers are ignored; unclosed opens are dropped.
  const out: { from: number; to: number }[] = []
  const TAG_RE = /<table(?=[\s>])[^<>]*>|<\/table\s*>/gi
  TAG_RE.lastIndex = 0
  let depth = 0
  let rangeStart = -1
  let mm: RegExpExecArray | null
  while ((mm = TAG_RE.exec(src)) !== null) {
    if (mm[0].length === 0) {
      TAG_RE.lastIndex++
      continue
    }
    if (isPosInFence(mm.index)) continue
    const isClose = mm[0][1] === '/'
    if (!isClose) {
      if (depth === 0) rangeStart = mm.index
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0 && rangeStart !== -1) {
        const from = rangeStart
        const to = mm.index + mm[0].length
        rangeStart = -1
        if (!/^(?: {4}|\t)/.test(lineAtText(from))) out.push({ from, to })
      }
    }
  }
  return out
}

/**
 * Find raw HTML `<table>...</table>` blocks by scanning the document text.
 * Thin wrapper over `findHtmlTableRangesInText`. Exported for tests.
 */
export function findHtmlTableRanges(state: EditorState): { from: number; to: number }[] {
  return findHtmlTableRangesInText(state.doc.toString())
}

/**
 * Rendered raw-HTML `<table>...</table>` block (SPLIT behavior: pipe tables
 * keep `MarkdownTableWidget` untouched; HTML blocks get this widget).
 *
 * Structure: `div.cm-html-table-widget > button.cm-html-table-edit`
 * ("Edit table") + `div.cm-html-table-body` holding the sanitized table.
 *
 * - No caret-inside-html (7.1): the widget ALWAYS renders in live mode — the
 *   table is a single atomic character, so the CM caret can never enter the
 *   source HTML (raw visible only in source mode where no widgets exist).
 *   Every container mousedown is swallowed except inside a cell already in
 *   editing mode (contenteditable="true"), where native selection must work.
 *   Clicking a cell records selection + edits inline (contenteditable on
 *   demand) and writes back to source on commit. Clicking elsewhere leaves
 *   the atomic block widget selected.
 * - Edit button (7.2): dispatches `notedown:edit-html-table` for app.ts to
 *   open the table builder dialog for this range.
 * - Backspace (7.3): whole-table deletion is handled by the Prec.highest
 *   Backspace/Delete keymap in livePreviewExtensions (caret at/across the
 *   range boundary removes from..to). This container never traps Backspace:
 *   the only keydown preventDefaults are Enter-commit / Escape-cancel while
 *   a cell is being edited (where Backspace must edit cell text, which it
 *   does via the native contenteditable behavior since ignoreEvent() lets
 *   the DOM handle it).
 */
class MarkdownHtmlTableWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly html: string,
  ) {
    super()
  }

  eq(o: MarkdownHtmlTableWidget): boolean {
    return o.from === this.from && o.to === this.to && o.html === this.html
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-html-table-widget'

    const editBtn = document.createElement('button')
    editBtn.className = 'cm-html-table-edit'
    editBtn.type = 'button'
    editBtn.textContent = 'Edit table'
    editBtn.setAttribute('aria-label', 'Edit table')
    editBtn.title = 'Edit table'
    editBtn.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    })
    editBtn.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Commit any in-progress cell edit first (synchronous dispatch), so
      // the builder preloads the current source instead of stale text.
      // (Closed over `let` bindings declared below — safe: clicks run long
      // after toDOM returns.)
      if (editingCell !== null) commitEdit()
      window.dispatchEvent(new CustomEvent('notedown:edit-html-table', { detail: { from: this.from, to: this.to } }))
    })
    container.appendChild(editBtn)

    const body = document.createElement('div')
    body.className = 'cm-html-table-body'
    // ONLY innerHTML sink in this widget: DOMPurify.sanitize strips scripts /
    // event handlers before injection, so the real <table> element(s) render
    // without XSS (same policy as export.ts, which runs markdown-it html:true).
    body.innerHTML = DOMPurify.sanitize(this.html)
    container.appendChild(body)

    const cells = Array.from(body.querySelectorAll('th,td')) as HTMLElement[]
    for (const cell of cells) {
      cell.setAttribute('contenteditable', 'false')
      cell.style.cursor = 'pointer'
    }

    const outerTable = body.querySelector('table')

    // Nested tables each get their own Edit button: wrap every non-outermost
    // table in a positioning host. (A <button> cannot be a direct child of
    // <table> — the HTML parser would eject it — so the wrapper div inside
    // the host <td> carries it.) Wrappers are transparent to the chain-walk
    // below (closest('table')/closest('th,td') skip divs) and to
    // serializeHtmlCell (which unwraps them and skips buttons).
    if (outerTable !== null) {
      const nestedTables = Array.from(outerTable.querySelectorAll('table'))
      for (const nested of nestedTables) {
        const wrap = document.createElement('div')
        wrap.className = 'cm-inner-table-wrap'
        nested.replaceWith(wrap)
        wrap.appendChild(nested)
        const innerBtn = document.createElement('button')
        innerBtn.type = 'button'
        innerBtn.className = 'cm-html-table-edit cm-inner-table-edit'
        innerBtn.textContent = 'Edit table'
        innerBtn.setAttribute('aria-label', 'Edit nested table')
        innerBtn.title = 'Edit nested table'
        innerBtn.addEventListener('mousedown', (e: MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
        })
        innerBtn.addEventListener('click', (e: MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          if (editingCell !== null) commitEdit()
          const loc = locateNestedTable(nested)
          if (loc === null) {
            window.dispatchEvent(
              new CustomEvent('notedown:edit-html-table', { detail: { from: this.from, to: this.to } }),
            )
          } else {
            window.dispatchEvent(
              new CustomEvent('notedown:edit-html-table', {
                detail: { from: this.from, to: this.to, path: loc.path, tableIndex: loc.tableIndex },
              }),
            )
          }
        })
        wrap.insertBefore(innerBtn, nested)
      }
    }

    // Cells hosting a nested table render flush (no cell padding), so the
    // inner grid meets the cell walls. Recomputed every build; the class is
    // presentation-only (serializeHtmlCell reads childNodes, not classes).
    for (const cell of Array.from(body.querySelectorAll('th,td')) as HTMLElement[]) {
      if (cell.querySelector('table') !== null) cell.classList.add('cm-has-table')
    }

    /**
     * Chain-walk from a clicked cell up to the outermost table, returning
     * the cell path (one {row,col} per nesting level, outermost first).
     * Row = index among the level's own <tr>s in document order; col =
     * index among the row's th/td children. Null when the cell is outside
     * the widget body (shouldn't happen — callers check contains()).
     */
    const cellPathInBody = (cell: HTMLElement): HtmlCellStep[] | null => {
      if (outerTable === null || !body.contains(cell)) return null
      const chain: HtmlCellStep[] = []
      let cur: HTMLElement | null = cell
      while (cur !== null) {
        const tbl = cur.closest('table')
        if (tbl === null || !body.contains(tbl)) return null
        const rowEl = cur.closest('tr')
        if (rowEl === null || rowEl.closest('table') !== tbl) return null
        const ownRows = Array.from(tbl.querySelectorAll('tr')).filter((tr) => tr.closest('table') === tbl)
        const row = ownRows.indexOf(rowEl as HTMLTableRowElement)
        const rowCells = Array.from(rowEl.children).filter(
          (el) => el.tagName === 'TH' || el.tagName === 'TD',
        ) as HTMLElement[]
        const col = rowCells.indexOf(cur)
        if (row < 0 || col < 0) return null
        chain.unshift({ row, col })
        if (tbl === outerTable) return chain
        cur = tbl.closest('th,td') as HTMLElement | null
      }
      return null
    }

    /**
     * Locate a nested <table> element for inner editing: the path of its
     * host cell plus the table's index among that cell's own tables
     * (nearest-cell filter, document order — generator cells hold one).
     */
    const locateNestedTable = (nested: HTMLTableElement): { path: HtmlCellStep[]; tableIndex: number } | null => {
      const host = nested.closest('th,td') as HTMLElement | null
      if (host === null || !body.contains(host)) return null
      const path = cellPathInBody(host)
      if (path === null) return null
      const own = Array.from(host.querySelectorAll('table')).filter((t) => t.closest('th,td') === host)
      const tableIndex = own.indexOf(nested)
      if (tableIndex < 0) return null
      return { path, tableIndex }
    }

    const recordCellSelection = (cell: HTMLElement): void => {
      const path = cellPathInBody(cell)
      if (path === null) return
      selectedHtmlCell = { tableFrom: this.from, path }
    }

    let editingCell: HTMLElement | null = null
    let originalText = ''
    let originalHtml = ''

    const commitEdit = (): void => {
      if (editingCell === null) return
      const cell = editingCell
      const newText = serializeHtmlCell(cell)
      if (newText === originalText) {
        cell.setAttribute('contenteditable', 'false')
        editingCell = null
        return
      }
      const table = body.querySelector('table')
      if (table === null) {
        cell.setAttribute('contenteditable', 'false')
        editingCell = null
        return
      }
      const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
      const rowsHtml = rows
        .map((tr) => {
          const inHead = tr.closest('thead') !== null
          const rowCells = Array.from(tr.children).filter(
            (el) => el.tagName === 'TH' || el.tagName === 'TD',
          ) as HTMLElement[]
          const cellsHtml = rowCells
            .map((c) => {
              // Header serialization: th when the ORIGINAL cell was TH or the
              // row lives in <thead>, else td. Nested tables survive via
              // serializeHtmlCell (already escaped + single-line outerHTML);
              // do NOT re-escape here. Selection is intentionally left
              // untouched on commit (same `from`, stays valid for toolbar).
              const tag = c.tagName === 'TH' || inHead ? 'th' : 'td'
              const txt = c === cell ? newText : serializeHtmlCell(c)
              return `<${tag}>${txt}</${tag}>`
            })
            .join('')
          return `<tr>${cellsHtml}</tr>`
        })
        .join('')
      const newHtml = `<table>${rowsHtml}</table>`
      cell.setAttribute('contenteditable', 'false')
      editingCell = null
      try {
        cell.blur()
      } catch {
        // Blur is best-effort; the widget rebuilds on dispatch regardless.
      }
      const view = EditorView.findFromDOM(container)
      if (view === null) return
      let cur = ''
      try {
        cur = view.state.doc.sliceString(this.from, this.to)
      } catch {
        cur = this.html
      }
      if (cur === newHtml) return
      view.dispatch({ changes: { from: this.from, to: this.to, insert: newHtml } })
    }

    const cancelEdit = (): void => {
      if (editingCell === null) return
      const cell = editingCell
      // originalHtml came from the DOMPurify-sanitized body above, so
      // restoring it verbatim is safe (no new sink).
      cell.innerHTML = originalHtml
      cell.setAttribute('contenteditable', 'false')
      editingCell = null
      cell.blur()
    }

    const startEdit = (cell: HTMLElement): void => {
      if (editingCell === cell) return
      if (editingCell !== null) commitEdit()
      if (!body.contains(cell)) return
      editingCell = cell
      originalText = serializeHtmlCell(cell)
      originalHtml = cell.innerHTML
      cell.setAttribute('contenteditable', 'true')
      cell.focus()
      try {
        const range = document.createRange()
        range.selectNodeContents(cell)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      } catch {
        // Selection is a nicety; editing still works without it.
      }
    }

    // Atomic table: the caret can never enter table source in live mode (the
    // widget ALWAYS renders, even with the caret adjacent — raw HTML is only
    // visible in source mode where no widgets exist). Swallow EVERY mousedown
    // so CM6 never moves the caret into the range, EXCEPT when the target is
    // inside a cell already in editing mode (contenteditable="true"), where
    // native text selection/caret must work.
    container.addEventListener('mousedown', (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (typeof t.closest !== 'function') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (t.closest('[contenteditable="true"]') !== null) return
      e.preventDefault()
      e.stopPropagation()
    })

    container.addEventListener('click', (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (typeof t.closest !== 'function') return
      if (t.closest('.cm-html-table-edit') !== null) return
      const cell = t.closest('th,td') as HTMLElement | null
      if (cell === null || !body.contains(cell)) return
      e.preventDefault()
      e.stopPropagation()
      recordCellSelection(cell)
      startEdit(cell)
    })

    container.addEventListener('focusout', (e: FocusEvent) => {
      if (editingCell === null) return
      const next = e.relatedTarget as unknown as Node | null
      // Moving focus between cells of the SAME widget is handled by the click
      // path (commit-previous-then-start-next); only commit here when focus
      // truly leaves the editing cell to elsewhere.
      if (next !== null && container.contains(next)) {
        const nextEl = next as unknown as HTMLElement
        const nextCell = typeof nextEl.closest === 'function' ? nextEl.closest('th,td') : null
        if (nextCell !== null && nextCell !== editingCell) return
        if (nextCell === editingCell) return
      }
      commitEdit()
    })

    container.addEventListener('keydown', (e: KeyboardEvent) => {
      // Table hotkey (Ctrl/Cmd+T) inside the widget: CM6 never sees widget
      // events (ignoreEvent), so tableHotkeyMap can't fire while a cell has
      // focus. Commit any in-progress edit first (synchronous dispatch, so
      // the doc is current), then route through the same nested-insert flow
      // as the toolbar button. preventDefault also suppresses the browser
      // new-tab accelerator where the page receives the event.
      if (matchesShortcut('table', e)) {
        e.preventDefault()
        e.stopPropagation()
        if (editingCell !== null) commitEdit()
        window.dispatchEvent(new CustomEvent('notedown:insert-nested-table'))
        return
      }
      if (editingCell === null) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        commitEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelEdit()
      }
      // All other keys (notably Backspace/Delete) are intentionally left
      // alone so contenteditable edits cell text natively.
    })

    return container
  }

  /**
   * Always true: CM6 never handles events inside this widget — the edit
   * button + cell editing listeners attached in toDOM run regardless, and
   * Backspace/Delete on the selected (non-editing) widget still removes the
   * whole range via CM6's native atomic-block handling at the editor level.
   */
  ignoreEvent(): boolean {
    return true
  }
}

/**
 * Rendered horizontal rule for inactive `---` lines (E14). Replaces the
 * HorizontalRule node with a `.cm-hr-widget` divider; clicking it places the
 * caret on the line so the raw `---` re-appears.
 */
class HorizontalRuleWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }

  eq(o: HorizontalRuleWidget): boolean {
    return o.from === this.from && o.to === this.to
  }

  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'cm-hr-widget'
    return div
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * Rendered `%% … %%` graph tag for inactive lines. Replaces the whole line
 * with a `.cm-graph-widget` div (styled via editor.css); several tags on one
 * line stack as `.cm-graph-item` divs inside a single widget. Each inner is
 * parsed via `parseGraphTag` and rendered via `graphToHtml` (or
 * `graphToErrorHtml` on parse errors), sanitized with DOMPurify before
 * innerHTML — mirroring `src/app/export.ts`. With the caret on the line the
 * raw source stays visible for editing (Typora-style reveal, decided per
 * line in `buildBlockDecorations`). Clicks never enter edit mode
 * (`ignoreEvent` swallows them); navigating back onto the line with the
 * keyboard reveals the source.
 */
class MarkdownGraphWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly inners: string[],
  ) {
    super()
  }

  eq(o: MarkdownGraphWidget): boolean {
    return (
      o.from === this.from &&
      o.to === this.to &&
      o.inners.length === this.inners.length &&
      o.inners.every((inner, i) => inner === this.inners[i])
    )
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-graph-widget'
    for (const inner of this.inners) {
      const parsed = parseGraphTag(inner)
      const unsafe = parsed.ok ? graphToHtml(parsed.spec) : graphToErrorHtml(parsed.error, `%%${inner}%%`)
      const item = document.createElement('div')
      item.className = 'cm-graph-item'
      item.innerHTML = DOMPurify.sanitize(unsafe)
      container.appendChild(item)
    }
    return container
  }

  ignoreEvent(): boolean {
    return true
  }
}

/**
 * Find single-line `%% … %%` graph tags by scanning the document text
 * (`%%` has no Lezer node, so the syntax tree cannot see it — same approach
 * as the `>>>` dropdown scan). Returns one entry per tag match; callers group
 * by line (a line with several tags renders as one stacked widget).
 * Skips fenced-code regions (tracked from the document start, same fence
 * tracker as the dropdown scan), indented-code lines and table-row-like
 * lines so literal `%%` text is never hijacked. Empty inners are skipped.
 */
function findGraphRanges(state: EditorState): { from: number; to: number; inner: string; raw: string }[] {
  const ranges: { from: number; to: number; inner: string; raw: string }[] = []
  const codeFenceRe = /^ {0,3}(`{3,}|~{3,})/
  let inCodeFence = false
  let codeFenceChar = ''
  let codeFenceLen = 0
  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    const line = state.doc.line(lineNum)
    const text = line.text
    const codeFence = codeFenceRe.exec(text)
    if (codeFence !== null) {
      const marker = codeFence[1]
      if (inCodeFence) {
        if (
          marker[0] === codeFenceChar &&
          marker.length >= codeFenceLen &&
          /^ {0,3}[`~]+[ \t]*$/.test(text)
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
    if (/^(?: {4}|\t)/.test(text)) continue
    if (/^\s*\|/.test(text)) continue
    const tagRe = /%%([^%]*?)%%/g
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(text)) !== null) {
      const inner = m[1]
      if (inner.trim().length === 0) continue
      const from = line.from + m.index
      ranges.push({ from, to: from + m[0].length, inner, raw: m[0] })
    }
  }
  return ranges
}

/**
 * Rendered fenced/indented code block for fully-inactive fences (H).
 * When no line of the fence contains the caret, the whole `FencedCode` /
 * `CodeBlock` node is replaced by a highlighted div (`MarkdownCodeWidget`).
 * Rendering parses the fence info string for a language hint and runs
 * highlight.js when the language is known, mirroring `src/app/export.ts`.
 * With the caret inside, the raw source stays visible for editing.
 */
class MarkdownCodeWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly text: string,
  ) {
    super()
  }

  eq(o: MarkdownCodeWidget): boolean {
    return o.from === this.from && o.to === this.to && o.text === this.text
  }

  toDOM(): HTMLElement {
    ensureHljs()
    const container = document.createElement('div')
    container.className = 'cm-code-widget'
    const lines = this.text.split('\n')
    let lang = ''
    let code = this.text
    if (lines.length > 0) {
      const first = lines[0]
      const fenceMatch = /^ {0,3}(?:`{3,}|~{3,})\s*([^\s`~]*)/.exec(first)
      if (fenceMatch) {
        lang = (fenceMatch[1] ?? '').trim().toLowerCase()
        const last = lines[lines.length - 1]
        const isClosingFence = /^ {0,3}(?:`{3,}|~{3,})\s*$/.test(last)
        const endIdx = isClosingFence ? lines.length - 1 : lines.length
        code = lines.slice(1, endIdx).join('\n')
      }
    }

    const copyBtn = document.createElement('button')
    copyBtn.className = 'cm-code-copy'
    copyBtn.title = 'Copy code'
    copyBtn.setAttribute('aria-label', 'Copy code')
    copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>`
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>`
        }, 2000)
      })
    })

    const pre = document.createElement('pre')
    pre.className = 'cm-code-widget-pre'
    const codeEl = document.createElement('code')
    codeEl.className = 'hljs' + (lang ? ` language-${lang}` : '')
    let html = ''
    if (lang && hljs.getLanguage(lang)) {
      try {
        html = hljs.highlight(code, { language: lang }).value
      } catch {
        html = ''
      }
    }
    if (html) {
      codeEl.innerHTML = html
    } else {
      codeEl.textContent = code
    }
    pre.appendChild(codeEl)
    container.appendChild(copyBtn)
    container.appendChild(pre)
    return container
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement
    if (target.closest('.cm-code-copy')) return true
    return false
  }
}

interface ListMarkerRenderInfo {
  from: number
  to: number
  label: string
  kind: 'unordered' | 'ordered' | 'task'
  bracketFrom?: number
  bracketTo?: number
}

function computeListMarkerWidgets(
  state: EditorState,
  skippedLines: ReadonlySet<number>,
): Map<number, ListMarkerRenderInfo> {
  const tracker = new ListDepthTracker()
  const out = new Map<number, ListMarkerRenderInfo>()

  const codeFenceRe = /^ {0,3}(`{3,}|~{3,})/
  let inCodeFence = false
  let codeFenceChar = ''
  let codeFenceLen = 0

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber)
    const lnText = line.text
    const cf = codeFenceRe.exec(lnText)
    if (cf) {
      const marker = cf[1]
      if (inCodeFence) {
        if (marker[0] === codeFenceChar && marker.length >= codeFenceLen && /^ {0,3}[`~]+[ \t]*$/.test(lnText)) {
          inCodeFence = false
        }
      } else {
        inCodeFence = true
        codeFenceChar = marker[0]
        codeFenceLen = marker.length
      }
      tracker.reset()
      continue
    }
    if (inCodeFence) {
      tracker.reset()
      continue
    }
    if (skippedLines.has(lineNumber)) {
      tracker.reset()
      continue
    }
    if (lnText.trim() === '') {
      tracker.noteBlank()
      continue
    }

    const prefixMatch = /^((?:\s*>\s?)+)/.exec(lnText)
    const prefix = prefixMatch !== null ? prefixMatch[1] : ''
    const contentText = lnText.slice(prefix.length)
    const info = parseListItem(contentText)
    if (info === null) {
      // Wrapped continuation text indented inside a list item must not reset
      // the list context (a nested list may follow it).
      const lead = /^[ \t]*/.exec(contentText)![0].replace(/\t/g, '    ').length
      tracker.noteNonList(lead)
      continue
    }
    const res = tracker.feed(info)

    const markerFrom = line.from + prefix.length + info.indent.length
    const markerText = info.marker.replace(/[ \t]+$/, '')
    const markerTo = markerFrom + markerText.length
    if (markerTo <= markerFrom) continue

    let label: string
    let bracketFrom: number | undefined
    let bracketTo: number | undefined
    if (info.kind === 'task') {
      label = info.checked ? '☑' : '☐'
      bracketFrom = markerFrom + (info.bracketOffset ?? 0)
      bracketTo = bracketFrom + (info.bracketLength ?? 3)
    } else if (info.kind === 'unordered') {
      // U+25E6 (white bullet) renders at the same ink size as U+2022 (bullet)
      // in the UI fonts; U+25CB (white circle) is roughly 3× larger.
      label = res.depth % 2 === 1 ? '•' : '◦'
    } else {
      label = `${res.orderedLabel ?? '1'}.`
    }
    out.set(lineNumber, { from: markerFrom, to: markerTo, label, kind: info.kind, bracketFrom, bracketTo })
  }
  return out
}

function buildDecorations(view: EditorView, opts: LivePreviewPluginOptions): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const { state } = view

  // Reveal scope 'line': the set of line numbers spanned by the selection.
  const activeLines = new Set<number>()
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number
    const endLine = state.doc.lineAt(range.to).number
    for (let l = startLine; l <= endLine; l++) activeLines.add(l)
  }
  const isDrag = state.field(mouseSelectingField, false)

  // Lines excluded from the line-text sweeps below: code blocks stay raw
  // (B10), tables/HRs are either replaced by a widget or shown raw as a unit.
  const skipLines = new Set<number>()
  // Lines covered by an Image replace widget (the sweep must not decorate
  // inside the replaced range).
  const replacedLines = new Set<number>()
  // Lines already carrying the .cm-blockquote line class (dedupe).
  const quoteLines = new Set<number>()
  // Lines that are `>>>` dropdown markers — these must NOT get blockquote
  // styling even though the Lezer tree parses `>` as a QuoteMark.
  const dropdownMarkerLines = new Set<number>()
  // Lines belonging to a Table node that contains the caret (raw mode) — their
  // `|` pipes get faded ghost marks in the active-line pass below. Populated
  // during the tree walk.
  const activeTableLines = new Set<number>()
  // Paired `>>>` marker line numbers (open/close), code-fence aware — mirrors
  // dropdownMarkerLines but keeps pair ranges so the active check can test
  // "caret anywhere inside the pair" (raw mode shows when ANY line is active).
  const dropdownPairs: { open: number; close: number }[] = []
  // Dropdown marker lines already given the active faded mark in the tree walk
  // (dedupe: one mark per line even if Lezer emits several QuoteMarks; also lets
  // the active-line pass skip lines already handled).
  const dropdownVisibleLines = new Set<number>()

  const addLinesTo = (node: { from: number; to: number }, set: Set<number>): void => {
    const start = state.doc.lineAt(node.from).number
    const end = state.doc.lineAt(node.to).number
    for (let l = start; l <= end; l++) set.add(l)
  }

  // Pre-scan for `>>>` dropdown marker pairs so we can suppress blockquote
  // styling on those lines during the tree walk. Lines inside code fences are
  // skipped.
  {
    const fenceRe = /^\s*>>>\s*(.*)$/
    const codeFenceRe = /^ {0,3}(`{3,}|~{3,})/
    let inCodeFence = false
    let codeFenceChar = ''
    let codeFenceLen = 0
    let pendingFrom = -1
    for (let ln = 1; ln <= state.doc.lines; ln++) {
      const lnText = state.doc.line(ln).text
      const cf = codeFenceRe.exec(lnText)
      if (cf) {
        const marker = cf[1]
        if (inCodeFence) {
          if (marker[0] === codeFenceChar && marker.length >= codeFenceLen && /^ {0,3}[`~]+[ \t]*$/.test(lnText)) {
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
      if (fenceRe.test(lnText)) {
        if (pendingFrom < 0) {
          pendingFrom = ln
        } else {
          dropdownMarkerLines.add(pendingFrom)
          dropdownMarkerLines.add(ln)
          dropdownPairs.push({ open: pendingFrom, close: ln })
          pendingFrom = -1
        }
      }
    }
  }

  // Graph tags (`%% … %%`) are plain text to Lezer, so they are scanned
  // directly (see `findGraphRanges`). Tag lines are excluded from every sweep
  // below via `skipLines` (like tables); lines the block widget will replace
  // additionally skip the tree walk so no inline decoration lands inside the
  // replaced range.
  const graphReplacedLines = new Set<number>()
  {
    const tagLines = new Set<number>()
    for (const r of findGraphRanges(state)) tagLines.add(state.doc.lineAt(r.from).number)
    for (const ln of tagLines) {
      skipLines.add(ln)
      if (!activeLines.has(ln) && !isDrag) graphReplacedLines.add(ln)
    }
  }

  // Raw HTML <table> blocks: every line of every HTML range joins skipLines
  // (sweeps stay raw); ALL ranges join htmlReplacedLines whenever NOT
  // dragging so the widget ALWAYS renders in live mode (atomic table — raw
  // visible only in source mode where no widgets exist). Drag-selection stays
  // raw like pipes (isDrag skip). Pipe Table logic below is untouched.
  const htmlRanges = findHtmlTableRanges(state)
  const htmlReplacedLines = new Set<number>()
  for (const r of htmlRanges) {
    const s = state.doc.lineAt(r.from).number
    const e = state.doc.lineAt(Math.max(r.from, r.to - 1)).number
    for (let l = s; l <= e; l++) skipLines.add(l)
    if (!isDrag) {
      for (let l = s; l <= e; l++) htmlReplacedLines.add(l)
    }
  }

  syntaxTree(state).iterate({
    enter: (node) => {
      // Graph lines replaced by the block widget: never decorate inside the
      // replaced range (mirrors the Table branch below). Bare return keeps
      // descending so multi-line ancestors stay precise — every node on the
      // line re-checks this guard. Short-circuits when the doc has no tags.
      if (
        graphReplacedLines.size > 0 &&
        node.name !== 'Document' &&
        graphReplacedLines.has(state.doc.lineAt(node.from).number)
      )
        return
      // Raw HTML tables replaced by the block widget: never decorate inside
      // the replaced range (mirrors the Table/graph guards above).
      if (
        htmlReplacedLines.size > 0 &&
        node.name !== 'Document' &&
        htmlReplacedLines.has(state.doc.lineAt(node.from).number)
      )
        return
      // Images: on inactive lines replace the whole `![alt](src)` construct
      // with a rendered widget; while editing the line the raw markdown stays
      // visible (no decoration). The Image node spans the entire construct, so
      // no other decoration covers its range (inner alt marks are skipped via
      // SKIP_PARENT_TYPES).
      if (node.name === 'Image') {
        const lineNum = state.doc.lineAt(node.from).number
        const isActiveLine = activeLines.has(lineNum)
        if (!isActiveLine || isDrag) {
          const text = state.doc.sliceString(node.from, node.to)
          decorations.push(
            Decoration.replace({
              widget: new MarkdownImageWidget(node.from, node.to, text, opts.imageResolver),
            }).range(node.from, node.to),
          )
          addLinesTo(node, replacedLines)
        }
        return
      }

      // Links: on inactive lines replace the whole `[text](url)` construct
      // with a clickable widget showing only the link text; while editing the
      // line the raw markdown stays visible. Mirrors the Image handler above.
      if (node.name === 'Link') {
        const lineNum = state.doc.lineAt(node.from).number
        const isActiveLine = activeLines.has(lineNum)
        if (!isActiveLine || isDrag) {
          const text = state.doc.sliceString(node.from, node.to)
          decorations.push(
            Decoration.replace({
              widget: new MarkdownLinkWidget(node.from, node.to, text, opts.onLinkClick),
            }).range(node.from, node.to),
          )
        }
        return
      }

      // Fenced/indented code blocks: never collapsed, never swept.
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        addLinesTo(node, skipLines)
        return
      }

      // Tables and horizontal rules are block-level replaces (see the
      // BLOCK-WIDGET NOTE at the top — they are provided via blockRenderField,
      // a direct StateField). Here we only exclude their lines from the sweep
      // and, when they are NOT replaced (caret inside, raw mode), keep walking
      // their children so inline marks inside cells keep their usual behavior.
      if (node.name === 'Table') {
        addLinesTo(node, skipLines)
        const startLine = state.doc.lineAt(node.from).number
        const endLine = state.doc.lineAt(node.to).number
        let hasActiveLine = isDrag
        for (let l = startLine; l <= endLine && !hasActiveLine; l++) hasActiveLine = activeLines.has(l)
        if (hasActiveLine) {
          for (let l = startLine; l <= endLine; l++) activeTableLines.add(l)
          return undefined
        }
        return false
      }
      if (node.name === 'HorizontalRule') {
        addLinesTo(node, skipLines)
        const lineNum = state.doc.lineAt(node.from).number
        return activeLines.has(lineNum) || isDrag ? undefined : false
      }

      // Heading IDs (E16): on inactive heading lines hide the trailing
      // ` {#custom-id}` span with a zero-size widget so it disappears from view.
      if (node.name.startsWith('ATXHeading')) {
        const lineNum = state.doc.lineAt(node.from).number
        if (!activeLines.has(lineNum) || isDrag) {
          const headingText = state.doc.sliceString(node.from, node.to)
          const attrMatch = /[ \t]*\{#[\w-]*\}[ \t]*$/.exec(headingText)
          if (attrMatch !== null) {
            const from = node.from + attrMatch.index
            const to = from + attrMatch[0].length
            decorations.push(Decoration.replace({ widget: new EmptyInlineWidget(from, to) }).range(from, to))
          }
        }
        return
      }

      // Blockquotes (E8): style inactive quote lines so the quote reads
      // visually once the caret leaves (the `>` mark itself is hidden by the
      // generic block-mark decoration below). One line class per line.
      // Skip `>>>` dropdown markers — they must show as plain text, not
      // blockquotes, when the caret is inside the dropdown.
      if (node.name === 'QuoteMark') {
        const line = state.doc.lineAt(node.from)
        if (!dropdownMarkerLines.has(line.number) && !(activeLines.has(line.number) && !isDrag) && !quoteLines.has(line.number)) {
          quoteLines.add(line.number)
          decorations.push(Decoration.line({ class: 'cm-blockquote' }).range(line.from))
        }
      }

      if (!BLOCK_MARK_TYPES.has(node.name) && !INLINE_MARK_TYPES.has(node.name)) return
      if (isInsideSkippedParent(node.node.parent)) return

      if (BLOCK_MARK_TYPES.has(node.name)) {
        const lineNum = state.doc.lineAt(node.from).number
        const isActiveLine = activeLines.has(lineNum)
        if (node.name === 'ListMark') return
        // Skip `>>>` dropdown markers — they must show as plain ">>>" text,
        // not have their `>` characters hidden. Active pairs (caret anywhere
        // inside the pair's open/close range, i.e. raw mode) get a faded ghost
        // mark on the leading `>>>` so they match every other revealed syntax.
        if (node.name === 'QuoteMark' && dropdownMarkerLines.has(lineNum)) {
          if (!dropdownVisibleLines.has(lineNum)) {
            const pair = dropdownPairs.find((p) => p.open === lineNum || p.close === lineNum)
            let pairActive = false
            if (pair !== undefined) {
              for (let l = pair.open; l <= pair.close; l++) {
                if (activeLines.has(l)) {
                  pairActive = true
                  break
                }
              }
            } else {
              pairActive = activeLines.has(lineNum)
            }
            if (pairActive) {
              const markerLine = state.doc.line(lineNum)
              const markerMatch = /^\s*>>>/.exec(markerLine.text)
              if (markerMatch !== null) {
                const markerFrom = markerLine.from + markerMatch[0].indexOf('>>>')
                decorations.push(
                  Decoration.mark({ class: 'cm-formatting-block cm-formatting-block-visible' }).range(
                    markerFrom,
                    markerFrom + 3,
                  ),
                )
                dropdownVisibleLines.add(lineNum)
              }
            }
          }
          return
        }
        const cls = isActiveLine && !isDrag ? 'cm-formatting-block cm-formatting-block-visible' : 'cm-formatting-block'
        decorations.push(Decoration.mark({ class: cls }).range(node.from, node.to))
        return
      }

      if (node.from >= node.to) return
      // FORK: reveal when the caret intersects the WHOLE formatting element (parent),
      // not just the mark chars — the package's README-documented behavior.
      const parent = node.node.parent
      const elementFrom = parent ? parent.from : node.from
      const elementTo = parent ? parent.to : node.to
      const isTouched = shouldShowSource(state, elementFrom, elementTo)
      // E3 — `__underline__`: StrongEmphasis with `__` marks renders the
      // content (between the marks) with .cm-underline instead of plain bold
      // when collapsed. The marks themselves keep the formatting-hidden
      // behavior below; the package's .cm-strong mark on the whole node stays,
      // so .cm-underline overrides the weight via CSS.
      if (
        node.name === 'EmphasisMark' &&
        parent !== null &&
        parent.name === 'StrongEmphasis' &&
        node.from === parent.from &&
        parent.to - parent.from > 4 &&
        state.doc.sliceString(parent.from, parent.from + 2) === '__'
      ) {
        decorations.push(Decoration.mark({ class: 'cm-underline' }).range(parent.from + 2, parent.to - 2))
      }
      const cls = isTouched && !isDrag ? 'cm-formatting-inline cm-formatting-inline-visible' : 'cm-formatting-inline'
      decorations.push(Decoration.mark({ class: cls }).range(node.from, node.to))
    },
  })

  // ---- Highlight (`==text==`) on ALL lines (E20) ---------------------------
  // Unlike other line-text syntax, highlight renders on active lines too so the
  // yellow background is visible while typing (matching bold/italic behavior).
  // `==` marks are revealed faded when the caret is inside the region, hidden
  // on inactive lines (same reveal logic as inline marks in the tree walk).
  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    if (skipLines.has(lineNum) || replacedLines.has(lineNum)) continue
    const line = state.doc.line(lineNum)
    const text = line.text
    if (text.length === 0) continue

    const eqRe = /==/g
    const eqPositions: number[] = []
    let eqMatch: RegExpExecArray | null
    while ((eqMatch = eqRe.exec(text)) !== null) eqPositions.push(line.from + eqMatch.index)

    // Content between paired == marks: always apply highlight styling
    for (let i = 0; i + 1 < eqPositions.length; i += 2) {
      const open = eqPositions[i]
      const close = eqPositions[i + 1]
      if (close > open + 2) {
        decorations.push(Decoration.mark({ class: 'cm-highlight-content' }).range(open + 2, close))
      }
    }

    // == marks: reveal faded when caret is inside the highlight region,
    // hide on inactive lines otherwise.
    const isActiveHL = activeLines.has(lineNum)
    for (let i = 0; i + 1 < eqPositions.length; i += 2) {
      const open = eqPositions[i]
      const close = eqPositions[i + 1]
      const caretInside =
        !isDrag &&
        isActiveHL &&
        state.selection.ranges.some((r) => r.head >= open && r.head <= close + 2)
      for (const pos of [open, close]) {
        if (caretInside) {
          decorations.push(
            Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(pos, pos + 2),
          )
        } else {
          decorations.push(
            Decoration.replace({ widget: new EmptyInlineWidget(pos, pos + 2) }).range(pos, pos + 2),
          )
        }
      }
    }
  }

  // ---- Sub/sup on ALL lines (E18/E19/B17) ---------------------------------
  // `<sub>/<sup>` tags, `~sub~` and `^sup^` render on active lines too so
  // the styling is visible while typing. Delimiters are revealed faded when
  // the caret is inside the region, hidden otherwise.
  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    if (skipLines.has(lineNum) || replacedLines.has(lineNum)) continue
    const line = state.doc.line(lineNum)
    const text = line.text
    if (text.length === 0) continue
    const isActiveLine = activeLines.has(lineNum)

    // `<sub>…</sub>` / `<sup>…</sup>` tags
    const tagRe = /<(\/)?(sub|sup)>/g
    const tagPositions: { from: number; to: number; isClose: boolean; tag: 'sub' | 'sup' }[] = []
    let tagMatch: RegExpExecArray | null
    while ((tagMatch = tagRe.exec(text)) !== null) {
      const from = line.from + tagMatch.index
      const to = from + tagMatch[0].length
      tagPositions.push({ from, to, isClose: tagMatch[1] === '/', tag: tagMatch[2] as 'sub' | 'sup' })
    }
    // Match open/close tags and style content between matched pairs
    const matchedRanges: { from: number; to: number; tag: 'sub' | 'sup' }[] = []
    const unmatchedTagIdxs = new Set<number>()
    const opens: { tag: 'sub' | 'sup'; end: number; idx: number }[] = []
    for (let i = 0; i < tagPositions.length; i++) {
      const tp = tagPositions[i]
      if (!tp.isClose) {
        opens.push({ tag: tp.tag, end: tp.to, idx: i })
      } else {
        let matched = false
        for (let j = opens.length - 1; j >= 0; j--) {
          if (opens[j].tag === tp.tag) {
            matchedRanges.push({ from: opens[j].end, to: tp.from, tag: tp.tag })
            opens.splice(j, 1)
            matched = true
            break
          }
        }
        if (!matched) unmatchedTagIdxs.add(i)
      }
    }
    for (const o of opens) unmatchedTagIdxs.add(o.idx)
    // Content between matched pairs: always style
    for (const r of matchedRanges) {
      if (r.to > r.from) {
        decorations.push(
          Decoration.mark({ class: r.tag === 'sub' ? 'cm-sub-content' : 'cm-sup-content' }).range(r.from, r.to),
        )
      }
    }
    // Tags: reveal faded when caret is inside, hide otherwise
    for (let i = 0; i < tagPositions.length; i++) {
      const tp = tagPositions[i]
      const caretInside =
        !isDrag && isActiveLine && state.selection.ranges.some((r) => r.head >= tp.from && r.head <= tp.to)
      if (caretInside) {
        decorations.push(
          Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(tp.from, tp.to),
        )
      } else {
        decorations.push(
          Decoration.replace({ widget: new EmptyInlineWidget(tp.from, tp.to) }).range(tp.from, tp.to),
        )
      }
    }

    // `~sub~` : single-tilde delimiters (skip ~~)
    {
      const tildePositions: number[] = []
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== '~') continue
        if ((i > 0 && text[i - 1] === '~') || (i + 1 < text.length && text[i + 1] === '~')) continue
        tildePositions.push(line.from + i)
      }
      for (let i = 0; i + 1 < tildePositions.length; i += 2) {
        const open = tildePositions[i]
        const close = tildePositions[i + 1]
        if (close > open + 1) {
          decorations.push(Decoration.mark({ class: 'cm-sub-content' }).range(open + 1, close))
        }
        const caretInside =
          !isDrag && isActiveLine && state.selection.ranges.some((r) => r.head >= open && r.head <= close + 1)
        for (const pos of [open, close]) {
          if (caretInside) {
            decorations.push(
              Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(pos, pos + 1),
            )
          } else {
            decorations.push(
              Decoration.replace({ widget: new EmptyInlineWidget(pos, pos + 1) }).range(pos, pos + 1),
            )
          }
        }
      }
    }

    // `^sup^` : single-caret delimiters; skip footnote [^...]
    {
      const caretPositions: number[] = []
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== '^') continue
        if (i > 0 && text[i - 1] === '[') continue
        caretPositions.push(line.from + i)
      }
      for (let i = 0; i + 1 < caretPositions.length; i += 2) {
        const open = caretPositions[i]
        const close = caretPositions[i + 1]
        if (close > open + 1) {
          decorations.push(Decoration.mark({ class: 'cm-sup-content' }).range(open + 1, close))
        }
        const caretInside =
          !isDrag && isActiveLine && state.selection.ranges.some((r) => r.head >= open && r.head <= close + 1)
        for (const pos of [open, close]) {
          if (caretInside) {
            decorations.push(
              Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(pos, pos + 1),
            )
          } else {
            decorations.push(
              Decoration.replace({ widget: new EmptyInlineWidget(pos, pos + 1) }).range(pos, pos + 1),
            )
          }
        }
      }
    }
  }

  // ---- Active-line muted syntax (task brackets, table pipes, deflist colons, >>>) --
  // Active (caret-inside) lines show raw source. Previously the markers below
  // showed in default text color while every other syntax showed faded ghost
  // via `*-visible` classes. Add ghost marks here so active lines read
  // consistently. Marks only (never replaces) so they compose with the
  // ListMark/QuoteMark marks from the tree walk. Active line → visible, even
  // during drag (kept simple; `isDrag` is intentionally NOT gated here).
  // Separate from the inactive sweep below — inactive widget behavior is untouched.
  for (const lineNum of activeLines) {
    if (lineNum < 1 || lineNum > state.doc.lines) continue
    if (replacedLines.has(lineNum)) continue
    const line = state.doc.line(lineNum)
    const text = line.text
    if (text.length === 0) continue

    // Table pipes: active tables (caret inside → raw mode) get every `|`
    // faded. Table lines live in skipLines by design, so this branch runs
    // before the skipLines guard below; code fences never contain Tables.
    if (activeTableLines.has(lineNum)) {
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '|') {
          decorations.push(
            Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(
              line.from + i,
              line.from + i + 1,
            ),
          )
        }
      }
      // Table rows never match the task/deflist/dropdown patterns below, but
      // skip them anyway: they are in skipLines and must stay raw otherwise.
      continue
    }
    if (skipLines.has(lineNum)) continue

    // Task prefix: mark the WHOLE prefix (indent + bullet + gap + bracket +
    // trailing spaces) as one range, mirroring the inactive ListMarkerWidget
    // replace range `line.from..line.from + headLen`. Overlapping the tree
    // walk's ListMark `cm-formatting-block-visible` mark on the bullet is safe
    // (nested same-class marks render identically), and it covers non-standard
    // spellings (`-[]`, `- []`, `-[ ]`, `-[x]`, ...) where Lezer emits no
    // ListMark at all (plain Paragraph), so the bullet would otherwise show in
    // default text color. Same trigger covers `*`/`+` bullets, indent, `X`.
    {
      const taskMatch = /^(\s*)[-*+]\s*\[([ xX]?)\]\s*/.exec(text)
      if (taskMatch !== null) {
        decorations.push(
          Decoration.mark({ class: 'cm-formatting-block cm-formatting-block-visible' }).range(
            line.from,
            line.from + taskMatch[0].length,
          ),
        )
      }
    }

    // Deflist colon: same `/^\s*:/` trigger as the inactive `.cm-deflist` line
    // class; cover just the leading `:` so it reads faded while editing.
    if (/^\s*:/.test(text)) {
      const colonMatch = /^(\s*):/.exec(text)
      if (colonMatch !== null) {
        const colonFrom = line.from + colonMatch[1].length
        decorations.push(
          Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(
            colonFrom,
            colonFrom + 1,
          ),
        )
      }
    }

    // Dropdown `>>>` fallback: the tree-walk QuoteMark branch already marks
    // active `>>>` lines (one mark per line via dropdownVisibleLines). Cover
    // lines where Lezer emitted no QuoteMark so the marker never shows default
    // color. Only when this marker's pair is active (caret anywhere between
    // the pair's open/close lines — raw mode shows for the whole pair).
    if (dropdownMarkerLines.has(lineNum) && !dropdownVisibleLines.has(lineNum)) {
      const pair = dropdownPairs.find((p) => p.open === lineNum || p.close === lineNum)
      let pairActive = false
      if (pair !== undefined) {
        for (let l = pair.open; l <= pair.close; l++) {
          if (activeLines.has(l)) {
            pairActive = true
            break
          }
        }
      } else {
        pairActive = true
      }
      if (pairActive) {
        const markerMatch = /^\s*>>>/.exec(text)
        if (markerMatch !== null) {
          const markerFrom = line.from + markerMatch[0].indexOf('>>>')
          decorations.push(
            Decoration.mark({ class: 'cm-formatting-block cm-formatting-block-visible' }).range(
              markerFrom,
              markerFrom + 3,
            ),
          )
          dropdownVisibleLines.add(lineNum)
        }
      }
    }
  }

  // ---- Line-text syntax (no dedicated tree nodes) ---------------------------
  // `-# subtext` and definition lists are plain text to lezer, so they are
  // handled by scanning inactive lines directly. Active lines (being edited)
  // and lines inside code blocks / table / hr / image widgets are skipped.

  // Footnote definitions: build a map of `[^N]` → definition position so
  // footnote references can scroll to them on click.
  const footnoteDefs = new Map<number, number>()
  for (let ln = 1; ln <= state.doc.lines; ln++) {
    const defLine = state.doc.line(ln)
    const defMatch = /^\[\^(\d+)\]:\s/.exec(defLine.text)
    if (defMatch !== null) {
      footnoteDefs.set(parseInt(defMatch[1], 10), defLine.from)
    }
  }

  const listMarkers = computeListMarkerWidgets(state, skipLines)

  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    if (skipLines.has(lineNum) || replacedLines.has(lineNum)) continue
    const line = state.doc.line(lineNum)
    const text = line.text
    if (text.length === 0) continue

    // `-# note` subtext (Other Noted Issues #5): hide the `-# ` prefix, style
    // the rest of the line as muted italic. Round-6 Other Notes: unlike the
    // branches below, this one also runs on ACTIVE lines (being edited) —
    // fading the prefix ghost-style and keeping the tail muted — so typing a
    // subtext reads consistently instead of raw.
    {
      const subtextMatch = /^\s*-#[ \t]/.exec(text)
      if (subtextMatch !== null) {
        const from = line.from
        const to = from + subtextMatch[0].length
        if (activeLines.has(lineNum)) {
          decorations.push(
            Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(from, to),
          )
        } else {
          decorations.push(Decoration.replace({ widget: new EmptyInlineWidget(from, to) }).range(from, to))
        }
        if (to < line.to) {
          decorations.push(Decoration.mark({ class: 'cm-subtext' }).range(to, line.to))
        }
      }
    }

    // List markers. Inactive lines always show the rendered indicator. On the
    // active ordered line keep showing the depth-cycled indicator too (e.g. a
    // nested source `4.` renders as `b.`) so the line being edited matches the
    // rest of its list; the raw source marker is revealed only while the caret
    // is actually on the marker itself. Bullets/tasks keep their raw source on
    // the active line (editing `-` / `[ ]` stays direct).
    const lm = listMarkers.get(lineNum)
    if (lm !== undefined) {
      const isActive = activeLines.has(lineNum)
      const caretOnMarker =
        isActive &&
        !isDrag &&
        state.selection.ranges.some((r) => r.from <= lm.to && r.to >= lm.from)
      const showWidget = !isActive || (lm.kind === 'ordered' && !caretOnMarker)
      if (showWidget) {
        decorations.push(
          Decoration.replace({
            widget: lm.bracketFrom !== undefined && lm.bracketTo !== undefined
              ? new ListMarkerWidget(lm.label, lm.from, lm.to, lm.bracketFrom, lm.bracketTo, view)
              : new ListMarkerWidget(lm.label, lm.from, lm.to),
          }).range(lm.from, lm.to),
        )
      }
    }

    if (activeLines.has(lineNum)) continue

    // Definition list (E18/F2): lines starting with `: ` / `:` on inactive
    // lines are definition-list definitions (markdown-it-deflist: `Term\n: def`).
    // Style the line so it is visibly indented/muted when the caret is elsewhere.
    // The export already renders <dl>/<dt>/<dd> via markdown-it-deflist and
    // MARKDOWN_BODY_CSS; this live-preview decoration mirrors it.
    if (/^\s*:/.test(text)) {
      decorations.push(Decoration.line({ class: 'cm-deflist' }).range(line.from))
    }

    // Footnote references: replace `[^N]` with a clickable superscript link
    // that scrolls to the corresponding `[^N]: …` definition.
    {
      const re = /\[\^(\d+)\]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const num = parseInt(m[1], 10)
        const defFrom = footnoteDefs.get(num)
        if (defFrom !== undefined) {
          const from = line.from + m.index
          const to = from + m[0].length
          decorations.push(
            Decoration.replace({
              widget: new FootnoteRefWidget(num, defFrom, view),
            }).range(from, to),
          )
        }
      }
    }

  }

  // ---- Spoiler (`||text||`) on ALL lines ----------------------------------
  // Per-spoiler (not per-line) reveal: the caret position decides per pair, so
  // a caret elsewhere on the same line still shows the cover while a caret
  // anywhere inside `||...||` (delimiters inclusive) shows raw source with
  // faded delimiters. Skips only code/table/HR/image lines — active lines are
  // intentionally NOT skipped so step 1 (editing) stays reachable.
  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    if (skipLines.has(lineNum) || replacedLines.has(lineNum)) continue
    const line = state.doc.line(lineNum)
    const text = line.text
    if (text.length === 0) continue
    const pipeRe = /\|\|/g
    const pipePositions: number[] = []
    let pm: RegExpExecArray | null
    while ((pm = pipeRe.exec(text)) !== null) {
      // Skip if inside a backtick code span
      const before = text.slice(0, pm.index)
      const backtickCount = (before.match(/`/g) ?? []).length
      if (backtickCount % 2 === 1) continue
      pipePositions.push(line.from + pm.index)
    }
    for (let i = 0; i + 1 < pipePositions.length; i += 2) {
      const open = pipePositions[i]
      const close = pipePositions[i + 1]
      const innerFrom = open + 2
      const innerTo = close
      if (innerTo <= innerFrom) continue
      const caretInside =
        !isDrag && state.selection.ranges.some((r) => r.head >= open && r.head <= close + 2)
      if (caretInside || isDrag) {
        // Reveal the raw || delimiters faded when caret is inside
        decorations.push(
          Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(open, open + 2),
        )
        decorations.push(
          Decoration.mark({ class: 'cm-formatting-inline cm-formatting-inline-visible' }).range(close, close + 2),
        )
      } else {
        // Censored spoiler widget
        const innerText = state.doc.sliceString(innerFrom, innerTo)
        decorations.push(
          Decoration.replace({
            widget: new SpoilerWidget(open, close + 2, innerText),
          }).range(open, close + 2),
        )
      }
    }
  }

  return Decoration.set(decorations.sort((a, b) => a.from - b.from), true)
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    private readonly opts: LivePreviewPluginOptions

    constructor(view: EditorView, opts: LivePreviewPluginOptions) {
      this.opts = opts
      this.decorations = buildDecorations(view, opts)
    }

    update(update: ViewUpdate): void {
      const action = checkUpdateAction(update)
      const reconfigured = update.transactions.some((tr) => tr.reconfigured)
      const facetChanged =
        update.startState.facet(collapseOnSelectionFacet) !== update.state.facet(collapseOnSelectionFacet)
      // B6: Lezer parses incrementally with a time budget (viewport-limited).
      // After a Source↔Live toggle via StateEffect.reconfigure the tree may be
      // truncated (~first 42 lines) until the parser finishes in the background.
      // That completion arrives with no docChange/viewportChange/selectionSet,
      // so checkUpdateAction returns 'none' and decorations would stay truncated.
      // Detect tree growth and geometry/viewport changes explicitly.
      const treeGrew = syntaxTree(update.state).length !== syntaxTree(update.startState).length
      const geometryChanged = (update as unknown as { geometryChanged: boolean }).geometryChanged === true
      // B17: ensure sub/sup for ~^ on inactive lines renders immediately when caret leaves the line.
      // checkUpdateAction covers selectionSet, but add explicit selection/doc change guards so a
      // caret move to the adjacent line (which may not change tree length or viewport) always rebuilds.
      const selectionChanged = update.selectionSet || update.transactions.some((tr) => tr.selection)
      const docChanged = update.docChanged
      const needsRebuild =
        action === 'rebuild' ||
        reconfigured ||
        facetChanged ||
        treeGrew ||
        geometryChanged ||
        update.viewportChanged ||
        selectionChanged ||
        docChanged
      if (needsRebuild) {
        this.decorations = buildDecorations(update.view, this.opts)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// ---------------------------------------------------------------------------
// Block-level live preview (tables, horizontal rules, graphs).
// ---------------------------------------------------------------------------

/**
 * Build block-replace decorations (tables on fully-inactive line ranges,
 * horizontal rules and `%%` graph tags on inactive lines). Provided through a StateField because
 * CM6 rejects block widgets / line-break-covering replaces from plugin
 * decoration functions (see the BLOCK-WIDGET NOTE at the top of this file).
 */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = []

  const activeLines = new Set<number>()
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number
    const endLine = state.doc.lineAt(range.to).number
    for (let l = startLine; l <= endLine; l++) activeLines.add(l)
  }
  const isDrag = state.field(mouseSelectingField, false)

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'FencedCode') {
        const startLine = state.doc.lineAt(node.from).number
        const endLine = state.doc.lineAt(node.to).number
        let hasActiveLine = isDrag
        for (let l = startLine; l <= endLine && !hasActiveLine; l++) hasActiveLine = activeLines.has(l)
        if (!hasActiveLine) {
          const text = state.doc.sliceString(node.from, node.to)
          decorations.push(
            Decoration.replace({ widget: new MarkdownCodeWidget(node.from, node.to, text), block: true }).range(node.from, node.to),
          )
        }
        return false
      }
      if (node.name === 'CodeBlock') {
        const startLine = state.doc.lineAt(node.from).number
        const endLine = state.doc.lineAt(node.to).number
        let hasActiveLine = isDrag
        for (let l = startLine; l <= endLine && !hasActiveLine; l++) hasActiveLine = activeLines.has(l)
        if (!hasActiveLine) {
          const text = state.doc.sliceString(node.from, node.to)
          decorations.push(
            Decoration.replace({ widget: new MarkdownCodeWidget(node.from, node.to, text), block: true }).range(node.from, node.to),
          )
        }
        return false
      }
      if (node.name === 'Table') {
        // Replace only when EVERY line of the table lacks the caret; with the
        // caret inside, the raw source stays (the cell marks keep their usual
        // per-line behavior).
        const startLine = state.doc.lineAt(node.from).number
        const endLine = state.doc.lineAt(node.to).number
        let hasActiveLine = isDrag
        for (let l = startLine; l <= endLine && !hasActiveLine; l++) hasActiveLine = activeLines.has(l)
        if (!hasActiveLine) {
          const text = state.doc.sliceString(node.from, node.to)
          decorations.push(
            Decoration.replace({ widget: new MarkdownTableWidget(node.from, node.to, text), block: true }).range(node.from, node.to),
          )
        }
        return false
      }
      if (node.name === 'HorizontalRule') {
        const lineNum = state.doc.lineAt(node.from).number
        if (!activeLines.has(lineNum) || isDrag) {
          decorations.push(
            Decoration.replace({ widget: new HorizontalRuleWidget(node.from, node.to), block: true }).range(node.from, node.to),
          )
        }
        return false
      }
    },
  })

  // ---- >>> dropdown blocks (line-by-line scan, not in Lezer tree) -----------
  // `>>>` is not recognized by the markdown parser, so we scan for paired
  // `>>>` lines directly. Lines inside code fences are skipped.
  const fenceRe = /^\s*>>>\s*(.*)$/
  const codeFenceRe = /^ {0,3}(`{3,}|~{3,})/
  let inCodeFence = false
  let codeFenceChar = ''
  let codeFenceLen = 0
  let pendingFenceFrom = -1
  let pendingFenceName = ''
  // Track lines already consumed by dropdown replacements
  const dropdownLines = new Set<number>()

  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    const line = state.doc.line(lineNum)
    const text = line.text

    // Track code fences
    const codeFence = codeFenceRe.exec(text)
    if (codeFence) {
      const marker = codeFence[1]
      if (inCodeFence) {
        if (
          marker[0] === codeFenceChar &&
          marker.length >= codeFenceLen &&
          /^ {0,3}[`~]+[ \t]*$/.test(text)
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

    const m = fenceRe.exec(text)
    if (m) {
      if (pendingFenceFrom < 0) {
        pendingFenceFrom = line.from
        pendingFenceName = (m[1] ?? '').trim()
      } else {
        // Closing >>> — check if ANY line in the range has the caret
        const closeTo = line.to
        const startLineNum = state.doc.lineAt(pendingFenceFrom).number
        const endLineNum = lineNum
        let hasActiveLine = isDrag
        for (let l = startLineNum; l <= endLineNum && !hasActiveLine; l++) {
          hasActiveLine = activeLines.has(l)
        }
        if (!hasActiveLine) {
          const innerFrom = state.doc.lineAt(pendingFenceFrom).to + 1
          const innerTo = line.from
          const innerText = innerTo > innerFrom ? state.doc.sliceString(innerFrom, innerTo) : ''
          decorations.push(
            Decoration.replace({
              widget: new DropdownWidget(pendingFenceFrom, closeTo, innerText, pendingFenceName),
              block: true,
            }).range(pendingFenceFrom, closeTo),
          )
          for (let l = startLineNum; l <= endLineNum; l++) dropdownLines.add(l)
        }
        pendingFenceFrom = -1
        pendingFenceName = ''
      }
    }
  }

  // ---- %% graph tags (line-text scan, no Lezer node) -----------------------
  // Single-line `%% … %%` tags render as one block widget per line (several
  // tags on a line stack inside a single widget). Typora-style reveal: with
  // the caret on the line (or while mouse-dragging) the raw source stays so
  // the tag remains editable. Parse errors still replace — the error box is
  // visible in live mode too.
  {
    const byLine = new Map<number, { from: number; to: number; inners: string[] }>()
    for (const r of findGraphRanges(state)) {
      const line = state.doc.lineAt(r.from)
      const entry = byLine.get(line.number)
      if (entry === undefined) {
        byLine.set(line.number, { from: line.from, to: line.to, inners: [r.inner] })
      } else {
        entry.inners.push(r.inner)
      }
    }
    for (const [lineNum, entry] of byLine) {
      const hasActiveLine = isDrag || activeLines.has(lineNum)
      if (!hasActiveLine) {
        decorations.push(
          Decoration.replace({
            widget: new MarkdownGraphWidget(entry.from, entry.to, entry.inners),
            block: true,
          }).range(entry.from, entry.to),
        )
      }
    }
  }

  // ---- Raw HTML <table> blocks (doc-text scan, no Lezer dependency) --------
  // Pipe tables keep MarkdownTableWidget untouched above; HTML blocks render
  // via MarkdownHtmlTableWidget with inline cell editing + Edit-button dialog
  // affordance. ALWAYS replaced in live mode (atomic table: caret adjacent
  // never flashes raw); only drag-selection keeps raw source (isDrag skip,
  // like pipes). Block replace widgets are atomic in CM6 — see the Backspace/
  // Delete keymap in livePreviewExtensions for whole-table deletion.
  for (const r of findHtmlTableRanges(state)) {
    if (isDrag) continue
    const html = state.doc.sliceString(r.from, r.to)
    decorations.push(
      Decoration.replace({ widget: new MarkdownHtmlTableWidget(r.from, r.to, html), block: true }).range(r.from, r.to),
    )
  }

  return Decoration.set(decorations.sort((a, b) => a.from - b.from), true)
}

/**
 * Direct provider for the block-level replaces (mirrors the package's own
 * `tableField` update logic: rebuild on doc/config changes and selection
 * moves, hold during drags).
 */
const blockRenderField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state)
  },
  update(deco, tr) {
    if (tr.docChanged || tr.reconfigured) return buildBlockDecorations(tr.state)
    const isDragging = tr.state.field(mouseSelectingField, false)
    const wasDragging = tr.startState.field(mouseSelectingField, false)
    if (wasDragging && !isDragging) return buildBlockDecorations(tr.state)
    if (isDragging) return deco
    if (tr.selection) return buildBlockDecorations(tr.state)
    // B6: incremental Lezer parse after a reconfigure (mode toggle) may finish
    // without a doc change, leaving tables/HRs truncated. Rebuild when the
    // tree grew in the background.
    if (syntaxTree(tr.state).length !== syntaxTree(tr.startState).length) return buildBlockDecorations(tr.state)
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// ---------------------------------------------------------------------------

/**
 * Assemble the live-preview extensions from the pinned package + our fork.
 * `collapse: false` yields source mode (all marks visible); `true` hides marks and
 * reveals them only while the caret is inside the region (faded-grey via cmTheme).
 *
 * IMPORTANT: the live-preview decoration plugin is only included when `collapse: true`.
 * With `collapse: false` our inline reveal uses `shouldShowSource`, which returns false
 * and would therefore apply the HIDDEN `.cm-formatting-inline` class (opacity 0) — the
 * opposite of source mode. Excluding the plugin leaves all syntax visible while
 * `markdownStylePlugin` + `editorTheme` still provide readable styling.
 * (Verified in tests/editor.smoke.test.ts.)
 */
export function livePreviewExtensions(opts?: LivePreviewOptions): Extension[] {
  const collapse = opts?.collapse ?? true
  const extensions: Extension[] = [collapseOnSelectionFacet.of(collapse), mouseSelectingField]
  if (collapse) {
    extensions.push(livePreviewPlugin.of({ imageResolver: opts?.imageResolver, onLinkClick: opts?.onLinkClick }), blockRenderField)
    // Click-outside clears the toolbar insert target (selection survives
    // focusout/commit so the toolbar flow works after editing).
    extensions.push(
      EditorView.domEventHandlers({
        mousedown: (event) => {
          const t = event.target as HTMLElement
          if (typeof t.closest !== 'function' || t.closest('.cm-html-table-widget') === null) {
            clearSelectedHtmlTableCell()
          }
          return false
        },
      }),
    )
    // Whole-table Backspace/Delete: the atomic HTML widget must delete as one
    // unit. Collapsed selections only — non-collapsed fall through (default
    // text deletion already removes widget text). First match wins.
    extensions.push(
      Prec.highest(
        keymap.of([
          {
            key: 'Backspace',
            run: (view) => {
              const sel = view.state.selection.main
              if (!sel.empty) return false
              const h = sel.head
              const ranges = findHtmlTableRanges(view.state)
              for (const r of ranges) {
                if (h === r.to + 1 && view.state.doc.sliceString(r.to, r.to + 1) === '\n') {
                  view.dispatch({ changes: { from: r.from, to: h }, scrollIntoView: true })
                  return true
                }
              }
              for (const r of ranges) {
                if (h === r.to) {
                  view.dispatch({ changes: { from: r.from, to: r.to }, scrollIntoView: true })
                  return true
                }
              }
              return false
            },
          },
          {
            key: 'Delete',
            run: (view) => {
              const sel = view.state.selection.main
              if (!sel.empty) return false
              const h = sel.head
              const ranges = findHtmlTableRanges(view.state)
              for (const r of ranges) {
                if (h === r.from - 1 && view.state.doc.sliceString(h, h + 1) === '\n') {
                  view.dispatch({ changes: { from: h, to: r.to }, scrollIntoView: true })
                  return true
                }
              }
              for (const r of ranges) {
                if (h === r.from) {
                  view.dispatch({ changes: { from: r.from, to: r.to }, scrollIntoView: true })
                  return true
                }
              }
              return false
            },
          },
        ]),
      ),
    )
  }
  extensions.push(markdownStylePlugin, editorTheme)
  return extensions
}

/**
 * Track mouse drag selection so marks don't flicker during drags. Bound per README
 * quick-start: mousedown on the editor content, mouseup anywhere on the document.
 * Returns a cleanup function that removes both listeners.
 */
export function wireMouseSelection(view: EditorView): () => void {
  const onDown = () => {
    view.dispatch({ effects: setMouseSelecting.of(true) })
  }
  const onUp = () => {
    view.dispatch({ effects: setMouseSelecting.of(false) })
  }
  view.contentDOM.addEventListener('mousedown', onDown)
  document.addEventListener('mouseup', onUp)
  return () => {
    view.contentDOM.removeEventListener('mousedown', onDown)
    document.removeEventListener('mouseup', onUp)
  }
}