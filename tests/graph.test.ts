// @vitest-environment jsdom
// Graphs — CSS-only pie/bar/line via %% tags (parser, HTML render through
// DOMPurify, error box, fence protection, import round-trip, text fallbacks).
// DOMPurify needs a window, hence the jsdom environment.
import { describe, it, expect } from 'vitest'
import { parseGraphTag, graphToTextFallback } from '../src/app/graph'
import { MARKDOWN_BODY_CSS, renderMarkdown } from '../src/app/export'

describe('graphs', () => {
  it('parses pie/bar/line', () => {
    expect(parseGraphTag('pie "T" (A, 30) (B, 70)').ok).toBe(true)
    expect(parseGraphTag('bar "X" "Y" min 0 max 250 (Jan, 120) (Feb, 200)').ok).toBe(true)
    expect(parseGraphTag('line (Mon, 3) (Tue, 7)').ok).toBe(true)
    expect(parseGraphTag('scatter (A, 1)').ok).toBe(false)
    expect(parseGraphTag('line (Only, 1)').ok).toBe(false)
  })
  it('renders figure HTML with CSS vars through DOMPurify', () => {
    const html = renderMarkdown('%% pie "T" (A, 30) (B, 70) %%')
    expect(html).toContain('md-graph')
    expect(html).toContain('conic-gradient')
    const bar = renderMarkdown('%% bar (Jan, 120) (Feb, 200) %%')
    expect(bar).toContain('--v:')
    expect(bar).toContain('data-label="Jan"')
    const line = renderMarkdown('%% line (Mon, 3) (Tue, 7) %%')
    expect(line).toContain('md-graph-seg')
    expect(line).toContain('--y1:')
  })
  it('renders inline error for unknown type', () => {
    expect(renderMarkdown('%% scatter (A, 1) %%')).toContain('md-graph-error')
  })
  it('leaves fenced code literal', () => {
    const html = renderMarkdown('```\n%% pie (A, 1) %%\n```')
    expect(html).not.toContain('md-graph')
  })
  it('text fallback works', () => {
    const p = parseGraphTag('bar (Jan, 120) (Feb, 200)')
    expect(p.ok).toBe(true)
    if (p.ok) expect(graphToTextFallback(p.spec)).toContain('Jan=120')
  })
  it('import round-trips figure via data-graph', async () => {
    const { convertToMarkdown } = await import('../src/app/import')
    const html = renderMarkdown('%% bar "Sales" (Jan, 120) (Feb, 200) %%')
    const res = await convertToMarkdown(html, 'html')
    expect(res.markdown).toContain('%%')
    expect(res.markdown).toContain('Jan')
  })
  it('rtf/docx/pdf flatten graphs to text', async () => {    const { markdownToRtf, markdownToDocxBytes } = await import('../src/app/export')
    const { markdownToPdfBytes } = await import('../src/app/export')
    const rtf = markdownToRtf('%% pie "T" (A, 30) (B, 70) %%\n')
    expect(rtf).toContain('A=30')
    expect(rtf).not.toContain('%%')
    const docx = await markdownToDocxBytes('%% bar (Jan, 120) %%\n')
    expect(docx.length).toBeGreaterThan(0)
    const pdf = await markdownToPdfBytes('%% line (Mon, 3) (Tue, 7) %%\n', 'g')
    expect(pdf[0]).toBe(0x25)
  })
  it('graph CSS never targets the figure card with element selectors', () => {    // The <figure> card carries .md-graph-{type} too, so bare .md-graph-pie /
    // .md-graph-bar selectors would restyle the whole card (aspect-ratio on
    // the card forced its height to its width, leaving an empty band).
    expect(MARKDOWN_BODY_CSS).toContain('.md-graph-chart > .md-graph-pie')
    expect(MARKDOWN_BODY_CSS).not.toMatch(/\.md-body \.md-graph-pie\s*\{/)
    expect(MARKDOWN_BODY_CSS).not.toMatch(/\.md-body \.md-graph-bar\s*\{/)
    expect(MARKDOWN_BODY_CSS).toContain('.md-graph > figcaption')
  })
  it('bar heights scale with values (true grid percentages)', () => {
    const html = renderMarkdown('%% bar (A, 10) (B, 20) %%')
    // Auto range is [min(0,…), max(…)] = [0, 20], so A renders at 50%.
    expect(html).toContain('--v:50.0%')
    expect(html).toContain('--v:100.0%')
    const explicit = renderMarkdown('%% bar min 0 max 500 (A, 120) %%')
    expect(explicit).toContain('--v:24.0%')
  })
  it('bars carry distinct per-bar colors and a min/max scale', () => {
    const html = renderMarkdown('%% bar (A, 10) (B, 20) (C, 30) %%')
    const colors = [...html.matchAll(/--c:(hsl\([^)]*\))/g)].map((m) => m[1])
    expect(colors.length).toBe(3)
    expect(new Set(colors).size).toBe(3)
    expect(html).toContain('data-min="0"')
    expect(html).toContain('data-max="30"')
  })
  it('bar y-label sits inside the chart and bars take no x-label', () => {
    const html = renderMarkdown('%% bar "T" Y (A, 1) (B, 2) %%')
    const plot = html.indexOf('md-graph-plot')
    expect(plot).toBeGreaterThan(-1)
    expect(html.indexOf('>Y<')).toBeGreaterThan(-1)
    expect(html.indexOf('>Y<')).toBeLessThan(plot)
    expect(html).not.toContain('md-graph-x')
  })
  it('bar tags accept at most 2 leading labels (title, y-label)', () => {
    const two = parseGraphTag('bar "Sales 2024" Units (A, 1)')
    expect(two.ok).toBe(true)
    if (two.ok) {
      expect(two.spec.title).toBe('Sales 2024')
      expect(two.spec.yLabel).toBe('Units')
      expect(two.spec.xLabel).toBe('')
    }
    expect(parseGraphTag('bar "T" X Y (A, 1)').ok).toBe(false)
    // Pie/line still take 3.
    expect(parseGraphTag('line "T" X Y (A, 1) (B, 2)').ok).toBe(true)
  })
  it('bar specToTag round-trips title + y without an x parameter', async () => {
    const { specToTag } = await import('../src/app/import')
    const tag = specToTag({
      type: 'bar',
      title: 'Sales 2024',
      xLabel: 'Dropped',
      yLabel: 'Units',
      points: [{ label: 'A', value: 1 }],
    })
    expect(tag).not.toContain('Dropped')
    const inner = tag.replace(/^%%\s*/, '').replace(/\s*%%$/, '')
    const back = parseGraphTag(inner)
    expect(back.ok).toBe(true)
    if (back.ok) {
      expect(back.spec.title).toBe('Sales 2024')
      expect(back.spec.yLabel).toBe('Units')
    }
    // y-only pads so it re-parses as y, not title.
    const yOnly = specToTag({ type: 'bar', title: '', xLabel: '', yLabel: 'U', points: [] })
    const yBack = parseGraphTag(yOnly.replace(/^%%\s*/, '').replace(/\s*%%$/, ''))
    // No points → parse error is fine; labels must still map to y.
    expect(yBack.ok).toBe(false)
    const yOk = parseGraphTag(`${yOnly.replace(/^%%\s*/, '').replace(/\s*%%$/, '')} (A, 1)`)
    expect(yOk.ok).toBe(true)
    if (yOk.ok) {
      expect(yOk.spec.title).toBe('')
      expect(yOk.spec.yLabel).toBe('U')
    }
  })
})
