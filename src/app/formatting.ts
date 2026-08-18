/**
 * Pure CM6 document-transform commands (M3).
 *
 * Every exported transform is a PURE function of `EditorState` → `TransactionSpec` —
 * no DOM, no `window`, no `EditorView`. That makes each one unit-testable in a plain
 * node environment and guarantees the editor path (a single `view.dispatch(spec)` per
 * action = a SINGLE undo step) shares exactly the same code the unit tests exercise.
 *
 * Other M3 packets (menus/hotkeys) look these up by LOCKED action id via
 * `FORMATTING_COMMANDS`.
 *
 * Conventions used throughout:
 * - Selection model: `state.selection.main` (range.from/to/head).
 * - Multi-line operations apply to EVERY line spanned by the selection, inclusive.
 * - Empty selections operate on the caret's own line.
 * - Caret/selection offsets in the returned spec always refer to the POST-change
 *   document (CM6 spec semantics), so multi-change commands build a `ChangeSet` and
 *   map the selection through it (`SelectionRange.map`-equivalent: from→assoc 1,
 *   to→assoc -1, empty head→assoc -1).
 */

import type { EditorState, Line, Transaction, TransactionSpec } from '@codemirror/state'
import type { Command, KeyBinding } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

/** Builds a transaction spec from the current state. Commands produce a SINGLE undo step. */
export type FormattingCommand = (state: EditorState) => TransactionSpec

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/**
 * Local stand-in for `stateCommand` from `@codemirror/commands`, which is NOT present
 * in the installed version (6.10.4 — verified against its dist/*.js and index.d.ts).
 * Identical semantics: wraps a state-only handler into a full CM6 `Command`.
 */
function stateCommand(
  f: (target: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean,
): Command {
  return (view) => f({ state: view.state, dispatch: view.dispatch })
}

/** Every `Line` object spanned by a selection (inclusive of both endpoints). */
function affectedLines(state: EditorState, from: number, to: number): Line[] {
  const start = state.doc.lineAt(from)
  const end = state.doc.lineAt(to)
  const lines: Line[] = []
  for (let n = start.number; n <= end.number; n++) lines.push(state.doc.line(n))
  return lines
}

/** Mapping-only spec (used by commands whose outcome is "no change"). */
function noChangeSpec(state: EditorState): TransactionSpec {
  return { selection: { anchor: state.selection.main.head } }
}

/**
 * Merge an array of non-overlapping change specs (all in ORIGINAL doc coordinates)
 * into a single transaction spec, mapping the main range through them so the result
 * selection stays on the same logical content.
 */
function finalizeChanges(
  state: EditorState,
  changes: { from: number; to: number; insert: string }[],
  from: number,
  to: number,
): TransactionSpec {
  if (changes.length === 0) return noChangeSpec(state)
  const changeSet = state.changes(changes)
  let anchor: number
  let head: number
  if (from === to) {
    anchor = changeSet.mapPos(from, -1)
    head = anchor
  } else {
    anchor = changeSet.mapPos(from, 1)
    head = changeSet.mapPos(to, -1)
  }
  return { changes: changeSet, selection: { anchor, head } }
}

// ---------------------------------------------------------------------------
// Wrap / unwrap pairs (bold, italic, underline, strikethrough, sub, sup, highlight)
// ---------------------------------------------------------------------------

/**
 * Syntax-tree-based unwrap for native markdown nodes (bold/italic/strikethrough).
 * Finds the innermost ancestor of the caret/selection whose node name is in
 * `nodeNames` and whose marker delimiters strictly CONTAIN the selection; when
 * found, removes the markers and maps the selection left by `open.length`.
 * Returns null when no such node exists (e.g. no markdown language configured,
 * or the selection covers a marker itself).
 */
function treeUnwrap(state: EditorState, open: string, close: string, nodeNames: string[]): TransactionSpec | null {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  const tree = syntaxTree(state)
  let node: SyntaxNode | null = tree.resolveInner(from, 1)
  while (node !== null) {
    if (nodeNames.includes(node.name) && node.from + open.length <= from && to <= node.to - close.length) break
    node = node.parent
  }
  if (node === null) return null
  const text = state.doc.sliceString(node.from, node.to)
  if (!text.startsWith(open) || !text.endsWith(close)) return null
  // Selection mapped through the marker removal: everything shifts left by open.length.
  return {
    changes: { from: node.from, to: node.to, insert: text.slice(open.length, text.length - close.length) },
    selection: { anchor: from - open.length, head: to - open.length },
  }
}

/**
 * Generic wrap/unwrap. Non-empty selection: wrap `open+text+close` and select the
 * wrapped text; if the text is already fully wrapped, unwrap and keep the inner text
 * selected. Empty selection: insert `open+close` and place the caret between them.
 *
 * When `nodeNames` is given, a syntax-tree unwrap runs FIRST: a caret or selection
 * strictly INSIDE an already-formatted node of one of those names (e.g. 'bold' inside
 * `**bold**`) unwraps instead of wrapping again / inserting a nested pair.
 */
function wrapUnwrap(state: EditorState, open: string, close: string, nodeNames?: string[]): TransactionSpec {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  if (nodeNames !== undefined) {
    const t = treeUnwrap(state, open, close, nodeNames)
    if (t !== null) return t
  }
  if (range.empty) {
    const pos = range.head
    return {
      changes: { from: pos, to: pos, insert: open + close },
      selection: { anchor: pos + open.length },
    }
  }
  const text = state.doc.sliceString(from, to)
  if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
    const inner = text.slice(open.length, text.length - close.length)
    return {
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: to - open.length - close.length },
    }
  }
  return {
    changes: { from, to, insert: open + text + close },
    selection: { anchor: from + open.length, head: to + open.length },
  }
}

/** Toggle bold `**x**`. Empty selection inserts `****` with the caret between the pairs. */
export function toggleBoldSpec(state: EditorState): TransactionSpec {
  return wrapUnwrap(state, '**', '**', ['StrongEmphasis'])
}

/** Toggle italic `*x*`. Empty selection inserts `**` with the caret between. */
export function toggleItalicSpec(state: EditorState): TransactionSpec {
  return wrapUnwrap(state, '*', '*', ['Emphasis'])
}

/** Toggle underline `<u>x</u>`. Empty selection inserts `<u></u>`, caret between the tags. */
export function toggleUnderlineSpec(state: EditorState): TransactionSpec {
  return wrapUnwrap(state, '<u>', '</u>')
}

/** Toggle strikethrough `~~x~~`. Empty selection inserts `~~~~`, caret between the pairs. */
export function toggleStrikethroughSpec(state: EditorState): TransactionSpec {
  return wrapUnwrap(state, '~~', '~~', ['Strikethrough'])
}

/** Toggle subscript `<sub>x</sub>`. */
export function toggleSubscriptSpec(state: EditorState): TransactionSpec {
  return wrapUnwrap(state, '<sub>', '</sub>')
}

/** Toggle superscript `<sup>x</sup>`. */
export function toggleSuperscriptSpec(state: EditorState): TransactionSpec {
  return wrapUnwrap(state, '<sup>', '</sup>')
}

/** Toggle highlight `==x==`. Empty selection inserts `====`, caret between the pairs. */
export function toggleHighlightSpec(state: EditorState): TransactionSpec {
  return wrapUnwrap(state, '==', '==')
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

/** Rewrite one line's heading prefix. `level` 0 = strip the heading entirely. */
function transformHeading(text: string, level: 0 | 1 | 2 | 3 | 4 | 5 | 6): string {
  const indent = /^\s*/.exec(text)![0]
  const rest = text.slice(indent.length)
  let content = rest
  const headingMatch = /^(#{1,6})(\s*)/.exec(rest)
  if (headingMatch) {
    // Existing heading: drop the `#`s (+ following space) and any trailing " #".
    content = rest.slice(headingMatch[0].length).replace(/\s+#\s*$/, '')
  }
  content = content.trim()
  if (level === 0) return indent + content
  return indent + '#'.repeat(level) + (content ? ' ' + content : '')
}

/**
 * Set the heading level of every selected line. `level` 0 clears the heading. Lines
 * already at the target level are left unchanged. Per spec: strip an existing leading
 * `#{1,6}` (and optional trailing ` #`), then prepend `#`×level after leading whitespace.
 */
export function setHeadingSpec(state: EditorState, level: 0 | 1 | 2 | 3 | 4 | 5 | 6): TransactionSpec {
  const range = state.selection.main
  const lines = affectedLines(state, range.from, range.to)
  const changes: { from: number; to: number; insert: string }[] = []
  for (const line of lines) {
    const next = transformHeading(line.text, level)
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }
  return finalizeChanges(state, changes, range.from, range.to)
}

/** Heading level of a line's text: 0 = paragraph, 1..6 = heading depth. */
function headingLevel(text: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const indent = /^\s*/.exec(text)![0]
  const m = /^(#{1,6})(?:\s|$)/.exec(text.slice(indent.length))
  if (!m) return 0
  return m[1].length as 0 | 1 | 2 | 3 | 4 | 5 | 6
}

/** Cycle the caret line's heading: paragraph → H1 → … → H6 → paragraph. */
export function cycleHeadingSpec(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head)
  const current = headingLevel(line.text)
  return setHeadingSpec(state, ((current + 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6)
}

// ---------------------------------------------------------------------------
// Lists, blockquote, task list
// ---------------------------------------------------------------------------

type ListKind = 'unordered' | 'ordered' | 'task'

interface ListMarker {
  indent: string
  marker: string
}

/** Detect a list marker at the start of a line (after leading whitespace). */
function listMarker(text: string, kind: ListKind): ListMarker | null {
  let m: RegExpExecArray | null
  if (kind === 'task') {
    m = /^(\s*)(- \[[ xX]\]\s+)/.exec(text)
  } else if (kind === 'ordered') {
    m = /^(\s*)(\d+\.\s+)/.exec(text)
  } else {
    m = /^(\s*)([-*+]\s+)/.exec(text)
  }
  if (!m) return null
  return { indent: m[1], marker: m[2] }
}

/**
 * Smart list toggle. If EVERY selected line already carries the marker of `kind`,
 * remove the markers (toggle off); otherwise add the marker to every selected line
 * (ordered: sequential numbers starting at 1; task: `- [ ] `). Empty selection
 * operates on the caret's line.
 */
export function toggleListSpec(state: EditorState, kind: ListKind): TransactionSpec {
  const range = state.selection.main
  const lines = affectedLines(state, range.from, range.to)
  const hasAll = lines.every((line) => listMarker(line.text, kind) !== null)
  const changes: { from: number; to: number; insert: string }[] = []

  if (hasAll) {
    for (const line of lines) {
      const marker = listMarker(line.text, kind)!
      changes.push({
        from: line.from + marker.indent.length,
        to: line.from + marker.indent.length + marker.marker.length,
        insert: '',
      })
    }
  } else {
    let counter = 1
    for (const line of lines) {
      if (listMarker(line.text, kind) !== null) continue
      const indent = /^\s*/.exec(line.text)![0]
      let markerText: string
      if (kind === 'ordered') markerText = `${counter++}. `
      else if (kind === 'task') markerText = '- [ ] '
      else markerText = '- '
      changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert: markerText })
    }
  }
  return finalizeChanges(state, changes, range.from, range.to)
}

/** Toggle a task list on the selected lines (same as `toggleListSpec(…,'task')`). */
export function toggleTaskListSpec(state: EditorState): TransactionSpec {
  return toggleListSpec(state, 'task')
}

/**
 * Blockquote toggle. Prefix every selected line with `> ` (after leading whitespace);
 * if every line already starts with `> `, remove one `> ` from each.
 */
export function toggleBlockquoteSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const lines = affectedLines(state, range.from, range.to)
  const allQuoted = lines.every((line) => /^(\s*)> /.test(line.text))
  const changes: { from: number; to: number; insert: string }[] = []
  for (const line of lines) {
    const m = /^(\s*)(> )/.exec(line.text)
    if (allQuoted && m) {
      changes.push({
        from: line.from + m[1].length,
        to: line.from + m[1].length + m[2].length,
        insert: '',
      })
    } else if (!allQuoted && !m) {
      const indent = /^\s*/.exec(line.text)![0]
      changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert: '> ' })
    }
  }
  return finalizeChanges(state, changes, range.from, range.to)
}

// ---------------------------------------------------------------------------
// Inline code / code blocks
// ---------------------------------------------------------------------------

/**
 * Toggle inline code. Single backticks by default; if the selected text contains a
 * backtick, use double backticks. Unwrap when already wrapped in backticks. Empty
 * selection inserts two backticks with the caret between.
 */
export function toggleInlineCodeSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  if (range.empty) {
    const pos = range.head
    return {
      changes: { from: pos, to: pos, insert: '``' },
      selection: { anchor: pos + 1 },
    }
  }
  const text = state.doc.sliceString(from, to)
  if (text.startsWith('`') && text.endsWith('`') && text.length >= 2) {
    return {
      changes: { from, to, insert: text.slice(1, -1) },
      selection: { anchor: from, head: to - 2 },
    }
  }
  const delim = text.includes('`') ? '``' : '`'
  return {
    changes: { from, to, insert: delim + text + delim },
    selection: { anchor: from + delim.length, head: to + delim.length },
  }
}

/**
 * Toggle a fenced code block. If the selection already spans a fenced block (any line
 * starting with ```), remove the fence lines. Otherwise wrap the selection (or the
 * caret line when empty) in a fence. Empty selection inserts a two-line template with
 * the caret on the empty middle line.
 */
export function toggleCodeBlockSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  if (range.empty) {
    const pos = range.head
    const insert = '```\n\n```'
    return { changes: { from: pos, to: pos, insert }, selection: { anchor: pos + 4 } }
  }
  const lines = affectedLines(state, from, to)
  const fenced = lines.some((line) => /^```/.test(line.text.trim()))
  if (fenced) {
    const changes: { from: number; to: number; insert: string }[] = []
    for (const line of lines) {
      if (/^```/.test(line.text.trim())) {
        changes.push({ from: line.from, to: line.to, insert: '' })
      }
    }
    return finalizeChanges(state, changes, from, to)
  }
  const text = state.doc.sliceString(from, to)
  const insert = '```\n' + text + '\n```'
  return { changes: { from, to, insert }, selection: { anchor: from + 4 } }
}

// ---------------------------------------------------------------------------
// Link / image
// ---------------------------------------------------------------------------

/** Insert a link. Non-empty selection → `[selected](url)` with `url` selected; empty → `[text](url)` with `text` selected. */
export function insertLinkSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  if (range.empty) {
    const pos = range.head
    const insert = '[text](url)'
    return { changes: { from: pos, to: pos, insert }, selection: { anchor: pos + 1, head: pos + 5 } }
  }
  const text = state.doc.sliceString(from, to)
  const insert = '[' + text + '](url)'
  return { changes: { from, to, insert }, selection: { anchor: from + text.length + 3, head: from + text.length + 6 } }
}

/** Insert an image. Non-empty selection → `![selected](image.png)`; empty → `![alt](image.png)` with `alt` selected. */
export function insertImageSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  if (range.empty) {
    const pos = range.head
    const insert = '![alt](image.png)'
    return { changes: { from: pos, to: pos, insert }, selection: { anchor: pos + 2, head: pos + 5 } }
  }
  const text = state.doc.sliceString(from, to)
  const insert = '![' + text + '](image.png)'
  return {
    changes: { from, to, insert },
    selection: { anchor: from + text.length + 4, head: from + text.length + 13 },
  }
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/**
 * Insert a GFM table template (default 3×3) on its own block, surrounded by blank
 * lines. Caret lands in the first body cell (first column of the first body row).
 * `rows`/`cols` are clamped to ≥ 1.
 */
export function insertTableSpec(state: EditorState, rows = 3, cols = 3): TransactionSpec {
  const r = Math.max(1, Math.floor(rows))
  const c = Math.max(1, Math.floor(cols))
  const headerCells = Array.from({ length: c }, (_, i) => `Col ${i + 1}`)
  const sepCells = Array.from({ length: c }, () => '-----')
  const emptyCells = Array.from({ length: c }, () => '')
  const row = (cells: string[]): string => '| ' + cells.join(' | ') + ' |'
  const header = row(headerCells)
  const sep = row(sepCells)
  const body = Array.from({ length: r }, () => row(emptyCells))
  const insert = '\n' + [header, sep, ...body].join('\n') + '\n'
  const pos = state.selection.main.head
  const caret = pos + '\n'.length + header.length + '\n'.length + sep.length + '\n'.length + '| '.length
  return { changes: { from: pos, to: pos, insert }, selection: { anchor: caret } }
}

// ---------------------------------------------------------------------------
// Horizontal rule
// ---------------------------------------------------------------------------

/**
 * Insert `---` on its own line, ensuring a blank line before and after when not
 * already blank. Caret lands right after the `---`.
 */
export function insertHrSpec(state: EditorState): TransactionSpec {
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  const above = line.text.slice(0, pos - line.from)
  const below = line.text.slice(pos - line.from)
  const aboveBlank =
    above.trim() === '' && (line.number === 1 || state.doc.line(line.number - 1).text.trim() === '')
  const belowBlank =
    below.trim() === '' && (line.number === state.doc.lines || state.doc.line(line.number + 1).text.trim() === '')
  let insert = ''
  if (!aboveBlank) insert += '\n\n'
  insert += '---'
  if (!belowBlank) insert += '\n\n'
  return { changes: { from: pos, to: pos, insert }, selection: { anchor: pos + insert.length } }
}

// ---------------------------------------------------------------------------
// Footnote
// ---------------------------------------------------------------------------

/**
 * Insert a footnote marker `[^N]` at the caret (N = next number above every existing
 * marker) and append `\n\n[^N]: ` as the definition placeholder at the end of the
 * doc. Caret stays right after the inline marker.
 */
export function insertFootnoteSpec(state: EditorState): TransactionSpec {
  const pos = state.selection.main.head
  let max = 0
  const re = /\[\^(\d+)\]/g
  const doc = state.doc.toString()
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) {
    const n = parseInt(m[1], 10)
    if (n > max) max = n
  }
  const num = max + 1
  const marker = `[^${num}]`
  const changes = [
    { from: pos, to: pos, insert: marker },
    { from: state.doc.length, to: state.doc.length, insert: `\n\n${marker}: ` },
  ]
  return { changes, selection: { anchor: pos + marker.length } }
}

// ---------------------------------------------------------------------------
// Heading id / definition list
// ---------------------------------------------------------------------------

/**
 * Append ` {#custom-id}` to the current line if it is a heading (replacing an existing
 * trailing ` {#...}` first). Caret lands right after the inserted id. Non-heading
 * lines are left untouched.
 */
export function insertHeadingIdSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)
  if (headingLevel(line.text) === 0) return noChangeSpec(state)
  const stripped = line.text.replace(/\s*\{#[^}]*\}$/, '')
  const next = stripped + ' {#custom-id}'
  return {
    changes: { from: line.from, to: line.to, insert: next },
    selection: { anchor: line.from + next.length },
  }
}

/** Insert a definition-list template `Term\n: Definition` with `Term` selected. */
export function insertDefListSpec(state: EditorState): TransactionSpec {
  const pos = state.selection.main.head
  const insert = 'Term\n: Definition'
  return { changes: { from: pos, to: pos, insert }, selection: { anchor: pos, head: pos + 4 } }
}

// ---------------------------------------------------------------------------
// Generic text insert + Enter-in-list continuation
// ---------------------------------------------------------------------------

/** Replace the current selection with `text` and put the caret right after it (emoji picker). */
export function insertTextSpec(state: EditorState, text: string): TransactionSpec {
  const range = state.selection.main
  return {
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
  }
}

/** Structured info about a list item line. */
interface ListItemInfo {
  indent: string
  marker: string
  kind: ListKind
  number?: number
}

function listItemInfo(text: string): ListItemInfo | null {
  let m = /^(\s*)(- \[[ xX]\]\s+)/.exec(text)
  if (m) return { indent: m[1], marker: m[2], kind: 'task' }
  m = /^(\s*)(\d+\.\s+)/.exec(text)
  if (m) return { indent: m[1], marker: m[2], kind: 'ordered', number: parseInt(m[2], 10) }
  m = /^(\s*)([-*+]\s+)/.exec(text)
  if (m) return { indent: m[1], marker: m[2], kind: 'unordered' }
  return null
}

/**
 * Enter-inside-a-list continuation, as a single transaction. If the caret line is NOT
 * a list item, returns `null` (let Enter fall through). If the item is empty, remove
 * its marker so the line becomes empty (second Enter exits the list). Otherwise insert
 * a newline + the same marker (task keeps `- [ ] `, ordered continues the sequence
 * number) and put the caret after the marker.
 */
export function continueListSpec(state: EditorState): TransactionSpec | null {
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)
  const info = listItemInfo(line.text)
  if (!info) return null
  const content = line.text.slice(info.indent.length + info.marker.length)
  if (content.trim() === '') {
    return { changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } }
  }
  let nextMarker = info.marker
  if (info.kind === 'task') nextMarker = '- [ ] '
  else if (info.kind === 'ordered' && info.number !== undefined) nextMarker = `${info.number + 1}. `
  const insert = '\n' + info.indent + nextMarker
  return { changes: { from: line.to, to: line.to, insert }, selection: { anchor: line.to + insert.length } }
}

/**
 * KeyBindings binding Enter to list continuation. Returns `true` only when
 * `continueListSpec` produced a transaction (so Enter falls through otherwise).
 * The editor wraps the returned array with keymap.of; wired into the editor by
 * another M3 packet.
 */
export function markdownListKeymap(): KeyBinding[] {
  return [
    {
      key: 'Enter',
      run: stateCommand(({ state, dispatch }) => {
        const spec = continueListSpec(state)
        if (spec === null) return false
        dispatch(state.update(spec))
        return true
      }),
    },
  ]
}

// ---------------------------------------------------------------------------
// Action registry (LOCKED ids — menus/hotkeys depend on these exact keys)
// ---------------------------------------------------------------------------

function setHeadingCommand(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): FormattingCommand {
  return (state) => setHeadingSpec(state, level)
}

/** All formatting actions keyed by LOCKED action id. */
export const FORMATTING_COMMANDS: Record<string, FormattingCommand> = {
  bold: toggleBoldSpec,
  italic: toggleItalicSpec,
  underline: toggleUnderlineSpec,
  strikethrough: toggleStrikethroughSpec,
  'header-cycle': cycleHeadingSpec,
  'header-0': setHeadingCommand(0),
  'header-1': setHeadingCommand(1),
  'header-2': setHeadingCommand(2),
  'header-3': setHeadingCommand(3),
  'header-4': setHeadingCommand(4),
  'header-5': setHeadingCommand(5),
  'header-6': setHeadingCommand(6),
  list: (state) => toggleListSpec(state, 'unordered'),
  'list-unordered': (state) => toggleListSpec(state, 'unordered'),
  'list-ordered': (state) => toggleListSpec(state, 'ordered'),
  'list-task': toggleTaskListSpec,
  blockquote: toggleBlockquoteSpec,
  'inline-code': toggleInlineCodeSpec,
  'code-block': toggleCodeBlockSpec,
  link: insertLinkSpec,
  image: insertImageSpec,
  table: (state) => insertTableSpec(state),
  hr: insertHrSpec,
  footnote: insertFootnoteSpec,
  'task-list': toggleTaskListSpec,
  'heading-id': insertHeadingIdSpec,
  'def-list': insertDefListSpec,
  sub: toggleSubscriptSpec,
  sup: toggleSuperscriptSpec,
  highlight: toggleHighlightSpec,
}
