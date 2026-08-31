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
 * `nodeNames` and whose range contains the selection (loose containment: an empty
 * caret ANYWHERE inside the node, including on the marker characters, unwraps —
 * user-results E1/E4); when found, removes the markers and maps the selection left
 * by `open.length`. The source text must still start with `open` and end with
 * `close` (the delimiter predicate): this is what keeps `**` bold separate from
 * `__` underline even though lezer parses both as `StrongEmphasis`.
 * Returns null when no such node exists (e.g. no markdown language configured).
 */
function treeUnwrap(state: EditorState, open: string, close: string, nodeNames: string[]): TransactionSpec | null {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  const tree = syntaxTree(state)
  let found: SyntaxNode | null = null
  let bestSize = Infinity
  for (const pos of [from, to] as const) {
    for (const bias of [1, -1] as const) {
      let node: SyntaxNode | null = tree.resolveInner(pos, bias)
      while (node !== null) {
        if (nodeNames.includes(node.name) && node.from <= from && to <= node.to) {
          const text = state.doc.sliceString(node.from, node.to)
          if (text.startsWith(open) && text.endsWith(close)) {
            const size = node.to - node.from
            if (size < bestSize) {
              bestSize = size
              found = node
            }
            break
          }
        }
        node = node.parent
      }
    }
  }
  const node = found
  if (node === null) return null
  const text = state.doc.sliceString(node.from, node.to)
  if (!text.startsWith(open) || !text.endsWith(close)) return null
  const innerLen = text.length - open.length - close.length
  const contentEnd = node.from + innerLen
  const caret = Math.max(node.from, Math.min(from - open.length, contentEnd))
  const head = Math.max(node.from, Math.min(to - open.length, contentEnd))
  return {
    changes: { from: node.from, to: node.to, insert: text.slice(open.length, text.length - close.length) },
    selection: { anchor: caret, head },
  }
}

/**
 * True when the caret/selection head sits inside a syntax node of `nodeName`
 * whose source text is wrapped in the given `mark` delimiters on both sides
 * (used to keep `**` bold and `__` underline apart — each command refuses to
 * touch the other's territory).
 */
function insideMarkedNode(state: EditorState, nodeName: string, mark: string): boolean {
  const head = state.selection.main.head
  const tree = syntaxTree(state)
  for (const bias of [1, -1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(head, bias)
    while (node !== null && node.name !== nodeName) node = node.parent
    if (node !== null) {
      const text = state.doc.sliceString(node.from, node.to)
      if (text.startsWith(mark) && text.endsWith(mark) && node.from <= head && head <= node.to) return true
    }
  }
  return false
}

/**
 * Text-based unwrap for literal pair regions (`<sub>…</sub>`, `<sup>…</sup>`,
 * `==…==`, `__…__`) that live in the caret's line. Finds the LAST `open` at/before
 * the selection start and the FIRST `close` at/after the selection end, removes
 * both, and maps the selection through the removals (user-results E18/E19/E20).
 * Returns null when no valid pair wraps the selection.
 */
function textRegionUnwrap(state: EditorState, open: string, close: string): TransactionSpec | null {
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)
  const text = line.text
  const relFrom = range.from - line.from
  const relTo = range.to - line.from
  let openIdx = -1
  let closeIdx = -1
  if (open === close) {
    // Same delimiters: pair consecutive occurrences. For "~" isolate single tildes (skip ~~)
    const positions: number[] = []
    if (open === '~') {
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== '~') continue
        const prevIsTilde = i > 0 && text[i - 1] === '~'
        const nextIsTilde = i + 1 < text.length && text[i + 1] === '~'
        if (prevIsTilde || nextIsTilde) continue
        positions.push(i)
      }
    } else {
      let idx = text.indexOf(open, 0)
      while (idx !== -1) {
        positions.push(idx)
        idx = text.indexOf(open, idx + open.length)
      }
    }
    for (let i = 0; i + 1 < positions.length; i += 2) {
      const o = positions[i]
      const c = positions[i + 1]
      if (relFrom >= o && relTo <= c + close.length && relFrom < c + close.length && relTo >= o) {
        if (openIdx === -1 || c - o < closeIdx - openIdx) {
          openIdx = o
          closeIdx = c
        }
      }
    }
    if (openIdx === -1) {
      let candOpen = -1
      let candClose = -1
      if (open === '~') {
        for (let i = relFrom; i >= 0; i--) if (text[i] === '~' && !(i > 0 && text[i - 1] === '~') && !(i + 1 < text.length && text[i + 1] === '~')) { candOpen = i; break }
        if (candOpen >= 0) for (let i = candOpen + 1; i < text.length; i++) if (text[i] === '~' && !(i > 0 && text[i - 1] === '~') && !(i + 1 < text.length && text[i + 1] === '~')) { candClose = i; break }
      } else {
        candOpen = text.lastIndexOf(open, relFrom)
        if (candOpen >= 0) candClose = text.indexOf(close, candOpen + open.length)
      }
      if (candOpen >= 0 && candClose >= 0 && relFrom >= candOpen && relTo <= candClose + close.length) {
        openIdx = candOpen
        closeIdx = candClose
      }
    }
    if (openIdx < 0 || closeIdx < 0) return null
  } else {
    const o = text.lastIndexOf(open, relFrom)
    if (o < 0) return null
    const c = text.indexOf(close, Math.max(o + open.length, relTo))
    const c2 = c === -1 ? text.indexOf(close, o + open.length) : c
    if (c2 < 0) return null
    openIdx = o
    closeIdx = c2
  }
  const innerStart = line.from + openIdx + open.length
  const innerEnd = line.from + closeIdx
  if (innerEnd <= innerStart) return null
  if (relFrom < openIdx || relTo > closeIdx + close.length) return null
  const anchor = range.from >= innerStart ? range.from - open.length : line.from + openIdx
  const head =
    range.to < innerStart
      ? line.from + openIdx
      : range.to <= innerEnd
        ? range.to - open.length
        : innerEnd - open.length
  return {
    changes: [
      { from: line.from + openIdx, to: innerStart, insert: '' },
      { from: innerEnd, to: innerEnd + close.length, insert: '' },
    ],
    selection: { anchor, head },
  }
}

/**
 * Empty-caret unwrap for `open|close` with zero interior (e.g. `**|**` → `|`,
 * `*|*` → `|`, `__|__` → `|`, `~~|~~` → `|`, `~|~` → `|`, `^|^` → `|`,
 * `==|==` → `|`). The syntax tree produces no node for empty interiors, so
 * `treeUnwrap`/`textRegionUnwrap` cannot handle this case. Checks that the
 * characters immediately before and after the caret equal `open` and `close`.
 */
function unwrapEmptyDelimiters(state: EditorState, open: string, close: string): TransactionSpec | null {
  const range = state.selection.main
  if (!range.empty) return null
  const pos = range.head
  if (pos < open.length || pos + close.length > state.doc.length) return null
  const before = state.doc.sliceString(pos - open.length, pos)
  const after = state.doc.sliceString(pos, pos + close.length)
  if (before !== open || after !== close) return null
  return {
    changes: { from: pos - open.length, to: pos + close.length, insert: '' },
    selection: { anchor: pos - open.length },
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

/** Toggle bold `**x**`. Empty selection inserts `****` with the caret between the pairs.
 * `__`-marked StrongEmphasis belongs to underline — left untouched (E3/E4 split). */
export function toggleBoldSpec(state: EditorState): TransactionSpec {
  if (insideMarkedNode(state, 'StrongEmphasis', '__')) return noChangeSpec(state)
  const empty = unwrapEmptyDelimiters(state, '**', '**')
  if (empty !== null) return empty
  return wrapUnwrap(state, '**', '**', ['StrongEmphasis'])
}

/** Toggle italic `*x*`. Empty selection inserts `**` with the caret between. */
export function toggleItalicSpec(state: EditorState): TransactionSpec {
  const empty = unwrapEmptyDelimiters(state, '*', '*')
  if (empty !== null) return empty
  return wrapUnwrap(state, '*', '*', ['Emphasis'])
}

/** Toggle underline `__x__`. Empty selection inserts `____`, caret between the pairs. */
export function toggleUnderlineSpec(state: EditorState): TransactionSpec {
  if (insideMarkedNode(state, 'StrongEmphasis', '**')) return noChangeSpec(state)
  const empty = unwrapEmptyDelimiters(state, '__', '__')
  if (empty !== null) return empty
  const range = state.selection.main
  {
    let best: SyntaxNode | null = null
    for (const pos of [range.from, range.to] as const) {
      for (const bias of [1, -1] as const) {
        let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, bias)
        while (n !== null && n.name !== 'StrongEmphasis') n = n.parent
        if (n !== null && n.from <= range.from && range.to <= n.to) {
          const text = state.doc.sliceString(n.from, n.to)
          if (text.startsWith('__') && text.endsWith('__')) {
            if (best === null || n.to - n.from < best.to - best.from) best = n
          }
        }
      }
    }
    if (best !== null) {
      const text = state.doc.sliceString(best.from, best.to)
      const contentEnd = best.from + text.length - 4
      const caret = Math.max(best.from, Math.min(range.from - 2, contentEnd))
      const head = Math.max(best.from, Math.min(range.to - 2, contentEnd))
      return {
        changes: { from: best.from, to: best.to, insert: text.slice(2, text.length - 2) },
        selection: { anchor: caret, head },
      }
    }
  }
  const t = textRegionUnwrap(state, '__', '__')
  if (t !== null) return t
  return wrapUnwrap(state, '__', '__')
}

/** Toggle strikethrough `~~x~~`. Empty selection inserts `~~~~`, caret between the pairs. */
export function toggleStrikethroughSpec(state: EditorState): TransactionSpec {
  const empty = unwrapEmptyDelimiters(state, '~~', '~~')
  if (empty !== null) return empty
  return wrapUnwrap(state, '~~', '~~', ['Strikethrough'])
}

/** Toggle subscript `~x~` (exports as `<sub>`). Also unwraps legacy `<sub>x</sub>` (B17). Caret inside unwraps (E18). */
export function toggleSubscriptSpec(state: EditorState): TransactionSpec {
  const empty = unwrapEmptyDelimiters(state, '~', '~')
  if (empty !== null) return empty
  let t = textRegionUnwrap(state, '~', '~')
  if (t !== null) return t
  t = textRegionUnwrap(state, '<sub>', '</sub>')
  if (t !== null) return t
  return wrapUnwrap(state, '~', '~')
}

/** Toggle superscript `^x^` (exports as `<sup>`). Also unwraps legacy `<sup>x</sup>` (B17). Caret inside unwraps (E19). */
export function toggleSuperscriptSpec(state: EditorState): TransactionSpec {
  const empty = unwrapEmptyDelimiters(state, '^', '^')
  if (empty !== null) return empty
  let t = textRegionUnwrap(state, '^', '^')
  if (t !== null) return t
  t = textRegionUnwrap(state, '<sup>', '</sup>')
  if (t !== null) return t
  return wrapUnwrap(state, '^', '^')
}

/** Toggle highlight `==x==`. Empty selection inserts `====`, caret between the pairs. */
export function toggleHighlightSpec(state: EditorState): TransactionSpec {
  const empty = unwrapEmptyDelimiters(state, '==', '==')
  if (empty !== null) return empty
  const t = textRegionUnwrap(state, '==', '==')
  if (t !== null) return t
  return wrapUnwrap(state, '==', '==')
}

/** Toggle spoiler `||x||`. Empty selection inserts `||||`, caret between the pairs. */
export function toggleSpoilerSpec(state: EditorState): TransactionSpec {
  const empty = unwrapEmptyDelimiters(state, '||', '||')
  if (empty !== null) return empty
  const t = textRegionUnwrap(state, '||', '||')
  if (t !== null) return t
  return wrapUnwrap(state, '||', '||')
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
  return indent + '#'.repeat(level) + ' ' + content
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
  if (changes.length === 0) return noChangeSpec(state)
  const changeSet = state.changes(changes)
  if (range.from === range.to) {
    const caretLine = state.doc.lineAt(range.from)
    const next = transformHeading(caretLine.text, level)
    const indentLen = /^\s*/.exec(next)![0].length
    const markerMatch = /^(#{1,6})\s?/.exec(next.slice(indentLen))
    const prefixLen = indentLen + (markerMatch ? markerMatch[0].length : 0)
    const anchor = caretLine.from + prefixLen
    return { changes: changeSet, selection: { anchor, head: anchor } }
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

/** Detect a list marker at the start of a line (after leading whitespace).
 * Task markers accept all four user-results #4 spellings: `-[]`, `- []`, `-[ ]`,
 * `- [ ]` (and checked variants). The pattern captures the exact marker
 * including the trailing space so continuation preserves the same form
 * (e.g. "- [] item" → "- [] "). The unordered pattern also consumes a
 * task checkbox so toggling unordered OFF removes the whole `- [ ]` marker
 * instead of leaving `[ ]` (E7). */
function listMarker(text: string, kind: ListKind): ListMarker | null {
  let m: RegExpExecArray | null
  if (kind === 'task') {
    // Task: dash/star/plus, optional spaces, '[', optional space/x, ']', trailing spaces.
    // This matches all four forms: "-[] ", "- [] ", "-[ ] ", "- [ ] " (and "*"/"+" variants).
    m = /^(\s*)([-*+]\s*\[[ xX]?\]\s*)/.exec(text)
    if (!m) return null
    // Guard: must contain brackets; \s* alone would otherwise allow "- " to pass if regex changed.
    if (!m[2].includes('[') || !m[2].includes(']')) return null
    // Ensure at least the bracket pair is present; "- []" (dash space [] space) must be recognised.
    // The regex already requires "\[", but keep explicit check for safety.
    return { indent: m[1], marker: m[2] }
  } else if (kind === 'ordered') {
    m = /^(\s*)(\d+\.\s+)/.exec(text)
  } else {
    m = /^(\s*)([-*+]\s*(\[[ xX]?\]\s*)?)/.exec(text)
  }
  if (!m) return null
  return { indent: m[1], marker: m[2] }
}

/**
 * Smart list toggle. If EVERY selected line already carries the marker of `kind`,
 * remove the markers (toggle off); otherwise add the marker to every selected line
 * (ordered: sequential numbers starting at 1; task: `-[] ` — the user-results #4
 * default form). Empty selection operates on the caret's line.
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
      else if (kind === 'task') markerText = '-[] '
      else markerText = '- '
      changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert: markerText })
    }
  }
  if (range.empty && changes.length === 1 && !hasAll) {
    const cs = state.changes(changes)
    const anchor = cs.mapPos(range.from, 1)
    return { changes: cs, selection: { anchor } }
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
  if (range.empty && changes.length === 1 && !allQuoted) {
    const cs = state.changes(changes)
    const anchor = cs.mapPos(range.from, 1)
    return { changes: cs, selection: { anchor } }
  }
  return finalizeChanges(state, changes, range.from, range.to)
}

// ---------------------------------------------------------------------------
// Inline code / code blocks
// ---------------------------------------------------------------------------

/**
 * Syntax-tree unwrap for InlineCode: when the caret/selection is inside an
 * InlineCode node, remove ONE pair of backticks (the node spans the delimiters;
 * for `n`-backtick runs remove `n` at each end) — user-results E9.
 */
function codeNodeUnwrap(state: EditorState): TransactionSpec | null {
  const range = state.selection.main
  let best: SyntaxNode | null = null
  let bestSize = Infinity
  for (const pos of [range.from, range.to] as const) {
    for (const bias of [1, -1] as const) {
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, bias)
      while (node !== null && node.name !== 'InlineCode') node = node.parent
      if (node !== null && node.from <= range.from && range.to <= node.to) {
        const sz = node.to - node.from
        if (sz < bestSize) {
          bestSize = sz
          best = node
        }
      }
    }
  }
  const node = best
  if (node === null) return null
  if (!(node.from <= range.from && range.to <= node.to)) return null
  const text = state.doc.sliceString(node.from, node.to)
  if (!text.startsWith('`')) return null
  let n1 = 0
  while (text[n1] === '`') n1++
  let n2 = 0
  while (text[text.length - 1 - n2] === '`') n2++
  if (n1 === 0 || n2 === 0) return null
  const contentEnd = node.from + text.length - n1 - n2
  const caret = Math.max(node.from, Math.min(range.from - n1, contentEnd))
  const head = Math.max(node.from, Math.min(range.to - n1, contentEnd))
  return {
    changes: { from: node.from, to: node.to, insert: text.slice(n1, text.length - n2) },
    selection: { anchor: caret, head },
  }
}

/**
 * Toggle inline code. Single backticks by default; if the selected text contains a
 * backtick, use double backticks. Unwrap when already wrapped in backticks (tree
 * unwrap first — an empty caret inside a code span now unwraps, E9). Empty
 * selection inserts two backticks with the caret between.
 */
export function toggleInlineCodeSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const t = codeNodeUnwrap(state)
  if (t !== null) return t
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
 * Toggle a fenced code block. Caret inside an existing FencedCode node → remove
 * the WHOLE block (fences + content, user-results E10). Otherwise: if the
 * selection already spans a fenced block (any line starting with ```), remove the
 * fence lines. Otherwise wrap the selection (or the caret line when empty) in a
 * fence. Empty selection inserts a two-line template with the caret on the empty
 * middle line.
 */
export function toggleCodeBlockSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  if (range.empty) {
    let best: SyntaxNode | null = null
    for (const bias of [-1, 1] as const) {
      let n: SyntaxNode | null = syntaxTree(state).resolveInner(range.head, bias)
      while (n !== null && n.name !== 'FencedCode') n = n.parent
      if (n !== null && n.from < range.head && range.head <= n.to) {
        if (best === null || n.to - n.from < best.to - best.from) best = n
      }
    }
    const node = best
    if (node !== null && node.from < range.head && range.head <= node.to) {
      const full = state.doc.sliceString(node.from, node.to)
      const firstNL = full.indexOf('\n')
      let inner = ''
      if (firstNL !== -1) {
        const lines = full.split('\n')
        if (lines.length >= 2) inner = lines.slice(1, -1).join('\n')
      }
      const contentEnd = node.from + inner.length
      const openingLen = firstNL === -1 ? full.length : firstNL + 1
      const rel = range.head - node.from - openingLen
      const anchor = Math.max(node.from, Math.min(node.from + Math.max(0, rel), contentEnd))
      return {
        changes: { from: node.from, to: node.to, insert: inner },
        selection: { anchor },
      }
    }
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

/**
 * Tree-based toggle-off for Link/Image: when the selection is inside a parsed
 * Link (or Image) node, replace the whole node with its inner text (Link → link
 * text, Image → alt text) — user-results E11/E12.
 */
function linkImageToggleOff(state: EditorState, image: boolean): TransactionSpec | null {
  const range = state.selection.main
  let best: SyntaxNode | null = null
  let bestSize = Infinity
  for (const pos of [range.from, range.to] as const) {
    for (const bias of [1, -1] as const) {
      let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, bias)
      while (n !== null && n.name !== (image ? 'Image' : 'Link')) n = n.parent
      if (n !== null && n.from <= range.from && range.to <= n.to) {
        const sz = n.to - n.from
        if (sz < bestSize) {
          bestSize = sz
          best = n
        }
      }
    }
  }
  const node = best
  if (node === null) return null
  if (!(node.from <= range.from && range.to <= node.to)) return null
  let url: SyntaxNode | null = null
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === 'URL') {
      url = child
      break
    }
  }
  if (url === null) return null
  const prefixLen = image ? 2 : 1 // `![` vs `[`
  const inner = state.doc.sliceString(node.from + prefixLen, url.from - 2)
  const contentEnd = node.from + inner.length
  const caret = Math.max(node.from, Math.min(range.from - prefixLen, contentEnd))
  const head = Math.max(node.from, Math.min(range.to - prefixLen, contentEnd))
  return {
    changes: { from: node.from, to: node.to, insert: inner },
    selection: { anchor: caret, head },
  }
}

/**
 * Insert a link. Re-invoking on an untouched template deletes it; caret inside an
 * existing link replaces it with its text (E11). Non-empty selection →
 * `[selected](url)` with `url` selected; empty → `[text](url)` with `text` selected.
 */
export function insertLinkSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  if (range.empty) {
    const pos = range.head
    const template = '[text](url)'
    if (pos >= template.length && state.doc.sliceString(pos - template.length, pos) === template) {
      return {
        changes: { from: pos - template.length, to: pos, insert: '' },
        selection: { anchor: pos - template.length },
      }
    }
    const t = linkImageToggleOff(state, false)
    if (t !== null) return t
    const insert = template
    return { changes: { from: pos, to: pos, insert }, selection: { anchor: pos + 1, head: pos + 5 } }
  }
  const t = linkImageToggleOff(state, false)
  if (t !== null) return t
  const text = state.doc.sliceString(from, to)
  const insert = '[' + text + '](url)'
  return { changes: { from, to, insert }, selection: { anchor: from + text.length + 3, head: from + text.length + 6 } }
}

/**
 * Insert an image. Re-invoking on an untouched template deletes it; caret inside an
 * existing image replaces it with its alt text (E12). Non-empty selection →
 * `![selected](image.png)`; empty → `![alt](image.png)` with `alt` selected.
 */
export function insertImageSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const from = range.from
  const to = range.to
  if (range.empty) {
    const pos = range.head
    const template = '![alt](image.png)'
    if (pos >= template.length && state.doc.sliceString(pos - template.length, pos) === template) {
      return {
        changes: { from: pos - template.length, to: pos, insert: '' },
        selection: { anchor: pos - template.length },
      }
    }
    const t = linkImageToggleOff(state, true)
    if (t !== null) return t
    const insert = template
    return { changes: { from: pos, to: pos, insert }, selection: { anchor: pos + 2, head: pos + 5 } }
  }
  const t = linkImageToggleOff(state, true)
  if (t !== null) return t
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
  if (/\s*\{#custom-id\}$/.test(line.text)) {
    const stripped = line.text.replace(/\s*\{#custom-id\}$/, '')
    return {
      changes: { from: line.from, to: line.to, insert: stripped },
      selection: { anchor: line.from + stripped.length },
    }
  }
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
// Dropdown
// ---------------------------------------------------------------------------

/**
 * Insert a dropdown block `>>> Title\n\n>>>` with the title selected.
 * If the selection is inside an existing dropdown block (lines starting with `>>>`),
 * remove the dropdown markers instead.
 */
export function insertDropdownSpec(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const pos = range.head

  // Check if we're inside an existing dropdown block
  const line = state.doc.lineAt(pos)
  const lineText = line.text.trim()

  // Look for opening >>>
  if (/^>>>/.test(lineText)) {
    // Find the matching closing >>>
    let openLine = line.number
    let closeLine = -1
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const l = state.doc.line(i)
      if (/^>>>/.test(l.text.trim())) {
        closeLine = i
        break
      }
    }

    if (closeLine !== -1) {
      // Remove the entire dropdown block
      const openLineObj = state.doc.line(openLine)
      const closeLineObj = state.doc.line(closeLine)
      const from = openLineObj.from
      const to = closeLineObj.to
      return {
        changes: { from, to, insert: '' },
        selection: { anchor: from },
      }
    }
  }

  // Check if we're inside a dropdown block (between >>> markers)
  let openLineNum = -1
  for (let i = line.number; i >= 1; i--) {
    const l = state.doc.line(i)
    if (/^>>>/.test(l.text.trim())) {
      openLineNum = i
      break
    }
    if (l.text.trim() !== '' && !/^>/.test(l.text.trim())) {
      break
    }
  }

  if (openLineNum !== -1) {
    // Find closing >>>
    for (let i = openLineNum + 1; i <= state.doc.lines; i++) {
      const l = state.doc.line(i)
      if (/^>>>/.test(l.text.trim())) {
        // Remove the entire dropdown block
        const openLineObj = state.doc.line(openLineNum)
        const closeLineObj = state.doc.line(i)
        const from = openLineObj.from
        const to = closeLineObj.to
        return {
          changes: { from, to, insert: '' },
          selection: { anchor: from },
        }
      }
    }
  }

  // Insert new dropdown block
  const insert = '>>> Title\n\n>>>'
  const caret = pos + '>>> '.length
  return { changes: { from: pos, to: pos, insert }, selection: { anchor: caret, head: caret + 5 } }
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

function blockquoteInfo(text: string): { indent: string; marker: string } | null {
  const m = /^(\s*)(> ?)/.exec(text)
  if (!m) return null
  return { indent: m[1], marker: m[2] }
}

function listItemInfo(text: string): ListItemInfo | null {
  // Task must be checked first so "- [] item" is not mis-classified as unordered "- ".
  // Regex matches all four spellings: "-[] ", "- [] ", "-[ ] ", "- [ ] " (also "*" and "+").
  // \s* after the closing bracket captures the trailing space(s) so marker length
  // includes them and content slicing is correct. The includes('[') && includes(']')
  // guard ensures "- " alone is not treated as task.
  let m = /^(\s*)([-*+]\s*\[[ xX]?\]\s*)/.exec(text)
  if (m && m[2].includes('[') && m[2].includes(']')) return { indent: m[1], marker: m[2], kind: 'task' }
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
 * a newline + the same marker (task keeps its own marker form — `-[]`, `- [ ]` etc. —
 * per user-results #4; ordered continues the sequence number) and put the caret after
 * the marker.
 */
export function continueListSpec(state: EditorState): TransactionSpec | null {
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)
  const info = listItemInfo(line.text)
  if (info) {
    // Marker length includes the trailing space(s) after "]" / "." / "-".
    // Content is everything after indent+marker; trim check handles empty item
    // (second Enter exits list) for all four task spellings.
    const content = line.text.slice(info.indent.length + info.marker.length)
    if (content.trim() === '') {
      return { changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } }
    }
    let nextMarker = info.marker
    if (info.kind === 'ordered' && info.number !== undefined) nextMarker = `${info.number + 1}. `
    // Task: preserve the exact original form ("-[] ", "- [] ", "-[ ] ", "- [ ] ").
    // info.marker already includes the trailing space(s); if the original line
    // somehow had no trailing space (e.g. "- []" at EOL without content, though
    // continuation only runs when content is non-empty so this is rare), ensure
    // the inserted marker ends with a space so it remains a valid task marker.
    if (info.kind === 'task' && !/\s$/.test(nextMarker)) nextMarker += ' '
    const insert = '\n' + info.indent + nextMarker
    return { changes: { from: line.to, to: line.to, insert }, selection: { anchor: line.to + insert.length } }
  }
  const defMatch = /^(\s*)(:\s*)/.exec(line.text)
  if (defMatch) {
    const indent = defMatch[1]
    const marker = defMatch[2]
    const content = line.text.slice(indent.length + marker.length)
    if (content.trim() === '') {
      return { changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } }
    }
    const insert = '\n' + indent + ': '
    return { changes: { from: line.to, to: line.to, insert }, selection: { anchor: line.to + insert.length } }
  }
  const bq = blockquoteInfo(line.text)
  if (bq) {
    const content = line.text.slice(bq.indent.length + bq.marker.length)
    if (content.trim() === '') {
      return { changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } }
    }
    const insert = '\n' + bq.indent + '> '
    return { changes: { from: line.to, to: line.to, insert }, selection: { anchor: line.to + insert.length } }
  }
  // If the line has no blockquote marker but is still inside a blockquote
  // node in the syntax tree (CommonMark lazy continuation), insert a plain
  // newline. This prevents lang-markdown's insertNewlineContinueMarkup from
  // re-adding "> " after the user explicitly exited the blockquote.
  if (line.text.trim() !== '') {
    const node = syntaxTree(state).resolveInner(range.head, -1)
    for (let n: SyntaxNode | null = node; n; n = n.parent) {
      if (n.name === 'Blockquote') {
        const insert = '\n'
        return { changes: { from: line.to, to: line.to, insert }, selection: { anchor: line.to + insert.length } }
      }
    }
  }
  if (line.text.trim() === '') {
    const insert = '\n'
    return { changes: { from: line.to, to: line.to, insert }, selection: { anchor: line.to + insert.length } }
  }
  return null
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
  spoiler: toggleSpoilerSpec,
  dropdown: insertDropdownSpec,
}
