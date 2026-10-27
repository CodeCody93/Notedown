/**
 * Unit tests for the shared list-marker helpers (src/app/lists.ts).
 * Pure node environment: parsing, label formatting, sequence continuation and
 * the depth tracker used by live preview + literal-prefix exporters.
 */
import { describe, expect, it } from 'vitest'
import {
  ListDepthTracker,
  cycleOrderedStyle,
  formatOrderedLabel,
  formatOrderedMarker,
  nextOrderedMarker,
  parseListItem,
  romanToNumber,
} from '../src/app/lists'

describe('parseListItem', () => {
  it('parses unordered and task markers', () => {
    expect(parseListItem('- item')).toMatchObject({ kind: 'unordered', indent: '', marker: '- ' })
    expect(parseListItem('   * item')).toMatchObject({ kind: 'unordered', indent: '   ', marker: '* ' })
    expect(parseListItem('- [ ] todo')).toMatchObject({
      kind: 'task',
      checked: false,
      bracketOffset: 2,
      bracketLength: 3,
    })
    expect(parseListItem('* [x] done')).toMatchObject({ kind: 'task', checked: true, bracketLength: 3 })
    expect(parseListItem('-[]glued')).toMatchObject({ kind: 'task', checked: false, bracketLength: 2 })
  })

  it('parses decimal markers with . or ) delimiters', () => {
    expect(parseListItem('1. one')).toMatchObject({ kind: 'ordered', style: 'decimal', value: 1, delimiter: '.' })
    expect(parseListItem('12) twelve')).toMatchObject({ kind: 'ordered', style: 'decimal', value: 12, delimiter: ')' })
  })

  it('classifies single letters as alphabetical (except i/I)', () => {
    expect(parseListItem('a. one')).toMatchObject({ kind: 'ordered', style: 'alpha', value: 1, markerCase: 'lower' })
    expect(parseListItem('C. three')).toMatchObject({ kind: 'ordered', style: 'alpha', value: 3, markerCase: 'upper' })
    expect(parseListItem('x. letter')).toMatchObject({ style: 'alpha', value: 24 })
    expect(parseListItem('i. roman')).toMatchObject({ style: 'roman', value: 1 })
    expect(parseListItem('I. roman')).toMatchObject({ style: 'roman', value: 1, markerCase: 'upper' })
  })

  it('parses multi-letter Roman markers case-insensitively', () => {
    expect(parseListItem('ii. two')).toMatchObject({ style: 'roman', value: 2 })
    expect(parseListItem('iv) four')).toMatchObject({ style: 'roman', value: 4, delimiter: ')' })
    expect(parseListItem('XIV. fourteen')).toMatchObject({ style: 'roman', value: 14, markerCase: 'upper' })
  })

  it('returns null for prose and non-list lines', () => {
    expect(parseListItem('hello')).toBeNull()
    expect(parseListItem('# heading')).toBeNull()
    expect(parseListItem('-no-space')).toBeNull()
    // Words made only of Roman letters are not canonical numerals.
    expect(parseListItem('civil. rights')).toBeNull()
    expect(parseListItem('dim. lighting')).toBeNull()
    expect(parseListItem('mix. audio')).toBeNull()
    expect(parseListItem('iiii. clocks')).toBeNull()
  })
})

describe('ordered label formatting', () => {
  it('formats alphabetical labels including the aa+ rollover', () => {
    expect(formatOrderedLabel('alpha', 1)).toBe('a')
    expect(formatOrderedLabel('alpha', 26)).toBe('z')
    expect(formatOrderedLabel('alpha', 27)).toBe('aa')
    expect(formatOrderedLabel('alpha', 28, 'upper')).toBe('AB')
  })

  it('formats Roman labels in both cases', () => {
    expect(formatOrderedLabel('roman', 4)).toBe('iv')
    expect(formatOrderedLabel('roman', 9)).toBe('ix')
    expect(formatOrderedLabel('roman', 49, 'upper')).toBe('XLIX')
    expect(romanToNumber('MCMXCIV')).toBe(1994)
  })

  it('formats complete markers with delimiters and trailing spaces', () => {
    expect(formatOrderedMarker('decimal', 2)).toBe('2. ')
    expect(formatOrderedMarker('alpha', 3, ')')).toBe('c) ')
    expect(formatOrderedMarker('roman', 8, '.', 'upper')).toBe('VIII. ')
  })

  it('advances markers preserving style, case, delimiter and indent', () => {
    expect(nextOrderedMarker(parseListItem('1. x')!)).toBe('2. ')
    expect(nextOrderedMarker(parseListItem('a. x')!)).toBe('b. ')
    expect(nextOrderedMarker(parseListItem('z. x')!)).toBe('aa. ')
    expect(nextOrderedMarker(parseListItem('i. x')!)).toBe('ii. ')
    expect(nextOrderedMarker(parseListItem('IV) x')!)).toBe('V) ')
    expect(nextOrderedMarker(parseListItem('   a. x')!)).toBe('   b. ')
  })

  it('cycles decimal → alpha → roman', () => {
    expect(cycleOrderedStyle('decimal', 0)).toBe('decimal')
    expect(cycleOrderedStyle('decimal', 1)).toBe('alpha')
    expect(cycleOrderedStyle('decimal', 2)).toBe('roman')
    expect(cycleOrderedStyle('decimal', 3)).toBe('decimal')
    expect(cycleOrderedStyle('alpha', 1)).toBe('roman')
    expect(cycleOrderedStyle('roman', 1)).toBe('decimal')
    expect(cycleOrderedStyle('roman', -1)).toBe('alpha')
  })
})

/** Feeds lines (blank = '', non-list = 'text') through a fresh tracker. */
function walk(lines: string[]): Array<ReturnType<ListDepthTracker['feed']> | null> {
  const tracker = new ListDepthTracker()
  const out: Array<ReturnType<ListDepthTracker['feed']> | null> = []
  for (const line of lines) {
    if (line === '') {
      tracker.noteBlank()
      out.push(null)
      continue
    }
    const info = parseListItem(line)
    if (info === null) {
      tracker.noteNonList((/^[ \t]*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length)
      out.push(null)
      continue
    }
    out.push(tracker.feed(info))
  }
  return out
}

describe('ListDepthTracker', () => {
  it('switches ordered styles by nesting depth (1., a., i.)', () => {
    const out = walk(['1. one', '   1. sub', '      1. deep', '   2. sub2', '2. two'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['1', 'a', 'i', 'b', '2'])
    expect(out.map((r) => r?.depth)).toEqual([1, 2, 3, 2, 1])
    expect(out.map((r) => r?.orderedStyle)).toEqual(['decimal', 'alpha', 'roman', 'alpha', 'decimal'])
  })

  it('explicit alphabetical start propagates to deeper numeric levels', () => {
    const out = walk(['a. one', '   1. sub', 'b. two'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['a', 'i', 'b'])
  })

  it('explicit Roman start propagates the cycle to deeper numeric levels', () => {
    const out = walk(['i. one', '   1. sub', 'ii. two'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['i', '1', 'ii'])
  })

  it('cycles deeper levels from the enclosing list even when markers are typed explicitly', () => {
    // The indented `i.` is what Enter+Tab produces from an alpha parent; it
    // must still render with the depth cycle (alpha at depth 2 here).
    const out = walk(['1. one', '   i. sub', '   2. sub2', '      a. deep'])
    expect(out.map((r) => r?.orderedStyle ?? null)).toEqual(['decimal', 'alpha', 'alpha', 'roman'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['1', 'a', 'b', 'i'])
  })

  it('restarts nested numbering at 1 when an indented continuation item starts the sub-list', () => {
    const out = walk(['1. one', '   2. sub', '2. two'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['1', 'a', '2'])
  })

  it('restarts alpha sub-lists at i even when the indented marker was b.', () => {
    const out = walk(['a. one', '   b. sub', 'b. two'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['a', 'i', 'b'])
  })

  it('tracks unordered depth for alternating bullets', () => {
    const out = walk(['- one', '  - two', '    - three', '  - two again'])
    expect(out.map((r) => r?.depth)).toEqual([1, 2, 3, 2])
  })

  it('keeps loose-list numbering across blank lines and restarts a new 1. list', () => {
    const out = walk(['1. one', '', '2. two', '', '1. new', '2. new two'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['1', null, '2', null, '1', '2'])
  })

  it('non-list lines reset the context', () => {
    const out = walk(['1. one', 'para', '1. new'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['1', null, '1'])
  })

  it('indented continuation text keeps the context for a following nested list', () => {
    const out = walk(['1. one', '   continuation', '   1. sub', '2. two'])
    expect(out.map((r) => r?.orderedLabel ?? null)).toEqual(['1', null, 'a', '2'])
    expect(out.map((r) => r?.depth ?? null)).toEqual([1, null, 2, 1])
  })
})
