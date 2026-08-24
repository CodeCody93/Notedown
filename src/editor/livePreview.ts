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
 * - Horizontal rules: `---` on an inactive line renders as a `.cm-hr-widget` rule (E14).
 * - Heading IDs: the trailing ` {#custom-id}` is hidden on inactive heading lines (E16).
 * - Sub/sup tags and `==highlight==`: on inactive lines the literal tags/delimiters are
 *   replaced by zero-size widgets and the enclosed text is styled (E18/E19/E20).
 * - `__underline__`: StrongEmphasis with `__` marks gets a content-only `.cm-underline`
 *   decoration on inactive lines (E3).
 * - `-# subtext`: inactive lines starting with `-# ` render the remainder as
 *   `.cm-subtext` (Other Noted Issues #5).
 *
 * BLOCK-WIDGET NOTE (why tables/HRs live in a StateField, not the ViewPlugin):
 * CM6 ≥ 6.40 throws `RangeError("Block decorations may not be specified via plugins")`
 * and `RangeError("Decorations that replace line breaks may not be specified via
 * plugins")` for decorations provided through plugin functions — block widgets must
 * come from a direct provider. The package's own `tableField` uses a StateField for
 * exactly this reason, and so does `blockRenderField` below (it stays inside this
 * module, wired through `livePreviewExtensions`, so the swap-point contract holds).
 */
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
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
 * Rendered GFM table for fully-inactive tables (E13). Replaces the whole
 * `Table` node with a simple div grid (`.cm-table-widget` / `.cm-table-row` /
 * `.cm-table-cell` / `.cm-table-head`) styled via editor.css. Clicking the
 * rendered table moves the caret into it (ignoreEvent → false), which reveals
 * the raw source for editing.
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
    return container
  }

  ignoreEvent(): boolean {
    // Let clicks pass through so the caret lands inside the table and the
    // raw source re-appears (edit mode), like the package's own TableWidget.
    return false
  }
}

function tableCell(text: string): HTMLElement {
  const cell = document.createElement('span')
  cell.className = 'cm-table-cell'
  cell.textContent = text
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
  if (!separator.every((cell) => /^:?-{3,}:?$/.test(cell))) return null
  const rows: string[][] = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const cells = parseTableRow(line)
    rows.push(headers.map((_, idx) => cells[idx] ?? ''))
  }
  return { headers, rows }
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutEnd = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return withoutEnd.split('|').map((cell) => cell.trim())
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
    container.appendChild(pre)
    return container
  }

  ignoreEvent(): boolean {
    return false
  }
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
  // Lines that already received a task checkbox via the tree iteration
  // (ListMark or Paragraph paths). The line-text sweep must skip these to
  // avoid duplicate widgets.
  const taskHandledLines = new Set<number>()

  const addLinesTo = (node: { from: number; to: number }, set: Set<number>): void => {
    const start = state.doc.lineAt(node.from).number
    const end = state.doc.lineAt(node.to).number
    for (let l = start; l <= end; l++) set.add(l)
  }

  syntaxTree(state).iterate({
    enter: (node) => {
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
        return hasActiveLine ? undefined : false
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
      if (node.name === 'QuoteMark') {
        const line = state.doc.lineAt(node.from)
        if (!(activeLines.has(line.number) && !isDrag) && !quoteLines.has(line.number)) {
          quoteLines.add(line.number)
          decorations.push(Decoration.line({ class: 'cm-blockquote' }).range(line.from))
        }
      }

      // Task-marker fallback (Other #4): lezer only parses ListMark/Task for the
      // `- [ ] ` spelling; `-[]`, `- [ ]`, `-[ ]` are plain Paragraphs. Render the
      // checkbox widget on inactive, non-list paragraphs so all four spellings
      // behave alike (raw source stays visible while the line is being edited).
      if (node.name === 'Paragraph') {
        const line = state.doc.lineAt(node.from)
        if (!activeLines.has(line.number)) {
          let parent = node.node.parent
          let inListItem = false
          while (parent !== null) {
            if (parent.name === 'ListItem') {
              inListItem = true
              break
            }
            parent = parent.parent
          }
          if (!inListItem) {
            const taskMatch = /^(\s*)[-*+]\s*\[([ xX]?)\]\s*/.exec(line.text)
            if (taskMatch !== null) {
              const headLen = taskMatch[0].length
              const bracketText = (/\[[ xX]?\]/.exec(taskMatch[0])?.[0] ?? '[ ]')
              const bracketFrom = line.from + taskMatch[0].indexOf('[')
              const bracketTo = bracketFrom + bracketText.length
              const to = line.from + headLen
              const checked = /[xX]/.test(taskMatch[2])
              decorations.push(
                Decoration.replace({
                  widget: new ListMarkerWidget(checked ? '☑' : '☐', line.from, to, bracketFrom, bracketTo, view),
                }).range(line.from, to),
              )
              taskHandledLines.add(line.number)
            }
          }
        }
        return
      }

      if (!BLOCK_MARK_TYPES.has(node.name) && !INLINE_MARK_TYPES.has(node.name)) return
      if (isInsideSkippedParent(node.node.parent)) return

      if (BLOCK_MARK_TYPES.has(node.name)) {
        const lineNum = state.doc.lineAt(node.from).number
        const isActiveLine = activeLines.has(lineNum)
        if (node.name === 'ListMark' && !(isActiveLine && !isDrag)) {
          // Inactive list line: show a stable bullet/number/task marker widget
          // instead of the raw markdown chars (which the collapsed styling
          // would otherwise hide entirely — the missing-bullet bug). Task
          // detection runs on the line text from the marker so all four forms
          // `-[]`, `- []`, `-[ ]`, `- [ ]` work (Other Noted Issues #4) —
          // lezer only parses a Task node for the `- [ ] ` spelling.
          const markText = state.doc.sliceString(node.from, node.to)
          const listLine = state.doc.lineAt(node.from)
          const taskMatch = /^(\s*)[-*+]\s*\[([ xX]?)\]\s*/.exec(listLine.text.slice(node.from - listLine.from))
          if (taskMatch !== null) {
            const headLen = taskMatch[0].length
            const to = node.from + headLen
            const bracketText = (/\[[ xX]?\]/.exec(taskMatch[0])?.[0] ?? '[ ]')
            const bracketFrom = node.from + taskMatch[0].indexOf('[')
            const bracketTo = bracketFrom + bracketText.length
            const checked = /[xX]/.test(taskMatch[2])
            decorations.push(
              Decoration.replace({
                widget: new ListMarkerWidget(checked ? '☑' : '☐', node.from, to, bracketFrom, bracketTo, view),
              }).range(node.from, to),
            )
            taskHandledLines.add(listLine.number)
          } else if (/^\d+/.test(markText)) {
            // Ordered item: keep the number + period (e.g. '1.').
            const digits = /^\d+/.exec(markText)![0]
            decorations.push(Decoration.replace({ widget: new ListMarkerWidget(`${digits}.`, node.from, node.to) }).range(node.from, node.to))
          } else {
            decorations.push(Decoration.replace({ widget: new ListMarkerWidget('•', node.from, node.to) }).range(node.from, node.to))
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
        state.doc.sliceString(parent.from, parent.from + 2) === '__' &&
        !(isTouched && !isDrag)
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

  // ---- Line-text syntax (no dedicated tree nodes) ---------------------------
  // `-# subtext` and definition lists are plain text to lezer, so they are
  // handled by scanning inactive lines directly. Active lines (being edited)
  // and lines inside code blocks / table / hr / image widgets are skipped.
  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    if (activeLines.has(lineNum) || skipLines.has(lineNum) || replacedLines.has(lineNum)) continue
    const line = state.doc.line(lineNum)
    const text = line.text
    if (text.length === 0) continue

    // Task list fallback (B5/E8): all four spellings `-[]`, `- []`, `-[ ]`,
    // `- [ ]` must show ☐/☑ when the caret is elsewhere. The tree paths
    // (ListMark / Paragraph) miss cases where lezer coalesces multiple task
    // lines into a single Paragraph node or treats `-[]` as non-list text.
    // Sweep inactive lines directly so every line renders independently.
    if (!taskHandledLines.has(lineNum)) {
      const taskMatch = /^(\s*)[-*+]\s*\[([ xX]?)\]\s*/.exec(text)
      if (taskMatch !== null) {
        const headLen = taskMatch[0].length
        const bracketText = (/\[[ xX]?\]/.exec(taskMatch[0])?.[0] ?? '[ ]')
        const bracketFrom = line.from + taskMatch[0].indexOf('[')
        const bracketTo = bracketFrom + bracketText.length
        const to = line.from + headLen
        const checked = /[xX]/.test(taskMatch[2])
        decorations.push(
          Decoration.replace({
            widget: new ListMarkerWidget(checked ? '☑' : '☐', line.from, to, bracketFrom, bracketTo, view),
          }).range(line.from, to),
        )
        taskHandledLines.add(lineNum)
        // Don't `continue`; the tail of the line may still contain sub/sup/highlight etc.
      }
    }

    // `-# note` subtext (Other Noted Issues #5): hide the `-# ` prefix, style
    // the rest of the line as muted italic.
    const subtextMatch = /^\s*-#[ \t]/.exec(text)
    if (subtextMatch !== null) {
      const from = line.from
      const to = from + subtextMatch[0].length
      decorations.push(Decoration.replace({ widget: new EmptyInlineWidget(from, to) }).range(from, to))
      if (to < line.to) {
        decorations.push(Decoration.mark({ class: 'cm-subtext' }).range(to, line.to))
      }
    }

    // Definition list (E18/F2): lines starting with `: ` / `:` on inactive
    // lines are definition-list definitions (markdown-it-deflist: `Term\n: def`).
    // Style the line so it is visibly indented/muted when the caret is elsewhere.
    // The export already renders <dl>/<dt>/<dd> via markdown-it-deflist and
    // MARKDOWN_BODY_CSS; this live-preview decoration mirrors it.
    if (/^\s*:/.test(text)) {
      decorations.push(Decoration.line({ class: 'cm-deflist' }).range(line.from))
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
// Block-level live preview (tables, horizontal rules).
// ---------------------------------------------------------------------------

/**
 * Build block-replace decorations (tables on fully-inactive line ranges,
 * horizontal rules on inactive lines). Provided through a StateField because
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
    extensions.push(livePreviewPlugin.of({ imageResolver: opts?.imageResolver }), blockRenderField)
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