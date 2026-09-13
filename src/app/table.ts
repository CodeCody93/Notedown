/**
 * Pure GFM table model + serialization/parsing helpers.
 *
 * A framework-free, DOM-free module: every export is a pure function of plain
 * strings/arrays, so it is unit-testable in a plain node environment and safe
 * to reuse from formatting specs, export, and editor code alike. No DOM, no
 * `window`, no `EditorView`, no file I/O.
 *
 * Model conventions:
 * - `headers.length === aligns.length`; every body row is padded/truncated to
 *   `aligns.length` on serialize/parse, so the model is always rectangular.
 * - `header` records author intent (`<th>` vs `<td>` for HTML output). GFM
 *   itself REQUIRES a delimiter (alignment) row, so `serializeGfm` always
 *   emits the headers row + separator row even when `header` is false.
 * - Cell text is single-line in GFM output: `escapeCellContent` escapes
 *   backslash/pipe and folds newlines to `<br>`.
 */

export type TableAlign = 'none' | 'left' | 'center' | 'right'

export interface TableModel {
  /** True = first row is a header (`<th>`); false = all rows are data (`<td>`). */
  header: boolean
  /** One alignment per column; defines the table width. */
  aligns: TableAlign[]
  /** Header row cells (length === aligns.length). */
  headers: string[]
  /** Body rows, each padded/truncated to aligns.length. */
  body: string[][]
}

/** A parsed table's location in a document (1-based, inclusive line numbers). */
export interface TableBlockHit {
  startLine: number
  endLine: number
  model: TableModel
}

/** A delimiter cell: optional colons around 1+ dashes (Packet D/export parity). */
const ALIGN_CELL_RE = /^:?-{1,}:?$/

/** Clamp `n` into [min, max] after flooring; fall back when not finite. */
function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/** Pad/truncate a row to `width` cells (never mutates the input). */
function normRow(cells: string[], width: number): string[] {
  const out = cells.slice(0, width)
  while (out.length < width) out.push('')
  return out
}

/**
 * Blank 3x3 headered model (`Col 1..N` headers, empty body, `none` aligns).
 * `rows` clamps to 1..10, `cols` to 1..8 (floored).
 */
export function freshTableModel(rows = 3, cols = 3): TableModel {
  const r = clampInt(rows, 1, 10, 3)
  const c = clampInt(cols, 1, 8, 3)
  return {
    header: true,
    aligns: Array.from({ length: c }, () => 'none' as TableAlign),
    headers: Array.from({ length: c }, (_, i) => `Col ${i + 1}`),
    body: Array.from({ length: r }, () => Array.from({ length: c }, () => '')),
  }
}

/**
 * Make cell text safe for a single-line GFM `| ... |` row: escape backslash
 * first, then pipe; strip `\r`; fold `\n` to `<br>`.
 */
export function escapeCellContent(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
}

/** GFM delimiter marker for an alignment (none becomes `-----`). */
export function alignMarker(a: TableAlign): string {
  switch (a) {
    case 'left':
      return ':----'
    case 'center':
      return ':----:'
    case 'right':
      return '----:'
    default:
      return '-----'
  }
}

/**
 * Parse a delimiter cell into an alignment. Accepts 1+ dashes; anything that
 * is not optional-colons-around-dashes yields `none` (including plain dashes).
 */
export function parseAlignMarker(cell: string): TableAlign {
  const t = cell.trim()
  if (!ALIGN_CELL_RE.test(t)) return 'none'
  const left = t.startsWith(':')
  const right = t.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return 'none'
}

/** One `| a | b |` row from already-escaped cells. */
function gfmRow(cells: string[]): string {
  return '| ' + cells.join(' | ') + ' |'
}

/**
 * Serialize a model to a GFM table block with a leading + trailing blank line
 * (`'\n' + lines.join('\n') + '\n'`, mirroring `insertTableSpec`). Every cell
 * goes through `escapeCellContent`. The headers + separator rows are ALWAYS
 * emitted (GFM requires the separator); `header: false` only affects HTML
 * (`<td>` instead of `<th>`) -- see `serializeHtmlTable`.
 */
export function serializeGfm(model: TableModel): string {
  const width = model.aligns.length
  const header = gfmRow(normRow(model.headers, width).map(escapeCellContent))
  const sep = gfmRow(model.aligns.map(alignMarker))
  const body = model.body.map((row) => gfmRow(normRow(row, width).map(escapeCellContent)))
  return '\n' + [header, sep, ...body].join('\n') + '\n'
}

/**
 * Escape text for embedding in HTML table cells: the 5 HTML metacharacters
 * (`&<>"'`), with `\r` stripped and `\n` folded to `<br>`. Local to this
 * module (no cross-import) so it stays dependency-free.
 */
export function escapeHtmlTableText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>')
}

/**
 * Serialize a model to a SINGLE-LINE `<table>` string (no `\n`, so the result
 * survives embedding inside a GFM cell). `header: true` emits
 * `<table><thead><tr><th>..</th></tr></thead><tbody><tr><td>..</td></tr></tbody></table>`;
 * `header: false` emits no `<thead>` -- the headers become the first `<td>`
 * row of `<tbody>`. Cells render via `opts.nestedCell` when given (raw text
 * becomes caller-rendered inline HTML), otherwise via `escapeHtmlTableText`.
 */
export function serializeHtmlTable(
  model: TableModel,
  opts?: { nestedCell?: (text: string) => string },
): string {
  const width = model.aligns.length
  const render = opts?.nestedCell ?? escapeHtmlTableText
  const cell = (tag: string, text: string): string => `<${tag}>${render(text)}</${tag}>`
  const dataRows = model.body.map(
    (row) => `<tr>${normRow(row, width).map((c) => cell('td', c)).join('')}</tr>`,
  )
  if (model.header) {
    const headRow = normRow(model.headers, width)
      .map((h) => cell('th', h))
      .join('')
    return `<table><thead><tr>${headRow}</tr></thead><tbody>${dataRows.join('')}</tbody></table>`
  }
  const headerAsData = `<tr>${normRow(model.headers, width)
    .map((h) => cell('td', h))
    .join('')}</tr>`
  return `<table><tbody>${headerAsData}${dataRows.join('')}</tbody></table>`
}

/** Serialize an inner model to single-line HTML for embedding in an outer GFM cell. */
export function buildNestedCellHtml(inner: TableModel): string {
  return serializeHtmlTable(inner)
}

/**
 * Restore `\|` to `|` and `\\` to `\` in an already-split cell (single
 * left-to-right pass, so `\\|` unescapes to backslash + pipe correctly).
 * Other backslash sequences are left untouched.
 */
function unescapeCell(cell: string): string {
  let out = ''
  let i = 0
  while (i < cell.length) {
    const ch = cell[i]
    if (ch === '\\' && i + 1 < cell.length && (cell[i + 1] === '\\' || cell[i + 1] === '|')) {
      out += cell[i + 1]
      i += 2
    } else {
      out += ch
      i++
    }
  }
  return out
}

/**
 * Split one GFM row line into cells. Trims the line, strips ONE leading and
 * ONE trailing `|`, then splits on `|` EXCEPT when the pipe is:
 * - escaped (`\|` -- unescaped to `|` in the output),
 * - inside an HTML tag (`<..>`, e.g. an embedded `<table>`), or
 * - inside a backtick code span (any run length opens, the same-length run
 *   closes; backslashes are literal inside code spans).
 * Each cell is trimmed. Deliberately self-contained (Packet D duplicates this
 * logic locally rather than importing it).
 */
export function splitGfmRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  let inTag = false
  let codeFence = 0
  let i = 0
  while (i < t.length) {
    const ch = t[i]
    if (codeFence > 0) {
      if (ch === '`') {
        let j = i
        while (j < t.length && t[j] === '`') j++
        cur += t.slice(i, j)
        if (j - i === codeFence) codeFence = 0
        i = j
        continue
      }
      cur += ch
      i++
      continue
    }
    if (ch === '\\' && i + 1 < t.length) {
      cur += ch + t[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      let j = i
      while (j < t.length && t[j] === '`') j++
      codeFence = j - i
      cur += t.slice(i, j)
      i = j
      continue
    }
    if (inTag) {
      cur += ch
      if (ch === '>') inTag = false
      i++
      continue
    }
    if (ch === '<') {
      inTag = true
      cur += ch
      i++
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  cells.push(cur)
  return cells.map((c) => unescapeCell(c.trim()))
}

/**
 * Parse a GFM table block (headers + delimiter + 0+ body rows) into a model.
 * Returns null when there are fewer than 2 lines, the delimiter row's cell
 * count differs from the header's, or any delimiter cell fails
 * `/^:?-{1,}:?$/`. Blank lines are skipped; body rows are padded/truncated to
 * the header width. The result always has `header: true`.
 */
export function parseGfmTable(text: string): TableModel | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length < 2) return null
  const headers = splitGfmRow(lines[0])
  const sepCells = splitGfmRow(lines[1])
  if (headers.length === 0 || sepCells.length !== headers.length) return null
  if (!sepCells.every((c) => ALIGN_CELL_RE.test(c))) return null
  const aligns = sepCells.map(parseAlignMarker)
  const width = headers.length
  const body: string[][] = []
  for (let k = 2; k < lines.length; k++) {
    if (lines[k].trim() === '') continue
    body.push(normRow(splitGfmRow(lines[k]), width))
  }
  return { header: true, aligns, headers, body }
}

/**
 * Find the contiguous `|`-line block containing `caretLine1Based` (1-based,
 * inclusive) and parse it. Expands up/down while lines contain `|`; requires
 * the block's second line to be a valid delimiter row, then parses the slice
 * via `parseGfmTable`. Returns null when the caret line has no `|`, the block
 * is shorter than 2 lines, or the block does not parse as a table.
 */
export function detectTableBlock(
  docText: string,
  caretLine1Based: number,
): { startLine: number; endLine: number; model: TableModel } | null {
  const lines = docText.replace(/\r\n?/g, '\n').split('\n')
  const total = lines.length
  let caret = Number.isFinite(caretLine1Based) ? Math.floor(caretLine1Based) : 1
  if (caret < 1) caret = 1
  if (caret > total) caret = total
  const isTableLine = (line: string): boolean => line.includes('|')
  if (!isTableLine(lines[caret - 1])) return null
  let start = caret
  while (start > 1 && isTableLine(lines[start - 2])) start--
  let end = caret
  while (end < total && isTableLine(lines[end])) end++
  const block = lines.slice(start - 1, end)
  if (block.length < 2) return null
  const sepCells = splitGfmRow(block[1])
  if (sepCells.length === 0 || !sepCells.every((c) => ALIGN_CELL_RE.test(c))) return null
  const model = parseGfmTable(block.join('\n'))
  if (model === null) return null
  const hit: TableBlockHit = { startLine: start, endLine: end, model }
  return hit
}
