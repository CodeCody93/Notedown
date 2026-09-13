// @vitest-environment jsdom
// Regression guard: findHtmlTableRangesInText must depth-pair <table> tags so
// a nested table never truncates its outer range (non-greedy matching ended
// at the INNER </table>, leaking the outer tail as raw text in live preview).
import { describe, it, expect } from 'vitest'
import { findHtmlTableRangesInText } from '../src/editor/livePreview'

describe('findHtmlTableRangesInText — depth pairing', () => {
  it('covers a nested table in ONE range ending at the OUTER close', () => {
    const inner = '<table><tr><td>n</td></tr></table>'
    const src = `<table><tr><td>a</td><td>${inner}</td></tr></table>`
    const ranges = findHtmlTableRangesInText(src)
    expect(ranges).toHaveLength(1)
    expect(src.slice(ranges[0].from, ranges[0].to)).toBe(src)
  })

  it('returns two ranges for sibling tables', () => {
    const a = '<table><tr><td>a</td></tr></table>'
    const b = '<table><tr><td>b</td></tr></table>'
    const src = `${a}\n\n${b}`
    const ranges = findHtmlTableRangesInText(src)
    expect(ranges).toHaveLength(2)
    expect(src.slice(ranges[0].from, ranges[0].to)).toBe(a)
    expect(src.slice(ranges[1].from, ranges[1].to)).toBe(b)
  })

  it('skips tables inside fenced code without corrupting later pairing', () => {
    const src = ['```', '<table><tr><td>x</td></tr></table>', '```', '', '<table><tr><td>y</td></tr></table>'].join('\n')
    const ranges = findHtmlTableRangesInText(src)
    expect(ranges).toHaveLength(1)
    expect(src.slice(ranges[0].from, ranges[0].to)).toContain('y')
  })

  it('ignores unclosed tables and stray closers', () => {
    expect(findHtmlTableRangesInText('<table><tr><td>oops')).toHaveLength(0)
    expect(findHtmlTableRangesInText('text </table> more')).toHaveLength(0)
  })

  it('matches case-insensitively across lines', () => {
    const src = '<TABLE>\n<tr><td>z</td></tr>\n</TABLE>'
    const ranges = findHtmlTableRangesInText(src)
    expect(ranges).toHaveLength(1)
    expect(src.slice(ranges[0].from, ranges[0].to)).toBe(src)
  })
})
