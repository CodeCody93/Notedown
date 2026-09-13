/**
 * Table builder modal (HTML-only): a size + cell-grid form with per-row
 * header toggles that composes a single-line `<table>` document with a live
 * dual preview (rendered table always visible + generated source collapsed
 * in a closed `<details>`).
 *
 * Mirrors the graphDialog.ts pattern: plain DOM (textContent only — the only
 * HTML injection is renderMarkdown() output, which is DOMPurify-sanitized),
 * module-level state (els/refs/isOpen/lastFocused/pending), mountRoot
 * preferring a dedicated root div, Promise-based result with settle(),
 * Escape/backdrop-cancel, Tab trap, and supersede-if-open.
 *
 * TABLE-MODULE COPY (Packet B local): this file must NOT import from
 * './table' (concurrent ownership). The model helpers below (TableModel,
 * escapeHtml, splitGfmRow, parseGfmTable, serializeHtmlTable) are local
 * copies kept shape-identical to the shared plan so the orchestrator can
 * dedupe them later.
 *
 * Manual GFM pipe tables are still rendered elsewhere in the app; this
 * dialog only *reads* them (plus HTML tables) when preloading for Edit, and
 * always *emits* HTML. There is no alignment UI, no global header toggle,
 * and no output mode toggle — each grid row carries its own header checkbox
 * instead. There are no dedicated nested-table buttons: a user selects a
 * cell and pastes/types balanced `<table>...</table>` HTML as cell content
 * like any text; balanced nested spans pass through raw (single-line) while
 * all other cell text is HTML-escaped.
 *
 * Package boundary: builder UI only. No FileIO, no invoke() — app wiring
 * calls openTableBuilder() and inserts/replaces the returned text.
 */

import { renderMarkdown, MARKDOWN_BODY_CSS } from './export'

/** Mount-point id added to index.html (`<div id="table-modal-root">`). */
export const TABLE_MODAL_ROOT_ID = 'table-modal-root'

/**
 * Result settled on [Insert]: the generated source plus the 1-based
 * inclusive line range it replaces, or null lines for insert-at-caret.
 */
export interface TableBuilderResult {
  text: string
  startLine: number | null
  endLine: number | null
}

export interface TableBuilderOptions {
  docText?: string
  caretLine?: number
  /**
   * Preload a table model directly (inner/nested-table editing from app.ts).
   * Takes precedence over docText/caretLine detection; the result carries
   * null lines (the caller applies it along its own cell path).
   */
  model?: TableModel
}

// --- local table-model copies (see header note; do not import './table') ---

/**
 * HTML-oriented model: `rows` holds ALL rows (header and body alike);
 * `headerRows[i]` marks row i as a header row (its cells render as `<th>`).
 */
export interface TableModel {
  rows: string[][]
  headerRows: boolean[]
}

export const TABLE_MAX_ROWS = 10
export const TABLE_MAX_COLS = 8

/**
 * Escape cell text for HTML output: strip carriage returns, escape
 * `&<>"'`, and render newlines as `<br>`. Plain text (outside balanced
 * nested-table spans) always goes through this function.
 */
export function escapeHtml(cell: string): string {
  return cell
    .replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>')
}

/** Case-insensitive open/close `<table>` tag matcher (shared scanner). */
const TABLE_TAG_RE = /<table(?=[\s>])[^<>]*>|<\/table\s*>/gi

/**
 * True when every `<table>` open in `value` is closed in order (depth
 * counter over TABLE_TAG_RE matches). Stray closers and unclosed opens are
 * unbalanced. Values without any table tag are trivially balanced.
 */
function isTableTagsBalanced(value: string): boolean {
  TABLE_TAG_RE.lastIndex = 0
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = TABLE_TAG_RE.exec(value)) !== null) {
    const tag = m[0]
    const isClose = (tag[1] ?? '') === '/'
    if (!isClose) {
      depth++
    } else {
      if (depth === 0) return false
      depth--
    }
  }
  return depth === 0
}

/**
 * Balanced outermost `<table>...</table>` spans in `value` (depth counter
 * over TABLE_TAG_RE). Shared by escaping, validation, and app.ts cell-path
 * walking (which needs span offsets to descend into nested tables).
 * Values without table tags yield no spans; unbalanced values also yield no
 * spans — callers distinguish via isTableTagsBalanced-equivalent checks
 * (`/<\/?table/i.test(value)` means tables were mentioned).
 */
export function findBalancedTableSpans(value: string): Array<{ start: number; end: number }> {
  if (!/<\/?table/i.test(value)) return []
  if (!isTableTagsBalanced(value)) return []
  TABLE_TAG_RE.lastIndex = 0
  const spans: Array<{ start: number; end: number }> = []
  let depth = 0
  let spanStart = -1
  let m: RegExpExecArray | null
  while ((m = TABLE_TAG_RE.exec(value)) !== null) {
    const open = (m[0][1] ?? '') !== '/'
    if (open) {
      if (depth === 0) spanStart = m.index
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0 && spanStart >= 0) {
        spans.push({ start: spanStart, end: m.index + m[0].length })
        spanStart = -1
      }
    }
  }
  return spans
}

/**
 * Escape one cell with nested-table awareness: segments inside balanced
 * outermost `<table>...</table>` spans (see findBalancedTableSpans) pass
 * through RAW (newlines stripped so the outer document stays single-line);
 * all other text goes through `escapeHtml` (`\n` → `<br>`). Unbalanced
 * values fall back to fully-escaped output — callers (refresh) flag the
 * imbalance as an error.
 */
function escapeCellWithNested(value: string): string {
  if (!/<\/?table/i.test(value)) return escapeHtml(value)
  const spans = findBalancedTableSpans(value)
  if (spans.length === 0 && /<\/?table/i.test(value)) return escapeHtml(value)
  let out = ''
  let pos = 0
  for (const span of spans) {
    out += escapeHtml(value.slice(pos, span.start))
    out += value.slice(span.start, span.end).replace(/\r?\n/g, '')
    pos = span.end
  }
  out += escapeHtml(value.slice(pos))
  return out
}

/**
 * Split a GFM row on unescaped pipes, trimming outer pipes and whitespace
 * and unescaping `\|` / `\\`. Kept ONLY to preload manually-typed pipe
 * tables for editing — the dialog never emits GFM.
 */
export function splitGfmRow(line: string): string[] {
  const trimmed = line.trim()
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '\\' && i + 1 < trimmed.length && (trimmed[i + 1] === '|' || trimmed[i + 1] === '\\')) {
      cur += trimmed[i + 1]
      i++
    } else if (ch === '|') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  if (cells.length > 0 && cells[0] === '' && trimmed.startsWith('|')) cells.shift()
  if (cells.length > 0 && cells[cells.length - 1] === '' && trimmed.endsWith('|')) cells.pop()
  return cells.map((c) => c.trim())
}

function isDelimiterCell(cell: string): boolean {
  return /^:?-+:?$/.test(cell.trim())
}

function isDelimiterRow(line: string): boolean {
  const cells = splitGfmRow(line)
  return cells.length > 0 && cells.every(isDelimiterCell)
}

/** Map a literal `<br>` back to a newline so preloaded breaks round-trip. */
function brToNewline(cell: string): string {
  return cell.replace(/<br\s*\/?>/gi, '\n')
}

function widthOf(model: TableModel): number {
  let n = 0
  for (const row of model.rows) n = Math.max(n, row.length)
  return Math.max(1, n)
}

function padded<T>(arr: T[], n: number, fill: T): T[] {
  const out = arr.slice(0, n)
  while (out.length < n) out.push(fill)
  return out
}

/**
 * Parse standalone GFM table text (header row + delimiter row + body rows)
 * into the HTML-oriented model: the header row becomes row 0 with
 * `headerRows[0] === true`, body rows follow as non-header rows. Alignment
 * markers are accepted but discarded (the dialog has no alignment UI).
 * Returns null when the text is not a GFM table. Headerless pipe blocks
 * are NOT tables — they return null.
 */
export function parseGfmTable(tableText: string): TableModel | null {
  const lines = tableText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length < 2) return null
  const first = lines[0]
  const second = lines[1]
  if (first === undefined || second === undefined) return null
  if (!first.includes('|') || !isDelimiterRow(second)) return null
  const headers = splitGfmRow(first)
  if (headers.length === 0) return null
  const n = headers.length
  const rows: string[][] = [padded(headers.map(brToNewline), n, '')]
  const headerRows: boolean[] = [true]
  for (const line of lines.slice(2)) {
    rows.push(padded(splitGfmRow(line).map(brToNewline), n, ''))
    headerRows.push(false)
  }
  return { rows, headerRows }
}

/**
 * Serialize a model to a single-line full-`<table>` HTML document (never
 * contains `\n`). Leading consecutive header-marked rows go in `<thead>`
 * as `<th>`; every other row goes in `<tbody>` — marked rows keep `<th>`
 * cells even inside `<tbody>`, unmarked rows use `<td>`. Row order and
 * column (th/td) order are preserved in document order. Each cell goes
 * through nested-aware escaping: text outside balanced outer
 * `<table>...</table>` spans is escaped via escapeHtml, balanced nested
 * spans pass through raw with newlines stripped.
 */
export function serializeHtmlTable(model: TableModel): string {
  const n = widthOf(model)
  const rows = model.rows.map((row) => padded(row, n, ''))
  let lead = 0
  while (lead < rows.length && (model.headerRows[lead] ?? false)) lead++
  let out = '<table>'
  if (lead > 0) {
    out += '<thead>'
    for (let i = 0; i < lead; i++) {
      const cells = rows[i] ?? []
      out += `<tr>${cells.map((cell) => `<th>${escapeCellWithNested(cell ?? '')}</th>`).join('')}</tr>`
    }
    out += '</thead>'
  }
  out += '<tbody>'
  for (let i = lead; i < rows.length; i++) {
    const cells = rows[i] ?? []
    const tag = (model.headerRows[i] ?? false) ? 'th' : 'td'
    out += `<tr>${cells.map((cell) => `<${tag}>${escapeCellWithNested(cell ?? '')}</${tag}>`).join('')}</tr>`
  }
  out += '</tbody></table>'
  return out
}

/**
 * Find the GFM table block surrounding a 1-based caret line. Returns the
 * preloaded model plus the 1-based inclusive line range, or null when the
 * caret is not inside a table. Local only (not exported — Packet A owns
 * table.ts and may define its own detector).
 */
function detectTableBlock(
  docText: string,
  caretLine: number
): { model: TableModel; startLine: number; endLine: number } | null {
  const lines = docText.split('\n')
  const idx = caretLine - 1
  if (idx < 0 || idx >= lines.length) return null
  const isPipeLine = (line: string): boolean => line.includes('|')
  if (!isPipeLine(lines[idx] ?? '')) return null
  let lo = idx
  while (lo - 1 >= 0 && isPipeLine(lines[lo - 1] ?? '')) lo--
  let hi = idx
  while (hi + 1 < lines.length && isPipeLine(lines[hi + 1] ?? '')) hi++
  for (let i = lo + 1; i <= hi; i++) {
    if (!isDelimiterRow(lines[i] ?? '')) continue
    const headerCells = splitGfmRow(lines[i - 1] ?? '')
    if (headerCells.length === 0) continue
    let end = i
    while (end + 1 <= hi && isPipeLine(lines[end + 1] ?? '') && !isDelimiterRow(lines[end + 1] ?? '')) end++
    const n = headerCells.length
    const rows: string[][] = [padded(headerCells.map(brToNewline), n, '')]
    const headerRows: boolean[] = [true]
    for (let r = i + 1; r <= end; r++) {
      rows.push(padded(splitGfmRow(lines[r] ?? '').map(brToNewline), n, ''))
      headerRows.push(false)
    }
    return { model: { rows, headerRows }, startLine: i, endLine: end + 1 }
  }
  return null
}

/**
 * Cell source for one outer-table cell: walk its childNodes in order —
 * TEXT → nodeValue, BR → `'\n'`, TABLE → outerHTML with `/\r?\n/g` stripped
 * (balanced nested tables preserved single-line), other ELEMENT →
 * textContent. Plain DOM textContent only; no HTML injection.
 */
function cellSourceFromCell(cell: HTMLTableCellElement): string {
  let out = ''
  for (const node of Array.from(cell.childNodes)) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? ''
    } else if (node.nodeType === 1) {
      const el = node as Element
      if (el.tagName === 'BR') {
        out += '\n'
      } else if (el.tagName === 'TABLE') {
        out += (el as unknown as HTMLElement).outerHTML.replace(/\r?\n/g, '')
      } else {
        out += el.textContent ?? ''
      }
    }
  }
  return out
}

/**
 * Parse one `<table>...</table>` source string into the model, or null when
 * there are no rows. Pure, DOM-order contract: rows are the `<tr>`s of the
 * OUTERMOST table in document order (a tr belongs to this table iff
 * `tr.closest('table')` is the root match); cells come from `tr.cells`
 * (th/td in order); `headerRows[i]` is true when the row sits in `<thead>`
 * or contains any `<th>`; each cell's source comes from
 * `cellSourceFromCell`.
 */
export function parseHtmlTable(html: string): TableModel | null {
  let table: HTMLTableElement | null = null
  try {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      table = doc.querySelector('table')
    }
  } catch {
    table = null
  }
  if (table === null) {
    try {
      const tpl = document.createElement('template')
      // Parsing only (template content never renders or runs scripts).
      tpl.innerHTML = html
      table = tpl.content.querySelector('table')
    } catch {
      return null
    }
  }
  if (table === null) return null
  // Only rows whose nearest table is this one (skip nested-table rows).
  const trs = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
  if (trs.length === 0) return null
  const parsed = trs.map((tr) => {
    const cells = Array.from(tr.cells).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
    const isHeader = tr.closest('thead') !== null || cells.some((cell) => cell.tagName === 'TH')
    return { texts: cells.map(cellSourceFromCell), isHeader }
  })
  let width = 0
  for (const row of parsed) width = Math.max(width, row.texts.length)
  width = Math.max(1, width)
  return {
    rows: parsed.map((row) => padded(row.texts, width, '')),
    headerRows: parsed.map((row) => row.isHeader),
  }
}

/**
 * Find the HTML `<table>...</table>` block surrounding a 1-based caret
 * line. Case-insensitive, may span lines, ignored inside fenced code.
 * Returns the preloaded model plus the 1-based inclusive line range, or
 * null when the caret is not inside an HTML table.
 */
function detectHtmlTableBlock(
  docText: string,
  caretLine: number
): { model: TableModel; startLine: number; endLine: number } | null {
  const lines = docText.split('\n')
  if (caretLine < 1 || caretLine > lines.length) return null
  // Fenced-code line mask (``` or ~~~ fences; marker lines count as fenced).
  const fenced = new Array<boolean>(lines.length).fill(false)
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trimStart()
    if (t.startsWith('```') || t.startsWith('~~~')) {
      inFence = !inFence
      fenced[i] = true
      continue
    }
    fenced[i] = inFence
  }
  if (fenced[caretLine - 1] === true) return null
  // Line-start offsets for offset → 1-based line mapping.
  const starts: number[] = []
  let off = 0
  for (const ln of lines) {
    starts.push(off)
    off += ln.length + 1
  }
  const offsetToLine = (pos: number): number => {
    let lo = 0
    let hi = lines.length - 1
    let ans = lines.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if ((starts[mid] ?? 0) <= pos) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans + 1
  }
  // Collect table open/close tags, then pair with a depth counter so
  // (hand-written) nested tables yield their outer match.
  const tagRe = /<\/?table(?=[\s>])[^<>]*>/gi
  const tags: Array<{ open: boolean; index: number; end: number }> = []
  let m: RegExpExecArray | null
  tagRe.lastIndex = 0
  while ((m = tagRe.exec(docText)) !== null) {
    tags.push({ open: (m[0][1] ?? '') !== '/', index: m.index, end: m.index + m[0].length })
  }
  const outers: Array<{ start: number; end: number }> = []
  let depth = 0
  let outerStart = -1
  for (const tag of tags) {
    if (tag.open) {
      if (depth === 0) outerStart = tag.index
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0 && outerStart >= 0) {
        outers.push({ start: outerStart, end: tag.end })
        outerStart = -1
      }
    }
  }
  for (const outer of outers) {
    const startLine = offsetToLine(outer.start)
    const endLine = offsetToLine(Math.max(outer.start, outer.end - 1))
    if (caretLine < startLine || caretLine > endLine) continue
    let fencedHit = false
    for (let i = startLine; i <= endLine; i++) {
      if (fenced[i - 1] === true) {
        fencedHit = true
        break
      }
    }
    if (fencedHit) continue
    const model = parseHtmlTable(docText.slice(outer.start, outer.end))
    if (model === null) continue
    return { model, startLine, endLine }
  }
  return null
}

// --- dialog state (mirrors graphDialog.ts) ---

interface TableBuilderState {
  model: TableModel
}

interface TableDialogEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  title: HTMLElement
  form: HTMLElement
  errors: HTMLElement
  preview: HTMLElement
  sourceCode: HTMLElement
  insertBtn: HTMLButtonElement
  cancelBtn: HTMLButtonElement
}

/** Live control refs for the rendered form (rebuilt by renderForm). */
interface TableRefs {
  rowsInput: HTMLInputElement | null
  colsInput: HTMLInputElement | null
  rowHeadChecks: HTMLInputElement[]
  cellInputs: HTMLInputElement[][]
}

function freshModel(): TableModel {
  return {
    rows: [
      ['Col 1', 'Col 2', 'Col 3'],
      ['', '', ''],
      ['', '', ''],
    ],
    headerRows: [true, false, false],
  }
}

/**
 * Normalize a caller-supplied model (inner-table editing): deep-clone and
 * pad rectangular (rows to the max width, headerRows to the row count).
 * Never truncates — inner tables round-trip losslessly.
 */
function normalizeModel(model: TableModel): TableModel {
  const rows = model.rows.map((r) => r.slice())
  let width = 1
  for (const r of rows) width = Math.max(width, r.length)
  for (const r of rows) {
    while (r.length < width) r.push('')
  }
  const headerRows = rows.map((_, i) => model.headerRows[i] ?? false)
  return { rows, headerRows }
}

function emptyRefs(): TableRefs {
  return { rowsInput: null, colsInput: null, rowHeadChecks: [], cellInputs: [] }
}

let state: TableBuilderState = { model: freshModel() }
let range: { startLine: number; endLine: number } | null = null
let isEdit = false
let convertedNote = false
let currentText = ''
let els: TableDialogEls | null = null
let refs: TableRefs = emptyRefs()
let isOpen = false
let lastFocused: HTMLElement | null = null
let pending: ((result: TableBuilderResult | null) => void) | null = null

/** Never throws: prefers #table-modal-root, falls back to document.body. */
function mountRoot(): HTMLElement {
  return document.getElementById(TABLE_MODAL_ROOT_ID) ?? document.body
}

// --- DOM builders ---

function makeLabel(text: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'table-label'
  span.textContent = text
  return span
}

function makeTextInput(value: string, dataK: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'table-input'
  input.value = value
  input.setAttribute('data-k', dataK)
  return input
}

function buildDialog(): TableDialogEls {
  const root = mountRoot()
  const backdrop = document.createElement('div')
  backdrop.className = 'table-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'table-dialog'
  dialog.id = 'table-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'table-modal-title')

  const title = document.createElement('h2')
  title.id = 'table-modal-title'
  title.className = 'table-title'
  title.textContent = 'Insert table'

  const form = document.createElement('div')
  form.className = 'table-form'

  const errors = document.createElement('div')
  errors.className = 'table-errors'
  errors.setAttribute('aria-live', 'polite')
  errors.hidden = true

  const previewLabel = document.createElement('p')
  previewLabel.className = 'table-section-label'
  previewLabel.textContent = 'Preview'

  // Own <style> carrying MARKDOWN_BODY_CSS — same pattern as the main
  // preview pane, so the table preview matches preview/export exactly.
  const previewStyle = document.createElement('style')
  previewStyle.textContent = MARKDOWN_BODY_CSS

  const preview = document.createElement('div')
  preview.className = 'table-preview md-body'

  // Generated source is collapsed by default; the rendered preview above
  // stays always visible.
  const details = document.createElement('details')
  details.className = 'table-source'
  const summary = document.createElement('summary')
  summary.textContent = 'Generated source'
  const sourcePre = document.createElement('pre')
  sourcePre.className = 'table-tag'
  const sourceCode = document.createElement('code')
  sourcePre.appendChild(sourceCode)
  details.append(summary, sourcePre)

  const actions = document.createElement('div')
  actions.className = 'table-actions'
  const insertBtn = document.createElement('button')
  insertBtn.type = 'button'
  insertBtn.className = 'table-confirm'
  insertBtn.textContent = 'Insert'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'table-cancel'
  cancelBtn.textContent = 'Cancel'
  actions.append(insertBtn, cancelBtn)

  dialog.append(title, form, errors, previewLabel, previewStyle, preview, details, actions)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return { root, backdrop, dialog, title, form, errors, preview, sourceCode, insertBtn, cancelBtn }
}

/** Size row: total row count + column count (output is always HTML). */
function renderSizeRow(form: HTMLElement): void {
  const size = document.createElement('div')
  size.className = 'table-size'

  const rowsWrap = document.createElement('label')
  rowsWrap.className = 'table-field'
  const rowsInput = document.createElement('input')
  rowsInput.type = 'number'
  rowsInput.className = 'table-input table-num'
  rowsInput.min = '1'
  rowsInput.max = String(TABLE_MAX_ROWS)
  rowsInput.value = String(state.model.rows.length)
  rowsInput.setAttribute('data-k', 'rows')
  rowsInput.setAttribute('aria-label', 'Rows')
  rowsWrap.append(makeLabel('Rows'), rowsInput)
  refs.rowsInput = rowsInput

  const colsWrap = document.createElement('label')
  colsWrap.className = 'table-field'
  const colsInput = document.createElement('input')
  colsInput.type = 'number'
  colsInput.className = 'table-input table-num'
  colsInput.min = '1'
  colsInput.max = String(TABLE_MAX_COLS)
  colsInput.value = String(widthOf(state.model))
  colsInput.setAttribute('data-k', 'cols')
  colsInput.setAttribute('aria-label', 'Columns')
  colsWrap.append(makeLabel('Columns'), colsInput)
  refs.colsInput = colsInput

  size.append(rowsWrap, colsWrap)
  form.appendChild(size)
}

function makeCell(r: number, c: number, value: string, label: string): HTMLElement {
  const cell = document.createElement('div')
  cell.className = 'table-cell'
  const input = makeTextInput(value, 'cell')
  input.setAttribute('data-r', String(r))
  input.setAttribute('data-c', String(c))
  input.setAttribute('aria-label', label)
  cell.appendChild(input)
  let rowRefs = refs.cellInputs[r]
  if (rowRefs === undefined) {
    rowRefs = []
    refs.cellInputs[r] = rowRefs
  }
  rowRefs[c] = input
  return cell
}

/**
 * Cell grid: one row of inputs per model row, each led by its own header
 * checkbox (`.table-row-head`) that independently marks the row as header.
 */
function renderGrid(form: HTMLElement): void {
  const n = widthOf(state.model)
  const group = document.createElement('div')
  group.className = 'table-group'
  const head = document.createElement('span')
  head.className = 'table-group-label'
  head.textContent = 'Cells'
  const grid = document.createElement('div')
  grid.className = 'table-grid'
  state.model.rows.forEach((modelRow, r) => {
    const row = document.createElement('div')
    row.className = 'table-row'
    const isHead = state.model.headerRows[r] ?? false
    if (isHead) row.classList.add('table-header-row')
    const headCheck = document.createElement('input')
    headCheck.type = 'checkbox'
    headCheck.className = 'table-row-head'
    headCheck.checked = isHead
    headCheck.setAttribute('data-k', 'rowhead')
    headCheck.setAttribute('data-r', String(r))
    headCheck.setAttribute('aria-label', `Row ${String(r + 1)} header`)
    headCheck.title = `Row ${String(r + 1)} header`
    row.appendChild(headCheck)
    refs.rowHeadChecks.push(headCheck)
    for (let c = 0; c < n; c++) {
      row.appendChild(makeCell(r, c, modelRow[c] ?? '', `Row ${String(r + 1)} column ${String(c + 1)}`))
    }
    grid.appendChild(row)
  })
  group.append(head, grid)
  form.appendChild(group)
}

/** Add/Remove row/column structural buttons. */
function renderStructureButtons(form: HTMLElement): void {
  const rows = state.model.rows.length
  const cols = widthOf(state.model)
  const wrap = document.createElement('div')
  wrap.className = 'table-grid-actions'
  const defs: Array<{ action: string; label: string; disabled: boolean }> = [
    { action: 'add-row', label: 'Add row', disabled: rows >= TABLE_MAX_ROWS },
    { action: 'remove-row', label: 'Remove row', disabled: rows <= 1 },
    { action: 'add-column', label: 'Add column', disabled: cols >= TABLE_MAX_COLS },
    { action: 'remove-column', label: 'Remove column', disabled: cols <= 1 },
  ]
  for (const def of defs) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'table-add'
    btn.setAttribute('data-action', def.action)
    btn.textContent = def.label
    btn.disabled = def.disabled
    wrap.appendChild(btn)
  }
  form.appendChild(wrap)
}

/** Rebuild the form from state (open + structural changes). */
function renderForm(): void {
  if (els === null) return
  refs = emptyRefs()
  while (els.form.firstChild !== null) els.form.removeChild(els.form.firstChild)
  renderSizeRow(els.form)
  renderGrid(els.form)
  renderStructureButtons(els.form)
  refresh()
}

// --- model resizing (content-preserving, clamped to min/max) ---

function resizeModel(rows: number, cols: number): void {
  const model = state.model
  const prevWidth = widthOf(model)
  const nextRows: string[][] = []
  const nextHeads: boolean[] = []
  for (let r = 0; r < rows; r++) {
    const prev = model.rows[r] ?? []
    nextRows.push(padded(prev, cols, ''))
    // New rows are never headers; existing marks survive truncation.
    nextHeads.push(model.headerRows[r] ?? false)
  }
  // Fresh columns (beyond the previous width) get default Col N labels in
  // the first header-marked row (row 0 fallback) when the cell is empty.
  if (cols > prevWidth) {
    let labelRow = nextHeads.findIndex((marked) => marked)
    if (labelRow < 0 || labelRow >= nextRows.length) labelRow = 0
    const target = nextRows[labelRow]
    if (target !== undefined) {
      for (let c = prevWidth; c < cols; c++) {
        if ((target[c] ?? '') === '') target[c] = `Col ${String(c + 1)}`
      }
    }
  }
  model.rows = nextRows
  model.headerRows = nextHeads
}

function focusControl(dataK: string): void {
  if (els === null) return
  els.form.querySelector<HTMLInputElement>(`input[data-k="${dataK}"]`)?.focus()
}

function focusCellInput(r: number, c: number): void {
  if (els === null) return
  els.form
    .querySelector<HTMLInputElement>(`input[data-k="cell"][data-r="${String(r)}"][data-c="${String(c)}"]`)
    ?.focus()
}

// --- validation + live dual preview (no structural rebuild: keeps focus) ---

function countMatches(value: string, re: RegExp): number {
  return value.match(re)?.length ?? 0
}

function refresh(): void {
  if (els === null) return
  const errors: string[] = []
  const bad = new Set<HTMLElement>()
  const fail = (message: string, ...inputs: HTMLElement[]): void => {
    errors.push(message)
    for (const input of inputs) bad.add(input)
  }

  const text = serializeHtmlTable(state.model)
  currentText = text
  els.sourceCode.textContent = text
  // renderMarkdown() is DOMPurify-sanitized — the only HTML injection point.
  const rendered = renderMarkdown(text)
  els.preview.innerHTML = rendered

  // The generated HTML must survive sanitization, carry balanced <table>
  // tags, and contain at least one row. Rectangularity is guaranteed by
  // padded serialization plus content-preserving resizeModel.
  if (rendered.trim() === '') {
    fail('Generated table sanitized to empty content.')
  }
  const opens = countMatches(text, /<table[\s>]/gi)
  const closes = countMatches(text, /<\/table\s*>/gi)
  if (opens === 0 || opens !== closes) fail('Generated HTML failed validation.')
  if (state.model.rows.length === 0) fail('The table needs at least one row.')

  // Per-cell balanced `<table>` check: any header/body input containing
  // `<table` (case-insensitive) must hold balanced tags. Balanced nested
  // content is NOT an error; unbalanced values fail and mark the input.
  // Unbalanced cells serialize fully escaped, so the failure surfaces here
  // rather than as silently-escaped text.
  state.model.rows.forEach((row, r) => {
    const isHeadRow = state.model.headerRows[r] ?? false
    row.forEach((value, c) => {
      const cell = value ?? ''
      if (!/<\/?table/i.test(cell)) return
      if (isTableTagsBalanced(cell)) return
      const label = isHeadRow ? `header column ${String(c + 1)}` : `row ${String(r + 1)} column ${String(c + 1)}`
      const input =
        refs.cellInputs[r]?.[c] ??
        els?.form.querySelector<HTMLInputElement>(
          `input[data-k="cell"][data-r="${String(r)}"][data-c="${String(c)}"]`
        ) ??
        null
      if (input !== null) fail(`Unbalanced <table> tags in ${label}.`, input)
      else fail(`Unbalanced <table> tags in ${label}.`)
    })
  })

  for (const cell of els.form.querySelectorAll('.table-cell-error')) {
    cell.classList.remove('table-cell-error')
  }
  for (const input of bad) input.classList.add('table-cell-error')

  while (els.errors.firstChild !== null) els.errors.removeChild(els.errors.firstChild)
  for (const message of errors) {
    const line = document.createElement('div')
    line.className = 'table-error'
    line.textContent = message
    els.errors.appendChild(line)
  }
  if (convertedNote) {
    const note = document.createElement('div')
    note.className = 'table-note'
    note.textContent = 'Newlines in cells were converted to <br>.'
    els.errors.appendChild(note)
  }
  els.errors.hidden = errors.length === 0 && !convertedNote

  els.insertBtn.disabled = errors.length > 0 || text.trim() === ''
}

// --- handlers ---

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    settle(null)
  }
}

/** Tab / Shift+Tab wrap around the dialog's inputs and buttons. */
function onDialogKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || els === null) return
  const focusables = Array.from(els.dialog.querySelectorAll<HTMLElement>('button, input, summary')).filter(
    (node) => !(node instanceof HTMLButtonElement && node.disabled)
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (first === undefined || last === undefined) return
  const active = document.activeElement
  if (ev.shiftKey) {
    if (active === first || !els.dialog.contains(active)) {
      ev.preventDefault()
      last.focus()
    }
  } else if (active === last || !els.dialog.contains(active)) {
    ev.preventDefault()
    first.focus()
  }
}

/** Clicks land on the backdrop itself, not on the dialog inside it. */
function onBackdropClick(ev: MouseEvent): void {
  if (els !== null && ev.target === els.backdrop) settle(null)
}

/**
 * Normalize raw cell text: carriage returns are stripped and noted —
 * serializeHtmlTable() renders the surviving newlines as `<br>`.
 */
function normalizeCell(raw: string): string {
  if (!/[\r\n]/.test(raw)) return raw
  convertedNote = true
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function setCell(r: number, c: number, value: string): void {
  const row = state.model.rows[r]
  if (row !== undefined && c >= 0 && c < row.length) row[c] = value
}

/** Sync one edited control into state, then re-validate + re-preview. */
function syncControl(target: HTMLElement): void {
  if (target instanceof HTMLInputElement) {
    const kind = target.getAttribute('data-k')
    if (kind === 'cell') {
      const r = Number(target.getAttribute('data-r') ?? '-1')
      const c = Number(target.getAttribute('data-c') ?? '-1')
      if (Number.isInteger(r) && r >= 0 && Number.isInteger(c) && c >= 0) {
        const normalized = normalizeCell(target.value)
        if (normalized !== target.value && !normalized.includes('\n')) target.value = normalized
        setCell(r, c, normalized)
        refresh()
      }
      return
    }
    if (kind === 'rowhead') {
      const r = Number(target.getAttribute('data-r') ?? '-1')
      if (Number.isInteger(r) && r >= 0 && r < state.model.rows.length) {
        // No form rebuild: the toggle stays live, only state + preview sync.
        state.model.headerRows[r] = target.checked
        const rowEl = target.closest('.table-row')
        if (rowEl !== null) rowEl.classList.toggle('table-header-row', target.checked)
        refresh()
        target.focus()
      }
      return
    }
    if (kind === 'rows' || kind === 'cols') {
      const n = Number.parseInt(target.value, 10)
      if (!Number.isInteger(n)) return
      const max = kind === 'rows' ? TABLE_MAX_ROWS : TABLE_MAX_COLS
      const clamped = Math.min(max, Math.max(1, n))
      const rows = kind === 'rows' ? clamped : state.model.rows.length
      const cols = kind === 'cols' ? clamped : widthOf(state.model)
      if (rows === state.model.rows.length && cols === widthOf(state.model)) return
      resizeModel(rows, cols)
      renderForm()
      focusControl(kind)
    }
    return
  }
}

function onFormInput(ev: Event): void {
  const target = ev.target
  if (!(target instanceof HTMLElement)) return
  syncControl(target)
}

function onFormChange(ev: Event): void {
  const target = ev.target
  if (!(target instanceof HTMLElement)) return
  syncControl(target)
}

/** Structural add/remove row/column buttons (delegated). */
function onFormClick(ev: MouseEvent): void {
  const target = ev.target
  if (!(target instanceof HTMLElement)) return
  const btn = target.closest('button[data-action]')
  if (btn === null || els === null || !els.form.contains(btn)) return
  const action = btn.getAttribute('data-action')
  const rows = state.model.rows.length
  const cols = widthOf(state.model)
  switch (action) {
    case 'add-row': {
      if (rows >= TABLE_MAX_ROWS) return
      resizeModel(rows + 1, cols)
      renderForm()
      focusCellInput(rows, 0)
      break
    }
    case 'remove-row': {
      if (rows <= 1) return
      resizeModel(rows - 1, cols)
      renderForm()
      break
    }
    case 'add-column': {
      if (cols >= TABLE_MAX_COLS) return
      resizeModel(rows, cols + 1)
      renderForm()
      focusCellInput(0, cols)
      break
    }
    case 'remove-column': {
      if (cols <= 1) return
      resizeModel(rows, cols - 1)
      renderForm()
      break
    }
    default:
      break
  }
}

function onInsertClick(): void {
  if (els === null || els.insertBtn.disabled) return
  settle({
    text: currentText,
    startLine: range?.startLine ?? null,
    endLine: range?.endLine ?? null,
  })
}

function onCancelClick(): void {
  settle(null)
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.backdrop.addEventListener('click', onBackdropClick)
  els.form.addEventListener('input', onFormInput)
  els.form.addEventListener('change', onFormChange)
  els.form.addEventListener('click', onFormClick)
  els.insertBtn.addEventListener('click', onInsertClick)
  els.cancelBtn.addEventListener('click', onCancelClick)
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.backdrop.removeEventListener('click', onBackdropClick)
  els.form.removeEventListener('input', onFormInput)
  els.form.removeEventListener('change', onFormChange)
  els.form.removeEventListener('click', onFormClick)
  els.insertBtn.removeEventListener('click', onInsertClick)
  els.cancelBtn.removeEventListener('click', onCancelClick)
}

// --- exported API ---

export function isTableBuilderOpen(): boolean {
  return isOpen
}

/**
 * Show the table builder. Resolves `{ text, startLine, endLine }` on
 * [Insert], null on [Cancel], backdrop click, or Esc. Null lines mean
 * insert-at-caret; non-null lines are the 1-based inclusive range to
 * replace (set when opts preloads an existing table). A call while already
 * open supersedes the previous waiter (resolves it null) and resets the
 * form — preloading opts.docText around opts.caretLine when both given,
 * otherwise starting from a fresh 3x3 table.
 *
 * Preload prefers an HTML `<table>...</table>` block containing the caret;
 * otherwise a GFM pipe-table block is detected and converted (its header
 * row becomes the single marked header row).
 */
export function openTableBuilder(opts?: TableBuilderOptions): Promise<TableBuilderResult | null> {
  if (els === null || !els.root.isConnected) {
    if (els !== null) {
      detachListeners()
      els.backdrop.remove()
    }
    els = buildDialog()
  }
  if (isOpen) settle(null) // supersede any pending builder

  state = { model: freshModel() }
  range = null
  isEdit = false
  convertedNote = false
  currentText = ''
  if (opts?.model !== undefined) {
    // Direct model preload (inner/nested-table editing): skip doc detection;
    // the caller applies the result along its own cell path (null lines).
    state.model = normalizeModel(opts.model)
    isEdit = true
  } else if (opts?.docText !== undefined && opts?.caretLine !== undefined) {
    const found = detectHtmlTableBlock(opts.docText, opts.caretLine) ?? detectTableBlock(opts.docText, opts.caretLine)
    if (found !== null) {
      state.model = found.model
      range = { startLine: found.startLine, endLine: found.endLine }
      isEdit = true
    }
  }

  els.title.textContent = isEdit ? 'Edit table' : 'Insert table'
  renderForm()

  isOpen = true
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  els.root.hidden = false
  attachListeners()
  const firstInput = els.form.querySelector<HTMLInputElement>('input')
  if (firstInput !== null) firstInput.focus()

  return new Promise<TableBuilderResult | null>((resolve) => {
    pending = resolve
  })
}

function settle(result: TableBuilderResult | null): void {
  if (!isOpen || els === null) return
  isOpen = false
  detachListeners()
  els.root.hidden = true
  const resolve = pending
  pending = null
  if (lastFocused !== null) {
    const restore = lastFocused
    lastFocused = null
    restore.focus()
  }
  resolve?.(result)
}
