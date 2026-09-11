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
  it('graph CSS never targets the figure card with element selectors', () => {
    // The <figure> card carries .md-graph-{type} too, so bare .md-graph-pie /
    // .md-graph-bar selectors would restyle the whole card (aspect-ratio on
    // the card forced its height to its width, leaving an empty band).
    expect(MARKDOWN_BODY_CSS).toContain('.md-graph-chart > .md-graph-pie')
    expect(MARKDOWN_BODY_CSS).not.toMatch(/\.md-body \.md-graph-pie\s*\{/)
    expect(MARKDOWN_BODY_CSS).not.toMatch(/\.md-body \.md-graph-bar\s*\{/)
    expect(MARKDOWN_BODY_CSS).toContain('figure.md-graph-pie > figcaption')
  })
})
