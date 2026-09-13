// @vitest-environment jsdom
// Packet D — nested-table rendering pipeline: pipe-aware row splitting,
// nested <table> preservation in HTML, flatten-to-text in RTF/DOCX, and the
// stripNestedTableHtml unit contract (+ nested-table CSS presence).
// DOMPurify needs a window, hence the jsdom environment.
import { describe, it, expect } from 'vitest'
import {
  renderMarkdown,
  markdownToRtf,
  markdownToDocxBytes,
  stripNestedTableHtml,
  MARKDOWN_BODY_CSS,
} from '../src/app/export'

/** Decode raw zip bytes as latin1 so ASCII spans (names + XML) survive. */
function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
}

/** Collapse whitespace so HTML-layout differences can't fail assertions. */
function flat(html: string): string {
  return html.replace(/\s+/g, '')
}

describe('nested tables — HTML render path (Packet D)', () => {
  it('renders a single-line inner <table> inside an outer GFM <td>', () => {
    const html = renderMarkdown(
      '| a | b |\n| --- | --- |\n| <table><tr><td>x</td><td>y</td></tr></table> | 2 |',
    )
    const tables = html.match(/<table>/g) ?? []
    expect(tables.length).toBeGreaterThanOrEqual(2)
    expect(flat(html)).toContain('<td>x</td>')
  })

  it('passes a full-HTML outer table (with nested table) through', () => {
    const html = renderMarkdown(
      '<table><tr><td>a</td><td><table><tr><td>nested</td></tr></table></td></tr></table>',
    )
    const tables = html.match(/<table>/g) ?? []
    expect(tables.length).toBeGreaterThanOrEqual(2)
    expect(flat(html)).toContain('nested')
  })

  it('ships nested-table CSS in the shared stylesheet', () => {
    expect(MARKDOWN_BODY_CSS).toContain('.md-body table table')
  })
})

describe('nested tables — pipe-aware splitting (Packet D)', () => {
  it('keeps a code-span pipe inside one cell', () => {
    const rtf = markdownToRtf('| `a|b` | c |\n| --- | --- |\n| 1 | 2 |')
    // Aware: header cells are [`a|b`, c]; naive would split into three cells
    // (`a | b`) and the `a|b` substring would never appear.
    expect(rtf).toContain('a|b')
  })

  it('keeps an HTML-attribute pipe inside one cell', () => {
    const rtf = markdownToRtf('| <a href="x|y">t</a> | c |\n| --- | --- |\n| 1 | 2 |')
    // Aware: the `<a …>` tag span protects the pipe, then the flatten step
    // reduces the cell to its text `t`; naive leaves `<a href="x` literal.
    expect(rtf).not.toContain('href')
    expect(rtf).toContain('t | c')
  })
})

describe('nested tables — converter flattening (Packet D)', () => {
  const nested = '| a | b |\n| --- | --- |\n| <table><tr><td>x</td><td>y</td></tr></table> | 2 |'

  it('RTF flattens nested tables to ` / ` text with no raw tags', () => {
    const rtf = markdownToRtf(nested)
    expect(rtf).toContain('x / y')
    expect(rtf).not.toContain('<table>')
  })

  it('DOCX flattens nested tables to ` / ` text with no raw tags', () => {
    const text = latin1(markdownToDocxBytes(nested))
    expect(text).toContain('x / y')
    expect(text).not.toContain('<table>')
  })
})

describe('stripNestedTableHtml (Packet D)', () => {
  it('passes non-HTML cells through byte-identical', () => {
    expect(stripNestedTableHtml('plain **bold**')).toBe('plain **bold**')
    expect(stripNestedTableHtml('a|b')).toBe('a|b')
  })

  it('maps <br> to a space and row/cell closers to ` / `', () => {
    expect(stripNestedTableHtml('a<br>b')).toBe('a b')
    expect(stripNestedTableHtml('<table><tr><td>x</td><td>y</td></tr><tr><td>z</td></tr></table>')).toBe(
      'x / y / z',
    )
  })

  it('keeps in-cell pipes and legit leading slashes', () => {
    expect(stripNestedTableHtml('<td>a|b</td>')).toBe('a|b')
    expect(stripNestedTableHtml('/usr/bin <b>x</b>')).toBe('/usr/bin x')
  })
})
