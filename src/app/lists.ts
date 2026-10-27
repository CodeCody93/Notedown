/**
 * Shared list-marker helpers (round-11 list indicators).
 *
 * Notedown's Markdown dialect extends ordered-list markers beyond CommonMark's
 * digits: `a.` / `A.` start an alphabetical list and `i.` / `I.` (or ii, iii,
 * iv, …) start a Roman-numeral list. This module is the single source of truth
 * for:
 *
 *  - parsing a line-leading list marker (`parseListItem`),
 *  - formatting ordered labels in any of the three styles,
 *  - advancing a marker on Enter (`nextOrderedMarker`),
 *  - cycling indicator styles by nesting depth (`cycleOrderedStyle`), and
 *  - the per-document depth tracker shared by the live-preview marker widget
 *    and the RTF/DOCX/PDF block exporters (`ListDepthTracker`).
 *
 * Pure module: no DOM, no CodeMirror, no markdown-it imports.
 */

export type OrderedStyle = 'decimal' | 'alpha' | 'roman'

/** Letter case of an alpha/roman marker (`a` → lower, `A` → upper). */
export type OrderedCase = 'lower' | 'upper'

export type ListMarkerKind = 'unordered' | 'ordered' | 'task'

/** Indicator cycle order used for nesting depth: numbered → alphabetical → Roman. */
export const ORDERED_CYCLE: readonly OrderedStyle[] = ['decimal', 'alpha', 'roman']

/** Parsed line-leading list marker. */
export interface ParsedListMarker {
  /** Leading whitespace before the marker (kept verbatim). */
  indent: string
  /** Exact marker text including trailing whitespace, e.g. `- `, `a. `, `1) `, `- [ ] `. */
  marker: string
  kind: ListMarkerKind
  /** Ordered style (ordered markers only). */
  style?: OrderedStyle
  /** Numeric value: decimal number, alphabetical position (a=1), or Roman value. */
  value?: number
  /** Letter case for alpha/roman markers. */
  markerCase?: OrderedCase
  /** Ordered-list delimiter (`.` or `)`). */
  delimiter?: '.' | ')'
  /** Task checkbox state (`true` = `[x]`, `false` = `[ ]`). */
  checked?: boolean
  /** Offset of the `[` bracket inside `marker` (task markers only). */
  bracketOffset?: number
  /** Length of the `[…]` bracket (2 for `[]`, 3 for `[ ]` / `[x]`). */
  bracketLength?: number
}

/** Result of feeding one list line through {@link ListDepthTracker}. */
export interface ListLineResult {
  /** 1-based nesting depth (all list types count). */
  depth: number
  /** Ordered label in its display style (`a`, `iv`, `12`), no delimiter. */
  orderedLabel?: string
  /** Display style chosen for this ordered item. */
  orderedStyle?: OrderedStyle
  /** Display case for alpha/roman styles. */
  orderedCase?: OrderedCase
  /** Numeric value backing {@link orderedLabel}. */
  orderedValue?: number
}

const ROMAN_VALUES: Readonly<Record<string, number>> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
}

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

const TASK_RE = /^(\s*)([-*+•]\s*\[([ xX]?)\]\s*)/
const BULLET_RE = /^(\s*)([-*+•]\s+)/
const ORDERED_RE = /^(\s*)((\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)([.)])([ \t]+))/

/**
 * Parse a line-leading list marker. Returns `null` when the line is not a list
 * item. Task markers are matched before bullets so `- [ ] item` is a task, and
 * bullets are matched before ordered markers so `- item` is never an ordered
 * marker.
 */
export function parseListItem(text: string): ParsedListMarker | null {
  const task = TASK_RE.exec(text)
  if (task !== null) {
    const marker = task[2]
    return {
      indent: task[1],
      marker,
      kind: 'task',
      checked: /[xX]/.test(task[3]),
      bracketOffset: marker.indexOf('['),
      // `[]` is two chars; `[ ]` / `[x]` are three.
      bracketLength: (task[3] ?? '') === '' ? 2 : 3,
    }
  }

  const bullet = BULLET_RE.exec(text)
  if (bullet !== null) return { indent: bullet[1], marker: bullet[2], kind: 'unordered' }

  const ordered = ORDERED_RE.exec(text)
  if (ordered === null) return null
  const token = ordered[3]
  const delimiter = ordered[4] as '.' | ')'
  let style: OrderedStyle
  let value: number
  if (/^\d+$/.test(token)) {
    style = 'decimal'
    value = parseInt(token, 10)
  } else if (token.length === 1) {
    // `i` is the canonical Roman start; every other single letter is an
    // alphabetical marker (so c/d/m/v/x/l start alpha lists, not Roman ones).
    if (token.toLowerCase() === 'i') {
      style = 'roman'
      value = 1
    } else {
      style = 'alpha'
      value = token.toLowerCase().charCodeAt(0) - 96
    }
  } else {
    style = 'roman'
    value = romanToNumber(token)
    // Only canonical numerals up to 100 count as multi-letter Roman markers.
    // Without this check prose words made solely of i/v/x/l/c/d/m (civil.,
    // dim., mix. = 1009) would be misread as ordered-list starts; larger
    // numerals are produced by continuation, not typed as a list's first item.
    if (value <= 0 || value > 100 || numberToRoman(value) !== token.toLowerCase()) return null
  }
  const markerCase: OrderedCase =
    token === token.toLowerCase() ? 'lower' : token === token.toUpperCase() ? 'upper' : token[0] === token[0].toUpperCase() ? 'upper' : 'lower'
  return { indent: ordered[1], marker: ordered[2], kind: 'ordered', style, value, markerCase, delimiter }
}

/** Convert a Roman numeral (any case) to its integer value; 0 when invalid. */
export function romanToNumber(roman: string): number {
  let total = 0
  let prev = 0
  const s = roman.toLowerCase()
  for (let i = s.length - 1; i >= 0; i--) {
    const v = ROMAN_VALUES[s[i]]
    if (v === undefined) return 0
    if (v < prev) total -= v
    else {
      total += v
      prev = v
    }
  }
  return total
}

/** Convert an integer to a lowercase Roman numeral (values below 1 clamp to 1). */
export function numberToRoman(value: number): string {
  let n = Math.max(1, Math.floor(value))
  let out = ''
  for (const [unit, symbol] of ROMAN_TABLE) {
    while (n >= unit) {
      out += symbol
      n -= unit
    }
  }
  return out
}

/** Convert a 1-based integer to an alphabetical label (`1 → a`, `27 → aa`). */
export function numberToAlpha(value: number): string {
  let n = Math.max(1, Math.floor(value))
  let out = ''
  while (n > 0) {
    n -= 1
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return out
}

/** Format an ordered label in the given style/case (no delimiter). */
export function formatOrderedLabel(style: OrderedStyle, value: number, markerCase: OrderedCase = 'lower'): string {
  let label: string
  if (style === 'alpha') label = numberToAlpha(value)
  else if (style === 'roman') label = numberToRoman(value)
  else label = String(Math.floor(value))
  return markerCase === 'upper' ? label.toUpperCase() : label
}

/** Format a complete ordered marker including delimiter + one trailing space. */
export function formatOrderedMarker(
  style: OrderedStyle,
  value: number,
  delimiter: '.' | ')' = '.',
  markerCase: OrderedCase = 'lower',
): string {
  return `${formatOrderedLabel(style, value, markerCase)}${delimiter} `
}

/**
 * Next marker for Enter-in-list continuation. Preserves the source style, case,
 * delimiter and indentation; decimal/alpha/roman sequences all advance.
 */
export function nextOrderedMarker(info: ParsedListMarker): string {
  if (info.style === undefined || info.value === undefined) return info.indent + info.marker
  return (
    info.indent +
    formatOrderedMarker(info.style, info.value + 1, info.delimiter ?? '.', info.markerCase ?? 'lower')
  )
}

/** Move `offset` steps around the numbered → alphabetical → Roman cycle. */
export function cycleOrderedStyle(start: OrderedStyle, offset: number): OrderedStyle {
  const index = ORDERED_CYCLE.indexOf(start)
  const base = index < 0 ? 0 : index
  return ORDERED_CYCLE[(((base + offset) % ORDERED_CYCLE.length) + ORDERED_CYCLE.length) % ORDERED_CYCLE.length]
}

interface TrackerContext {
  indent: number
  kind: 'ul' | 'ol'
  depth: number
  style?: OrderedStyle
  markerCase?: OrderedCase
  delimiter?: '.' | ')'
  /** First item's value (explicit at the top level, 1 for nested lists). */
  startValue: number
  nextValue: number
}

function indentWidth(indent: string): number {
  return indent.replace(/\t/g, '    ').length
}

/**
 * Line-by-line nesting tracker used by the live-preview marker widgets and the
 * literal-prefix exporters (RTF/DOCX/PDF). Call {@link feed} for list lines,
 * {@link noteBlank} for blank lines and {@link noteNonList} for any other
 * non-list line (which ends the current list context).
 *
 * Indicator styles follow the numbered → alphabetical → Roman cycle with
 * nesting depth. An explicit alphabetical/Roman marker chooses the start style
 * for a top-level ordered list (so `a.` makes level 1 alphabetical); nested
 * levels continue the cycle from the nearest enclosing ordered level, and each
 * nested list restarts its own sequence at 1/a/i.
 */
export class ListDepthTracker {
  private contexts: TrackerContext[] = []
  private afterBlank = false

  /** Forget all list context (e.g. after a code block or a document reset). */
  reset(): void {
    this.contexts = []
    this.afterBlank = false
  }

  /** Record a blank line: loose lists keep their context, new lists may start. */
  noteBlank(): void {
    this.afterBlank = true
  }

  /**
   * Record a non-list, non-blank line. Lines indented deeper than the current
   * list item are its continuation text and keep the context; anything at or
   * above the item's indentation ends the list.
   */
  noteNonList(indent = 0): void {
    const top = this.contexts[this.contexts.length - 1]
    if (top === undefined) {
      this.reset()
      return
    }
    if (indent > top.indent) {
      // Continuation text or another block inside the current list item.
      this.afterBlank = false
      return
    }
    // A shallower non-list line ends inner levels. Keep any outer list item
    // that still strictly contains this indentation.
    while (this.contexts.length > 0 && indent <= this.contexts[this.contexts.length - 1].indent) {
      this.contexts.pop()
    }
    if (this.contexts.length > 0) this.afterBlank = false
    else this.reset()
  }

  /** Feed one parsed list line and return its depth + (for ordered) label. */
  feed(info: ParsedListMarker): ListLineResult {
    const indent = indentWidth(info.indent)
    const kind: 'ul' | 'ol' = info.kind === 'ordered' ? 'ol' : 'ul'
    const delimiter = info.delimiter ?? '.'

    if (this.afterBlank) {
      const baseIndent = this.contexts.length > 0 ? this.contexts[0].indent : Number.POSITIVE_INFINITY
      // A marker value of 1 (1./a./i.) at the list's own top level after a
      // blank line starts a NEW list; a loose list continuing at 2./b./ii.
      // keeps the existing context (and numbering).
      if (kind === 'ol' && info.value === 1 && indent <= baseIndent) this.contexts = []
    }
    this.afterBlank = false

    while (this.contexts.length > 0 && indent < this.contexts[this.contexts.length - 1].indent) {
      this.contexts.pop()
    }

    let context = this.contexts[this.contexts.length - 1]
    let isNew = false
    if (context === undefined || indent > context.indent) {
      context = this.makeContext(info, kind, delimiter, this.contexts.length + 1)
      this.contexts.push(context)
      isNew = true
    } else if (context.kind !== kind || (kind === 'ol' && context.delimiter !== delimiter)) {
      // Same indentation but a different list kind/delimiter — a new list.
      context = this.makeContext(info, kind, delimiter, this.contexts.length)
      this.contexts[this.contexts.length - 1] = context
      isNew = true
    }

    const depth = this.contexts.length
    if (kind !== 'ol') return { depth }

    const value = isNew ? context.startValue : context.nextValue
    context.nextValue = value + 1
    return {
      depth,
      orderedLabel: formatOrderedLabel(context.style as OrderedStyle, value, context.markerCase),
      orderedStyle: context.style,
      orderedCase: context.markerCase,
      orderedValue: value,
    }
  }

  private makeContext(
    info: ParsedListMarker,
    kind: 'ul' | 'ol',
    delimiter: '.' | ')',
    depth: number,
  ): TrackerContext {
    if (kind === 'ul') {
      return { indent: indentWidth(info.indent), kind, depth, startValue: 1, nextValue: 1 }
    }

    const explicit = info.style ?? 'decimal'
    // Deeper ordered levels ALWAYS follow the numbered → alpha → roman cycle
    // from the nearest enclosing ordered level. That keeps Enter+Tab nested
    // items switching even though continuation inherited the parent's marker
    // style (e.g. an alpha list's indented `b.` sub-item renders as Roman `i.`).
    // An explicit alpha/Roman marker only chooses the starting style for a new
    // top-level ordered list.
    let ancestor: TrackerContext | undefined
    for (let i = this.contexts.length - 1; i >= 0; i--) {
      if (this.contexts[i].kind === 'ol') {
        ancestor = this.contexts[i]
        break
      }
    }
    let style: OrderedStyle
    if (ancestor !== undefined && ancestor.style !== undefined) {
      style = cycleOrderedStyle(ancestor.style, depth - ancestor.depth)
    } else if (explicit !== 'decimal') {
      style = explicit
    } else {
      style = cycleOrderedStyle('decimal', depth - 1)
    }
    // Nested lists start their own sequence at 1/a/i. Indenting a continued
    // item (Enter then Tab) must not carry the parent's b./2./ii. value into
    // the sub-list's first indicator.
    const startValue = depth > 1 ? 1 : (info.value ?? 1)
    return {
      indent: indentWidth(info.indent),
      kind,
      depth,
      style,
      markerCase: info.markerCase ?? 'lower',
      delimiter,
      startValue,
      nextValue: startValue + 1,
    }
  }
}
