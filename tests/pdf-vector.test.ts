// @vitest-environment jsdom
// Packet B — vector-graphics analysis for PDF import (src/app/pdfVector.ts).
// Synthetic op-stream tests use REAL opcode numbers (imported from pdfjs-dist
// here in the TEST file only — src/ must never import pdfjs-dist), plus one
// export->pdfjs round-trip that doubles as the coordinate-space proof.
// jsdom is needed only because the round-trip imports ../src/app/export,
// which pulls in DOMPurify (same reason as tests/pdf-export.test.ts).
import { describe, expect, it } from 'vitest'
import { OPS } from 'pdfjs-dist'
import { analyzePdfVectors, classifyHorizontalRule } from '../src/app/pdfVector'
import type { PdfRect, PdfVectorAnalysis } from '../src/app/pdfVector'

const O = OPS as unknown as Record<string, number>

function op(name: string): number {
  const v = O[name]
  if (typeof v !== 'number') throw new Error(`missing OPS.${name}`)
  return v
}

interface Stream {
  fn: number[]
  args: unknown[]
}

function newStream(): Stream {
  return { fn: [], args: [] }
}

function push(s: Stream, name: string, arg: unknown = []): void {
  s.fn.push(op(name))
  s.args.push(arg)
}

function analyze(s: Stream): PdfVectorAnalysis {
  return analyzePdfVectors(s.fn, s.args, O)
}

/** Horizontal + vertical ruling lines through the given edges. */
function lineGrid(s: Stream, xs: number[], ys: number[], width: number): void {
  push(s, 'setLineWidth', [width])
  const x0 = xs[0] as number
  const x1 = xs[xs.length - 1] as number
  const y0 = ys[0] as number
  const y1 = ys[ys.length - 1] as number
  for (const y of ys) {
    push(s, 'moveTo', [x0, y])
    push(s, 'lineTo', [x1, y])
    push(s, 'stroke')
  }
  for (const x of xs) {
    push(s, 'moveTo', [x, y0])
    push(s, 'lineTo', [x, y1])
    push(s, 'stroke')
  }
}

/** Per-cell rectangles (mimics pdf-lib bordered table cells). */
function cellGrid(s: Stream, xs: number[], ys: number[], width: number): void {
  push(s, 'setLineWidth', [width])
  for (let r = 0; r + 1 < ys.length; r++) {
    for (let c = 0; c + 1 < xs.length; c++) {
      const x = xs[c] as number
      const y = ys[r] as number
      push(s, 'rectangle', [x, y, (xs[c + 1] as number) - x, (ys[r + 1] as number) - y])
      push(s, 'stroke')
    }
  }
}

function fillRect(s: Stream, x: number, y: number, w: number, h: number): void {
  push(s, 'rectangle', [x, y, w, h])
  push(s, 'fill')
}

describe('analyzePdfVectors — horizontal rules', () => {
  it('detects a single thin horizontal stroke as an underline rule', () => {
    const s = newStream()
    push(s, 'setLineWidth', [1])
    push(s, 'moveTo', [10, 100])
    push(s, 'lineTo', [60, 100])
    push(s, 'stroke')
    const a = analyze(s)
    expect(a.underlines.length).toBe(1)
    expect(a.underlines[0]?.x0).toBeCloseTo(10, 6)
    expect(a.underlines[0]?.x1).toBeCloseTo(60, 6)
    expect(((a.underlines[0]?.y0 as number) + (a.underlines[0]?.y1 as number)) / 2).toBeCloseTo(100, 6)
    expect(a.strikes).toEqual([])
    expect(a.tables).toEqual([])
  })

  it('ignores a vertical stroke as a rule', () => {
    const s = newStream()
    push(s, 'setLineWidth', [1])
    push(s, 'moveTo', [10, 10])
    push(s, 'lineTo', [10, 60])
    push(s, 'stroke')
    const a = analyze(s)
    expect(a.underlines).toEqual([])
    expect(a.tables).toEqual([])
  })

  it('ignores a thick rule (>2.5pt)', () => {
    const s = newStream()
    push(s, 'setLineWidth', [3.5])
    push(s, 'moveTo', [10, 100])
    push(s, 'lineTo', [80, 100])
    push(s, 'stroke')
    expect(analyze(s).underlines).toEqual([])
  })

  it('ignores a tiny dot', () => {
    const s = newStream()
    push(s, 'setLineWidth', [1])
    push(s, 'moveTo', [10, 100])
    push(s, 'lineTo', [12, 100])
    push(s, 'stroke')
    const a = analyze(s)
    expect(a.underlines).toEqual([])
    expect(a.tables).toEqual([])
    expect(a.highlights).toEqual([])
  })

  it('skips unknown opcodes and null args without crashing', () => {
    const s = newStream()
    s.fn.push(9999)
    s.args.push(null)
    push(s, 'setLineWidth', null)
    push(s, 'moveTo', [10, 100])
    push(s, 'lineTo', [60, 100])
    s.fn.push(op('stroke'))
    s.args.push(null)
    const a = analyze(s)
    expect(a.underlines.length).toBe(1)
  })
})

describe('analyzePdfVectors — constructPath (real pdfjs-v5 encoding)', () => {
  // DrawOPS codes pinned here (pdf.worker.mjs lines 332-338):
  // moveTo 0 (+x+y), lineTo 1 (+x+y), closePath 4.
  it('detects a stroked rule from a constructPath op', () => {
    const s = newStream()
    push(s, 'setLineWidth', [1])
    s.fn.push(op('constructPath'))
    s.args.push([op('stroke'), [new Float32Array([0, 10, 100, 1, 60, 100])], null])
    const a = analyze(s)
    expect(a.underlines.length).toBe(1)
    expect(a.underlines[0]?.x0).toBeCloseTo(10, 6)
    expect(a.underlines[0]?.x1).toBeCloseTo(60, 6)
  })

  it('detects a filled rect from a constructPath op', () => {
    const s = newStream()
    s.fn.push(op('constructPath'))
    s.args.push([op('fill'), [new Float32Array([0, 10, 10, 1, 30, 10, 1, 30, 25, 1, 10, 25, 4])], null])
    const a = analyze(s)
    expect(a.highlights.length).toBe(1)
    expect(a.highlights[0]).toEqual({ x0: 10, y0: 10, x1: 30, y1: 25 })
  })

  it('drops constructPath endPath (the `re W n` clip idiom carries no paint)', () => {
    const s = newStream()
    s.fn.push(op('constructPath'))
    s.args.push([op('endPath'), [new Float32Array([0, 10, 10, 1, 30, 10, 1, 30, 25, 1, 10, 25, 4])], null])
    const a = analyze(s)
    expect(a.highlights).toEqual([])
    expect(a.underlines).toEqual([])
  })
})

describe('analyzePdfVectors — CTM tracking', () => {
  it('maps path coords through save/transform/restore', () => {
    const s = newStream()
    push(s, 'save')
    push(s, 'transform', [2, 0, 0, 2, 5, 5])
    push(s, 'moveTo', [0, 0])
    push(s, 'lineTo', [10, 0])
    push(s, 'setLineWidth', [0.5])
    push(s, 'stroke')
    push(s, 'restore')
    const a = analyze(s)
    expect(a.underlines.length).toBe(1)
    expect(a.underlines[0]?.x0).toBeCloseTo(5, 6)
    expect(a.underlines[0]?.x1).toBeCloseTo(25, 6)
    expect(((a.underlines[0]?.y0 as number) + (a.underlines[0]?.y1 as number)) / 2).toBeCloseTo(5, 6)
  })

  it('tolerates an unbalanced restore', () => {
    const s = newStream()
    push(s, 'restore')
    push(s, 'moveTo', [0, 0])
    push(s, 'lineTo', [10, 0])
    push(s, 'stroke')
    expect(analyze(s).underlines.length).toBe(1)
  })
})

describe('analyzePdfVectors — tables', () => {
  it('detects a 2x2 ruling grid with correct cols/rows/edges', () => {
    const s = newStream()
    lineGrid(s, [0, 50, 100], [0, 30, 60], 0.75)
    const a = analyze(s)
    expect(a.tables.length).toBe(1)
    const t = a.tables[0]
    expect(t?.cols).toBe(2)
    expect(t?.rows).toBe(2)
    expect(t?.colEdges).toEqual([0, 50, 100])
    expect(t?.rowEdges).toEqual([0, 30, 60])
    expect(t?.x0).toBe(0)
    expect(t?.y0).toBe(0)
    expect(t?.x1).toBe(100)
    expect(t?.y1).toBe(60)
  })

  it('detects a grid from per-cell rects with duplicated shared borders', () => {
    const s = newStream()
    cellGrid(s, [0, 50, 100], [0, 30, 60], 0.75)
    const a = analyze(s)
    expect(a.tables.length).toBe(1)
    expect(a.tables[0]?.cols).toBe(2)
    expect(a.tables[0]?.rows).toBe(2)
  })

  it('excludes grid edges from underlines', () => {
    const s = newStream()
    lineGrid(s, [0, 50, 100], [0, 30, 60], 0.75)
    expect(analyze(s).underlines).toEqual([])
  })

  it('keeps a genuine rule far from the grid', () => {
    const s = newStream()
    lineGrid(s, [0, 50, 100], [0, 30, 60], 0.75)
    push(s, 'setLineWidth', [1])
    push(s, 'moveTo', [200, 200])
    push(s, 'lineTo', [260, 200])
    push(s, 'stroke')
    const a = analyze(s)
    expect(a.tables.length).toBe(1)
    expect(a.underlines.length).toBe(1)
  })

  it('rejects an incomplete grid (missing interior lines)', () => {
    const s = newStream()
    // Outer box only: no interior rulings -> 1 col / 1 row max.
    lineGrid(s, [0, 100], [0, 60], 0.75)
    expect(analyze(s).tables).toEqual([])
  })

  it('excludes in-cell fills from highlights but keeps a standalone fill', () => {
    const s = newStream()
    cellGrid(s, [0, 50, 100], [0, 30, 60], 0.75)
    // Highlight-sized fill fully inside cell (50..100, 30..60).
    fillRect(s, 60, 35, 20, 15)
    // Standalone highlight-sized fill far away.
    fillRect(s, 200, 200, 30, 12)
    const a = analyze(s)
    expect(a.tables.length).toBe(1)
    expect(a.highlights).toEqual([{ x0: 200, y0: 200, x1: 230, y1: 212 }])
  })

  it('dedupes nested grids, keeping the largest', () => {
    const s = newStream()
    lineGrid(s, [0, 100, 200], [0, 60, 120], 0.75)
    lineGrid(s, [10, 30, 50], [70, 85, 100], 0.75)
    const a = analyze(s)
    expect(a.tables.length).toBe(1)
    expect(a.tables[0]?.x0).toBe(0)
    expect(a.tables[0]?.x1).toBe(200)
    expect(a.tables[0]?.cols).toBe(2)
    expect(a.tables[0]?.rows).toBe(2)
  })
})

describe('classifyHorizontalRule', () => {
  const ruleAt = (y: number): PdfRect => ({ x0: 0, y0: y, x1: 10, y1: y })
  it('hits the underline band edges inclusively (em = 10, base = 100)', () => {
    expect(classifyHorizontalRule(ruleAt(96.5), 100, 10)).toBe('underline')
    expect(classifyHorizontalRule(ruleAt(99.8), 100, 10)).toBe('underline')
    expect(classifyHorizontalRule(ruleAt(98), 100, 10)).toBe('underline')
  })
  it('hits the strike band edges inclusively', () => {
    expect(classifyHorizontalRule(ruleAt(101.5), 100, 10)).toBe('strike')
    expect(classifyHorizontalRule(ruleAt(104.5), 100, 10)).toBe('strike')
    expect(classifyHorizontalRule(ruleAt(103), 100, 10)).toBe('strike')
  })
  it('returns none outside both bands', () => {
    expect(classifyHorizontalRule(ruleAt(99.9), 100, 10)).toBe('none')
    expect(classifyHorizontalRule(ruleAt(100), 100, 10)).toBe('none')
    expect(classifyHorizontalRule(ruleAt(101.4), 100, 10)).toBe('none')
    expect(classifyHorizontalRule(ruleAt(104.6), 100, 10)).toBe('none')
    expect(classifyHorizontalRule(ruleAt(90), 100, 10)).toBe('none')
    expect(classifyHorizontalRule(ruleAt(110), 100, 10)).toBe('none')
  })
  it('returns none for non-positive sizes', () => {
    expect(classifyHorizontalRule(ruleAt(98), 100, 0)).toBe('none')
    expect(classifyHorizontalRule(ruleAt(98), 100, -5)).toBe('none')
  })
})

interface TextBox {
  str: string
  x0: number
  x1: number
  y0: number
  y1: number
  baseY: number
  size: number
}

function overlaps(r: PdfRect, b: TextBox, slack: number): boolean {
  return r.x0 <= b.x1 + slack && r.x1 >= b.x0 - slack && r.y0 <= b.y1 + slack && r.y1 >= b.y0 - slack
}

describe('round-trip: Notedown export -> pdfjs vectors (coordinate-space proof)', () => {
  it(
    'underline/strike/highlight/table geometry correlates with text spans in raw user space',
    { timeout: 60000 },
    async () => {
      // Test-only import of the export pipeline (never in src bundle paths).
      const { markdownToPdfBytes } = await import('../src/app/export')
      // Same lazy-load discipline as src/app/import.ts (aliased to the
      // legacy build under vitest — see vitest.config.ts). The worker always
      // loads from an explicit file:// URL built from process.cwd(): Vite's
      // `?url` asset import resolves to a bogus path under vitest (and
      // import.meta.url is http: under vite-node), while jsdom has no
      // Worker — so pdfjs runs the legacy worker on the main-thread fake
      // worker.
      const pdfjs = await import('pdfjs-dist')
      const { resolve } = await import('node:path')
      const { pathToFileURL } = await import('node:url')
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
        resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
      ).href
      const bytes = await markdownToPdfBytes('__ul__ and ~~st~~\n\n==hl==\n\n| a | b |\n| --- | --- |\n| c | d |\n')
      const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
      const doc = await loadingTask.promise
      try {
        const page = await doc.getPage(1)
        const content = await page.getTextContent()
        const ops = await page.getOperatorList()
        const analysis = analyzePdfVectors(ops.fnArray, ops.argsArray, O)

        const boxes: TextBox[] = []
        for (const item of content.items as unknown[]) {
          if (typeof item !== 'object' || item === null || !('str' in item)) continue
          const it = item as { str: unknown; transform: unknown; width: unknown; height: unknown }
          if (typeof it.str !== 'string' || it.str === '') continue
          if (!Array.isArray(it.transform) || it.transform.length < 6) continue
          const tr = it.transform as unknown[]
          const e = tr[4]
          const f = tr[5]
          if (typeof e !== 'number' || typeof f !== 'number') continue
          const w = typeof it.width === 'number' ? it.width : 0
          const h = typeof it.height === 'number' ? Math.abs(it.height) : 0
          if (!(h > 0)) continue
          boxes.push({
            str: it.str,
            x0: Math.min(e, e + w),
            x1: Math.max(e, e + w),
            y0: f - h,
            y1: f + h,
            baseY: f,
            size: h,
          })
        }

        // Coordinate proof, part 1: the decorated words were extracted...
        const ul = boxes.find((b) => b.str.includes('ul'))
        const st = boxes.find((b) => b.str.includes('st'))
        const hl = boxes.find((b) => b.str.includes('hl'))
        expect(ul).toBeDefined()
        expect(st).toBeDefined()
        expect(hl).toBeDefined()

        // ...part 2: ...and vector geometry overlaps them with NO pageHeight
        // or y-flip parameter anywhere (direct user-space correlation).
        const ulRule = analysis.underlines.find(
          (r) => overlaps(r, ul as TextBox, 1.5) && classifyHorizontalRule(r, (ul as TextBox).baseY, (ul as TextBox).size) === 'underline',
        )
        expect(ulRule).toBeDefined()
        const stRule = analysis.underlines.find(
          (r) => overlaps(r, st as TextBox, 1.5) && classifyHorizontalRule(r, (st as TextBox).baseY, (st as TextBox).size) === 'strike',
        )
        expect(stRule).toBeDefined()
        const hlFill = analysis.highlights.find((h) => overlaps(h, hl as TextBox, 1.5))
        expect(hlFill).toBeDefined()

        // Part 3: the GFM table (header + 1 body row; separator is synthetic).
        expect(analysis.tables.length).toBe(1)
        expect(analysis.tables[0]?.cols).toBe(2)
        expect(analysis.tables[0]?.rows).toBe(2)
        expect(analysis.tables[0]?.colEdges.length).toBe(3)
        expect(analysis.tables[0]?.rowEdges.length).toBe(3)

        // Contract: the module never guesses strike-vs-underline itself.
        expect(analysis.strikes).toEqual([])
      } finally {
        await loadingTask.destroy()
      }
    },
  )
})
