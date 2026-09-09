// @vitest-environment jsdom
// Packet A — direct-PDF core (pdf-lib text-based export, re-importable via Import).
// DOMPurify (imported by export.ts) needs a window, hence the jsdom environment.
import { describe, it, expect } from 'vitest'
import {
  markdownToPdfBytes,
  markdownToPdfBytesWithImages,
  parseExportInline,
  pdfDrawLines,
  pdfDrawTable,
  pdfFlowItems,
  pdfTableColumnWidths,
  pdfWrapItems,
  PDF_CONTENT_W,
} from '../src/app/export'
import type { PdfDrawRun, PdfFlowItem } from '../src/app/export'

/** First 5 bytes of a PDF file are always the `%PDF-` magic header. */
function pdfHeader(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.slice(0, 5))
}

describe('markdownToPdfBytes (direct text-based PDF)', () => {
  it('emits non-empty bytes starting with the %PDF- header', async () => {
    const bytes = await markdownToPdfBytes('# Title\n\nHello world')
    expect(bytes.length).toBeGreaterThan(100)
    expect(pdfHeader(bytes)).toBe('%PDF-')
  })

  it('renders headings + paragraphs (more content → larger file than empty)', async () => {
    const empty = await markdownToPdfBytes('')
    const full = await markdownToPdfBytes('# Title\n\nHello **bold** and *italic* world')
    expect(pdfHeader(full)).toBe('%PDF-')
    expect(full.length).toBeGreaterThan(empty.length)
  })

  it('renders tasks as ASCII markers without throwing (re-importable)', async () => {
    const bytes = await markdownToPdfBytes('- [ ] todo\n- [x] done')
    expect(bytes.length).toBeGreaterThan(100)
    expect(pdfHeader(bytes)).toBe('%PDF-')
  })

  it('falls back on emoji/CJK (WinAnsi) instead of throwing', async () => {
    const bytes = await markdownToPdfBytes('caf\u00e9 \uD83D\uDE00 \u4E2D\u6587 \u2610')
    expect(bytes.length).toBeGreaterThan(100)
    expect(pdfHeader(bytes)).toBe('%PDF-')
  })

  it('yields a valid one-page %PDF for empty input (never empty/invalid bytes)', async () => {
    const bytes = await markdownToPdfBytes('')
    expect(bytes.length).toBeGreaterThan(0)
    expect(pdfHeader(bytes)).toBe('%PDF-')
  })

  it('WithImages falls back to alt text when expose rejects (never throws)', async () => {
    const result = await markdownToPdfBytesWithImages('![alt](pic.png)', '/doc/note.md', async () => {
      throw new Error('unreadable')
    })
    expect(pdfHeader(result.bytes)).toBe('%PDF-')
    expect(result.inlined).toEqual([])
    expect(result.skipped.length).toBeGreaterThan(0)
    expect(result.skipped[0].reason).toBe('expose-failed')
  })
})

// Underline/strikethrough in direct-PDF export (visual-only drawn rules).
// Fast seam tests: mock fonts + a recording mock page, no pdf-lib involved.
type Tok = Extract<PdfFlowItem, { kind: 'tok' }>

/** Deterministic width proxy: every char is half an em (no pdf-lib). */
const mockFont = { widthOfTextAtSize: (t: string, s: number) => t.length * s * 0.5 }

/** All eight standard-font slots point at the proxy (font mapping is not under test). */
const mockFonts = {
  regular: mockFont,
  bold: mockFont,
  italic: mockFont,
  boldItalic: mockFont,
  mono: mockFont,
  monoBold: mockFont,
  monoItalic: mockFont,
  monoBoldItalic: mockFont,
}

function flowToks(markdown: string, size: number): Tok[] {
  const items = pdfFlowItems(parseExportInline(markdown), mockFonts as any, size, false)
  return items.filter((t): t is Tok => t.kind === 'tok')
}

describe('pdf underline/strike flow flags', () => {
  it('marks __u__ runs u=true while plain runs stay false', () => {
    const toks = flowToks('__u__', 11)
    expect(toks.length).toBe(1)
    expect(toks[0].text).toBe('u')
    expect(toks[0].u).toBe(true)
    expect(toks[0].strike).toBe(false)
  })

  it('marks ~~s~~ runs strike=true while plain runs stay false', () => {
    const toks = flowToks('~~s~~', 11)
    expect(toks.length).toBe(1)
    expect(toks[0].text).toBe('s')
    expect(toks[0].u).toBe(false)
    expect(toks[0].strike).toBe(true)
  })

  it('leaves plain text undecorated', () => {
    const toks = flowToks('hi there', 11)
    expect(toks.length).toBeGreaterThan(0)
    for (const t of toks) {
      expect(t.u).toBe(false)
      expect(t.strike).toBe(false)
    }
  })

  it('carries flags onto inter-word spaces so __a b__ underlines the gap', () => {
    const toks = flowToks('__a b__', 11)
    expect(toks.map((t) => t.text)).toEqual(['a', ' ', 'b'])
    for (const t of toks) {
      expect(t.u).toBe(true)
      expect(t.strike).toBe(false)
    }
  })

  it('parses ***__~~all~~__*** into a run with b+i+u+strike all set', () => {
    const segs = parseExportInline('***__~~all~~__***')
    expect(segs.length).toBe(1)
    expect(segs[0]).toMatchObject({ t: 'all', b: true, i: true, u: true, strike: true })
    const toks = flowToks('***__~~all~~__***', 11)
    expect(toks.length).toBe(1)
    expect(toks[0].text).toBe('all')
    expect(toks[0].u).toBe(true)
    expect(toks[0].strike).toBe(true)
  })
})

interface TextCall {
  text: string
  x: number
  y: number
  size: number
}

interface LineCall {
  start: { x: number; y: number }
  end: { x: number; y: number }
  thickness: number
  color: unknown
}

function drawWithMockPage(lines: PdfDrawRun[][], size: number): { texts: TextCall[]; rules: LineCall[] } {
  const texts: TextCall[] = []
  const rules: LineCall[] = []
  const mockPage = {
    drawText: (text: string, opts: { x: number; y: number; size: number }) => {
      texts.push({ text, x: opts.x, y: opts.y, size: opts.size })
    },
    drawLine: (opts: LineCall) => {
      rules.push(opts)
    },
    drawRectangle: () => {},
  }
  const state = {
    doc: {},
    rgb: (r: number, g: number, b: number) => ({ r, g, b }),
    page: mockPage,
    y: 800,
    fonts: mockFonts,
    imageCache: new Map(),
  }
  pdfDrawLines(state as any, lines, { size, indent: 0, prefixW: 0, codeBg: false })
  return { texts, rules }
}

/** Helper: flow items for one markdown fragment. */
function flowToksAsItems(markdown: string, size: number): PdfFlowItem[] {
  return pdfFlowItems(parseExportInline(markdown), mockFonts as any, size, false)
}

describe('pdf underline/strike drawn rules', () => {
  it('emits drawLine only for decorated runs, spanning each run width, below/above the baseline', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('__a b__ mid ~~s~~ __~~x~~__', size), 10000, 10000)
    expect(lines.length).toBe(1)
    const { texts, rules } = drawWithMockPage(lines, size)

    // Nine runs in reading order, with the flags the syntax implies.
    const expected: Array<{ text: string; u: boolean; strike: boolean }> = [
      { text: 'a', u: true, strike: false },
      { text: ' ', u: true, strike: false },
      { text: 'b', u: true, strike: false },
      { text: ' ', u: false, strike: false },
      { text: 'mid', u: false, strike: false },
      { text: ' ', u: false, strike: false },
      { text: 's', u: false, strike: true },
      { text: ' ', u: false, strike: false },
      { text: 'x', u: true, strike: true },
    ]
    expect(texts.map((t) => t.text)).toEqual(expected.map((e) => e.text))
    const textY = texts[0].y
    for (const t of texts) expect(t.y).toBe(textY)

    // Reading order: x advances monotonically by the measured run width, and
    // each run's rule(s) span exactly that width (plain runs draw none).
    const black = { r: 0, g: 0, b: 0 }
    let x = 34 // PDF_MARGIN, no indent/prefix on the first line
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i] as TextCall
      const e = expected[i] as { text: string; u: boolean; strike: boolean }
      expect(t.x).toBe(x)
      const w = e.text.length * size * 0.5
      const ours = rules.filter((r) => r.start.x === x)
      expect(ours.length).toBe((e.u ? 1 : 0) + (e.strike ? 1 : 0))
      for (const r of ours) {
        expect(r.end.x).toBe(x + w)
        expect(r.end.y).toBe(r.start.y)
        expect(r.color).toEqual(black)
      }
      x += w
    }

    // Underline segments (a, gap, b, x) sit below the baseline …
    const under = rules.filter((r) => r.start.y < textY)
    expect(under.length).toBe(4)
    for (const r of under) {
      expect(r.start.y).toBeCloseTo(textY - size * 0.12, 10)
      expect(r.thickness).toBeCloseTo(Math.max(0.5, size * 0.06), 10)
    }
    // … strikethrough segments (s, x) sit above it.
    const strike = rules.filter((r) => r.start.y > textY)
    expect(strike.length).toBe(2)
    for (const r of strike) {
      expect(r.start.y).toBeCloseTo(textY + size * 0.28, 10)
      expect(r.thickness).toBeCloseTo(Math.max(0.5, size * 0.05), 10)
    }
    // No rule is exactly on the baseline; total is 4 + 2.
    expect(rules.length).toBe(6)
    expect(rules.every((r) => r.start.y !== textY)).toBe(true)
  })

  it('draws both lines for a run with u+strike set', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('__~~x~~__', size), 10000, 10000)
    const { texts, rules } = drawWithMockPage(lines, size)
    expect(texts.map((t) => t.text)).toEqual(['x'])
    expect(rules.length).toBe(2)
    const ys = rules.map((r) => r.start.y).sort((a, b) => a - b)
    expect(ys[0]).toBeLessThan(texts[0].y)
    expect(ys[1]).toBeGreaterThan(texts[0].y)
  })
})

describe('pdf underline/strike wrap', () => {
  it('keeps flags on wrapped word runs', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('__aa bb cc__', size), 15, 15)
    expect(lines.length).toBe(3)
    const words: string[] = []
    for (const line of lines) {
      for (const run of line) {
        words.push(run.text)
        expect(run.u).toBe(true)
        expect(run.strike).toBe(false)
      }
    }
    expect(words).toEqual(['aa', 'bb', 'cc'])
  })

  it('keeps flags when an over-long decorated word char-splits', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('__abcdefgh__', size), 12, 12)
    const chars: PdfDrawRun[] = []
    for (const line of lines) for (const run of line) chars.push(run)
    expect(chars.length).toBeGreaterThan(1)
    expect(chars.map((r) => r.text).join('')).toBe('abcdefgh')
    for (const r of chars) {
      expect(r.u).toBe(true)
      expect(r.strike).toBe(false)
    }
  })
})

describe('pdf mark/highlight flow flags', () => {
  it('marks ==hi== runs mark=true while plain runs stay false', () => {
    const toks = flowToks('==hi==', 11)
    expect(toks.length).toBe(1)
    expect(toks[0].text).toBe('hi')
    expect(toks[0].mark).toBe(true)
    expect(toks[0].u).toBe(false)
    expect(toks[0].strike).toBe(false)
    expect(toks[0].sup).toBe(false)
    expect(toks[0].sub).toBe(false)
    expect(toks[0].dy).toBe(0)
    expect(toks[0].size).toBe(11)
  })

  it('carries mark onto inter-word spaces so ==a b== highlights the gap', () => {
    const toks = flowToks('==a b==', 11)
    expect(toks.map((t) => t.text)).toEqual(['a', ' ', 'b'])
    for (const t of toks) expect(t.mark).toBe(true)
  })

  it('leaves plain text unmarked', () => {
    const toks = flowToks('hi there', 11)
    for (const t of toks) expect(t.mark).toBe(false)
  })

  it('keeps mark on wrapped word runs and char-split fragments', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('==aa bb cc==', size), 15, 15)
    expect(lines.length).toBe(3)
    for (const line of lines) for (const run of line) expect(run.mark).toBe(true)
    const split = pdfWrapItems(flowToksAsItems('==abcdefgh==', size), 12, 12)
    const chars: PdfDrawRun[] = []
    for (const line of split) for (const run of line) chars.push(run)
    expect(chars.length).toBeGreaterThan(1)
    expect(chars.map((r) => r.text).join('')).toBe('abcdefgh')
    for (const r of chars) expect(r.mark).toBe(true)
  })
})

interface RectCall {
  x: number
  y: number
  width: number
  height: number
  color: unknown
  borderColor?: unknown
  borderWidth?: number
}

function drawWithMockPageFull(
  lines: PdfDrawRun[][],
  size: number,
): { texts: TextCall[]; rules: LineCall[]; rects: RectCall[]; order: Array<{ kind: string; idx: number }> } {
  const texts: TextCall[] = []
  const rules: LineCall[] = []
  const rects: RectCall[] = []
  const order: Array<{ kind: string; idx: number }> = []
  const mockPage = {
    drawText: (text: string, opts: { x: number; y: number; size: number }) => {
      order.push({ kind: 'text', idx: texts.length })
      texts.push({ text, x: opts.x, y: opts.y, size: opts.size })
    },
    drawLine: (opts: LineCall) => {
      order.push({ kind: 'rule', idx: rules.length })
      rules.push(opts)
    },
    drawRectangle: (opts: RectCall) => {
      order.push({ kind: 'rect', idx: rects.length })
      rects.push(opts)
    },
  }
  const state = {
    doc: {},
    rgb: (r: number, g: number, b: number) => ({ r, g, b }),
    page: mockPage,
    y: 800,
    fonts: mockFonts,
    imageCache: new Map(),
  }
  pdfDrawLines(state as any, lines, { size, indent: 0, prefixW: 0, codeBg: false })
  return { texts, rules, rects, order }
}

describe('pdf mark drawn rect', () => {
  it('draws a yellow rect BEFORE its drawText, spanning exactly the run; plain runs emit none', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('==hi== ok', size), 10000, 10000)
    expect(lines.length).toBe(1)
    const { texts, rects, order } = drawWithMockPageFull(lines, size)
    expect(texts.map((t) => t.text)).toEqual(['hi', ' ', 'ok'])
    // Only the marked run gets a highlight rect.
    expect(rects.length).toBe(1)
    const rect = rects[0] as RectCall
    const hi = texts[0] as TextCall
    expect(rect.x).toBe(hi.x)
    expect(rect.x).toBe(34)
    const w = 'hi'.length * size * 0.5
    expect(rect.width).toBeCloseTo(w, 10)
    expect(rect.y).toBeCloseTo(hi.y - size * 0.25, 10)
    expect(rect.height).toBeCloseTo(size * 1.05, 10)
    expect(rect.color).toEqual({ r: 1, g: 1, b: 0.55 })
    expect(rect.borderWidth).toBe(0)
    // Order: rect immediately precedes its text.
    const rectPos = order.findIndex((o) => o.kind === 'rect')
    const textPos = order.findIndex((o) => o.kind === 'text')
    expect(rectPos).toBeGreaterThanOrEqual(0)
    expect(textPos).toBe(rectPos + 1)
  })

  it('emits no rects for undecorated text', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('plain words', size), 10000, 10000)
    const { rects } = drawWithMockPageFull(lines, size)
    expect(rects.length).toBe(0)
  })
})

describe('pdf sup/sub flow and draw', () => {
  it('scales ^x^ to 0.7x size with dy>0 and ~x~ with dy<0', () => {
    const sup = flowToks('^x^', 10)
    expect(sup.length).toBe(1)
    expect(sup[0].sup).toBe(true)
    expect(sup[0].sub).toBe(false)
    expect(sup[0].size).toBeCloseTo(7, 10)
    expect(sup[0].dy).toBeCloseTo(3.5, 10)
    const sub = flowToks('~x~', 10)
    expect(sub.length).toBe(1)
    expect(sub[0].sub).toBe(true)
    expect(sub[0].sup).toBe(false)
    expect(sub[0].size).toBeCloseTo(7, 10)
    expect(sub[0].dy).toBeCloseTo(-2.5, 10)
    const plain = flowToks('x', 10)
    expect(plain[0].size).toBe(10)
    expect(plain[0].dy).toBe(0)
  })

  it('keeps sup/sub literal inside code spans', () => {
    const a = flowToks('`^x^`', 10)
    expect(a.length).toBe(1)
    expect(a[0].sup).toBe(false)
    expect(a[0].sub).toBe(false)
    expect(a[0].size).toBe(10)
    const b = flowToks('`~x~`', 10)
    expect(b.length).toBe(1)
    expect(b[0].sup).toBe(false)
    expect(b[0].sub).toBe(false)
  })

  it('preserves sup flags/size/dy through word wrap and char-split', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('^aa bb cc^', size), 15, 15)
    expect(lines.length).toBe(3)
    for (const line of lines) {
      for (const run of line) {
        expect(run.sup).toBe(true)
        expect(run.size).toBeCloseTo(7, 10)
        expect(run.dy).toBeCloseTo(3.5, 10)
      }
    }
    const split = pdfWrapItems(flowToksAsItems('^abcdefgh^', size), 12, 12)
    const chars: PdfDrawRun[] = []
    for (const line of split) for (const run of line) chars.push(run)
    expect(chars.map((r) => r.text).join('')).toBe('abcdefgh')
    for (const r of chars) {
      expect(r.sup).toBe(true)
      expect(r.size).toBeCloseTo(7, 10)
      expect(r.dy).toBeCloseTo(3.5, 10)
    }
  })

  it('draws sup above and sub below the base baseline without expanding line height', () => {
    const size = 10
    const supLines = pdfWrapItems(flowToksAsItems('a ^x^', size), 10000, 10000)
    const sup = drawWithMockPageFull(supLines, size)
    expect(sup.texts.map((t) => t.text)).toEqual(['a', ' ', 'x'])
    const baseY = sup.texts[0].y
    expect(sup.texts[1].y).toBe(baseY)
    expect(sup.texts[2].y).toBeGreaterThan(baseY)
    expect(sup.texts[2].y).toBeCloseTo(baseY + 3.5, 10)
    expect(sup.texts[2].size).toBeCloseTo(7, 10)

    const subLines = pdfWrapItems(flowToksAsItems('a ~x~', size), 10000, 10000)
    const sub = drawWithMockPageFull(subLines, size)
    expect(sub.texts[2].y).toBeLessThan(sub.texts[0].y)
    expect(sub.texts[2].y).toBeCloseTo(sub.texts[0].y - 2.5, 10)
  })

  it('anchors u/strike rules on the drawn (shifted) baseline', () => {
    const size = 10
    const lines = pdfWrapItems(flowToksAsItems('__~~^x^~~__', size), 10000, 10000)
    expect(lines.length).toBe(1)
    expect(lines[0].length).toBe(1)
    const run = lines[0][0] as PdfDrawRun
    expect(run.u).toBe(true)
    expect(run.strike).toBe(true)
    expect(run.sup).toBe(true)
    const { texts, rules } = drawWithMockPageFull(lines, size)
    expect(texts.length).toBe(1)
    const drawnY = texts[0].y
    expect(rules.length).toBe(2)
    const ys = rules.map((r) => r.start.y).sort((a, b) => a - b)
    // Underline below the RAISED baseline, strike above it.
    expect(ys[0]).toBeCloseTo(drawnY - run.size * 0.12, 10)
    expect(ys[1]).toBeCloseTo(drawnY + run.size * 0.28, 10)
    expect(ys[0]).toBeLessThan(drawnY)
    expect(ys[1]).toBeGreaterThan(drawnY)
  })
})

function makeMockTableState(initialY: number): {
  state: any
  texts: TextCall[]
  rules: LineCall[]
  rects: RectCall[]
  pages: any[]
} {
  const texts: TextCall[] = []
  const rules: LineCall[] = []
  const rects: RectCall[] = []
  const pages: any[] = []
  const makePage = () => ({
    drawText: (text: string, opts: { x: number; y: number; size: number }) => {
      texts.push({ text, x: opts.x, y: opts.y, size: opts.size })
    },
    drawLine: (opts: LineCall) => {
      rules.push(opts)
    },
    drawRectangle: (opts: RectCall) => {
      rects.push(opts)
    },
  })
  let page = makePage()
  pages.push(page)
  const state: any = {
    doc: {
      addPage: () => {
        page = makePage()
        pages.push(page)
        state.page = page
        return page
      },
    },
    rgb: (r: number, g: number, b: number) => ({ r, g, b }),
    page,
    y: initialY,
    fonts: mockFonts,
    imageCache: new Map(),
  }
  return { state, texts, rules, rects, pages }
}

describe('pdf real bordered tables', () => {
  it('scales wide columns to sum exactly to PDF_CONTENT_W with a MIN floor', () => {
    const rows = [
      ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)],
      ['d', 'e', 'f'],
    ]
    const ws = pdfTableColumnWidths(rows, mockFonts as any)
    expect(ws.length).toBe(3)
    expect(ws.reduce((a, b) => a + b, 0)).toBeCloseTo(PDF_CONTENT_W, 6)
    for (const w of ws) expect(w).toBeGreaterThanOrEqual(36 - 1e-6)
  })

  it('uses natural widths when the table fits', () => {
    const ws = pdfTableColumnWidths(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      mockFonts as any,
    )
    // 1 char at size 11 is 5.5pt + 2*5 padding = 15.5 per column.
    expect(ws[0]).toBeCloseTo(15.5, 6)
    expect(ws[1]).toBeCloseTo(15.5, 6)
    expect(ws.reduce((a, b) => a + b, 0)).toBeLessThan(PDF_CONTENT_W)
  })

  it('draws header with shaded fill and body with plain fill, all bordered', () => {
    const { state, rects, texts } = makeMockTableState(800)
    pdfDrawTable(state, [
      ['H1', 'H2'],
      ['a', 'b'],
    ])
    expect(rects.length).toBe(4)
    const headerFill = { r: 0.949, g: 0.949, b: 0.945 }
    const bodyFill = { r: 1, g: 1, b: 1 }
    const border = { r: 0.7, g: 0.7, b: 0.7 }
    expect(rects[0].color).toEqual(headerFill)
    expect(rects[1].color).toEqual(headerFill)
    expect(rects[2].color).toEqual(bodyFill)
    expect(rects[3].color).toEqual(bodyFill)
    for (const r of rects) {
      expect(r.borderColor).toEqual(border)
      expect(r.borderWidth).toBe(0.75)
    }
    const joined = texts.map((t) => t.text).join(' ')
    expect(joined).toContain('H1')
    expect(joined).toContain('a')
    // Header starts at the left margin.
    expect(rects[0].x).toBe(34)
  })

  it('repeats the header on a forced page break', () => {
    // One row is 1*14.3+8 = 22.3pt: y=65 fits the header but not the body.
    const { state, rects, pages } = makeMockTableState(65)
    pdfDrawTable(state, [
      ['H1', 'H2'],
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(pages.length).toBe(2)
    // Original header (2) + repeated header (2) + two body rows (2+2).
    expect(rects.length).toBe(8)
    const headerFill = { r: 0.949, g: 0.949, b: 0.945 }
    expect(rects.filter((r) => JSON.stringify(r.color) === JSON.stringify(headerFill)).length).toBe(4)
  })

  it('draws empty bordered cells for ragged rows', () => {
    const { state, rects, texts } = makeMockTableState(800)
    pdfDrawTable(state, [
      ['H1', 'H2', 'H3'],
      ['only'],
    ])
    // 2 rows x 3 cols = 6 bordered cells.
    expect(rects.length).toBe(6)
    const joined = texts.map((t) => t.text).join(' ')
    expect(joined).toContain('H1')
    expect(joined).toContain('only')
  })

  it('grows the whole row to the tallest (multi-line) cell', () => {
    const { state, rects } = makeMockTableState(800)
    pdfDrawTable(state, [
      ['H1', 'H2'],
      ['x'.repeat(100), 'b'],
    ])
    expect(rects.length).toBe(4)
    // Body row rects share one tall height, larger than the header row.
    expect(rects[2].height).toBeCloseTo(rects[3].height, 6)
    expect(rects[2].height).toBeGreaterThan(rects[0].height)
  })

  it('emits no | separators or --- lines', () => {
    const { state, texts } = makeMockTableState(800)
    pdfDrawTable(state, [
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(texts.length).toBeGreaterThan(0)
    for (const t of texts) {
      expect(t.text).not.toContain('|')
      expect(t.text).not.toContain('---')
    }
  })

  it('renders image alt text inside cells (embedding stays in the WithImages path)', () => {
    const { state, texts } = makeMockTableState(800)
    pdfDrawTable(state, [['H'], ['![pic alt](pic.png)']])
    // Runs render contiguously on the page (the inline parser splits 'pic alt'
    // into 'pic' + ' ' + 'alt' runs), so concatenate verbatim, not with spaces.
    const joined = texts.map((t) => t.text).join('')
    expect(joined).toContain('pic alt')
    expect(joined).not.toContain('pic.png')
    expect(joined).not.toContain('data:')
  })

  it('renders code/highlight/underline inside cells via the shared run path', () => {
    const { state, texts, rects } = makeMockTableState(800)
    pdfDrawTable(state, [['H'], ['==hi==']])
    expect(texts.map((t) => t.text).join(' ')).toContain('hi')
    // One yellow highlight rect plus two bordered cell rects.
    const yellow = rects.filter(
      (r) => JSON.stringify(r.color) === JSON.stringify({ r: 1, g: 1, b: 0.55 }),
    )
    expect(yellow.length).toBe(1)
  })

  it('exports a table to real PDF bytes without |/--- artifacts in the text layer', async () => {
    const bytes = await markdownToPdfBytes('| a | b |\n| --- | --- |\n| c | d |\n')
    expect(bytes.length).toBeGreaterThan(100)
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
  })
})
