/**
 * Notedown - vector-graphics analysis for PDF import.
 *
 * pdfjs `getTextContent` returns only glyphs: underline/strike rules,
 * highlight fills and table ruling lines are vector path operators that never
 * reach the text layer, so they are invisible to the plain-text import in
 * `src/app/import.ts`. This module recovers that geometry from
 * `page.getOperatorList()` output; the importer correlates the returned rects
 * and grids with nearby text spans (it owns all text awareness).
 *
 * Split of responsibility (locked):
 * - THIS module is text-blind. It never sees strings, fonts or baselines, so
 *   it cannot tell an underline from a strikethrough from geometry alone: ALL
 *   non-grid horizontal rules are returned in `underlines` and `strikes` is
 *   always empty. The caller reclassifies via {@link classifyHorizontalRule}
 *   once it knows each span's baseline and size.
 * - Grids are detected FIRST; any rule within 1pt of a grid edge is dropped
 *   (table borders must never surface as underlines). Fills fully inside a
 *   grid cell (expanded 1pt) are dropped (cell shading, not highlights).
 *
 * Opcode numbers — verified against the installed pdfjs-dist 6.5.438, NOT
 * memory (source lines cited; re-verify on every pdfjs upgrade):
 * - OPS enum: `node_modules/pdfjs-dist/build/pdf.mjs` lines 228-320
 *   (moveTo 13, lineTo 14, curveTo 15, curveTo2 16, curveTo3 17,
 *   closePath 18, rectangle 19, stroke 20, closeStroke 21, fill 22,
 *   eoFill 23, fillStroke 24, eoFillStroke 25, closeFillStroke 26,
 *   closeEOFillStroke 27, endPath 28, clip 29, eoClip 30, save 10,
 *   restore 11, transform 12, setLineWidth 2; constructPath 91).
 *   The same values exist in `build/pdf.worker.mjs` lines 228-320.
 * - The caller passes OPS in (this module MUST stay statically free of
 *   `pdfjs-dist`, which the app shell lazy-loads to keep the bundle small).
 *   Every opcode is looked up by NAME at call time; a missing entry disables
 *   that op class instead of crashing.
 * - CRITICAL pdfjs-v6 encoding detail (`pdf.worker.mjs` lines 35791-35798):
 *   raw path ops (moveTo/lineTo/rectangle/...) NEVER reach fnArray. The
 *   worker folds them into a DrawOPS buffer via buildPath (method at lines
 *   35127+) and emits ONE `constructPath` op per paint: args are
 *   `[paintOp, [Float32Array|null], minMax|null]` where the buffer encodes
 *   DrawOPS moveTo 0 (+x+y), lineTo 1 (+x+y), curveTo 2 (+6 coords),
 *   quadraticCurveTo 3 (+4 coords), closePath 4 (verified lines 321-327 of
 *   both bundles). Raw moveTo/lineTo/... ops are STILL handled (other
 *   producers, hand-built streams, future pdfjs shapes) — both forms feed the
 *   same paint pipeline.
 * - Bare `clip`/`eoClip` carry no path (the clip path arrives separately as a
 *   `constructPath` whose paint is `endPath`, per the `re W n` idiom); both
 *   are dropped. Clipping regions are deliberately NOT modelled (limit L3).
 *
 * Coordinate space: operator path coords AND TextItem.transform e/f both live
 * in PDF user space (points, origin bottom-left, y-up) — getOperatorList
 * prepends no viewport transform (worker only forwards content-stream ops),
 * so returned rects correlate DIRECTLY with text-item boxes. No pageHeight /
 * y-flip parameter exists by design; `tests/pdf-vector.test.ts` proves the
 * correlation with a real export->pdfjs round-trip.
 *
 * Heuristics are FULLY GENERIC (no Notedown-specific tuning) and conservative
 * (false negatives beat false positives). Pure zero-dependency TypeScript;
 * no DOM.
 *
 * Known limits:
 * - L1 curves: beziers flatten to their endpoint (rules drawn as curves are
 *   judged by chord; curved table borders are missed).
 * - L2 rotated/skewed content: only axis-aligned geometry qualifies
 *   (horizontal < 2 deg, vertical > 88 deg); rotated pages miss.
 * - L3 clipping: clip paths ignored — vector art outside the clip region
 *   still counts (over-detect, contradicts conservatism only in exotic PDFs).
 * - L4 lineWidth under a scaled CTM is read raw (no scale compensation);
 *   uniform-scale documents are unaffected in practice.
 * - L5 full-width shaded bands (e.g. code-block backgrounds) are
 *   geometrically identical to highlights and ARE returned; the caller must
 *   require text-span overlap before emitting markup.
 * - L6 dashed/dotted table borders fail the 90%-span uniformity rule and the
 *   grid is missed (conservative by design).
 */

export interface PdfRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PdfTableGrid {
  x0: number
  y0: number
  x1: number
  y1: number
  cols: number
  rows: number
  colEdges: number[]
  rowEdges: number[]
}

export interface PdfVectorAnalysis {
  underlines: PdfRect[]
  strikes: PdfRect[]
  highlights: PdfRect[]
  tables: PdfTableGrid[]
}

/** Rule qualifies iff single-segment, near-horizontal, thin and long. */
const RULE_MAX_ANGLE_DEG = 2
const RULE_MAX_THICKNESS = 2.5
const RULE_MIN_LENGTH = 4
/** Grid segments admit shorter dashes than rules (still rejects dots). */
const GRID_MIN_SEG_LENGTH = 2
/** Edge-clustering tolerance (pt). */
const GRID_EDGE_TOL = 2
/** An edge must cover this fraction of the grid's full span. */
const GRID_SPAN_COVER = 0.9
/** Rules within this distance (pt) of any grid edge are table borders. */
const GRID_EXCLUDE_DIST = 1
/** Cell-fill test expands each cell by this much (pt). */
const CELL_FILL_EXPAND = 1
/** Highlight fill gates (pt / pt^2). */
const HL_MIN_AREA = 8
const HL_MIN_W = 3
const HL_MIN_H = 4
const HL_MAX_H = 40

/**
 * DrawOPS buffer codec (pdf.worker.mjs lines 332-338). This enum is NOT part
 * of the exported OPS map, so the values are pinned here with their source;
 * the decoder aborts a path on any out-of-range code (fail-closed).
 */
const DRAW_MOVE_TO = 0
const DRAW_LINE_TO = 1
const DRAW_CURVE_TO = 2
const DRAW_QUAD_TO = 3
const DRAW_CLOSE = 4

type Ctm = [number, number, number, number, number, number]

interface RawPt {
  x: number
  y: number
}

interface RawSubpath {
  pts: RawPt[]
  closed: boolean
}

interface HSeg {
  y: number
  x0: number
  x1: number
}

interface VSeg {
  x: number
  y0: number
  y1: number
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Lenient ArrayLike read (plain arrays AND Float32Array/Uint8Array). */
function readArgs(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  if (typeof v === 'object' && v !== null && 'length' in v) {
    const like = v as ArrayLike<unknown>
    if (typeof like.length === 'number' && like.length >= 0) {
      try {
        return Array.from(like)
      } catch {
        return null
      }
    }
  }
  return null
}

function readCtmArgs(v: unknown): Ctm | null {
  const a = readArgs(v)
  if (a === null || a.length < 6) return null
  const out: number[] = []
  for (let i = 0; i < 6; i++) {
    if (!isNum(a[i])) return null
    out.push(a[i] as number)
  }
  return out as Ctm
}

const IDENTITY_CTM: Ctm = [1, 0, 0, 1, 0, 0]

/** PDF `cm`: newCTM = ctm x m (post-multiply, spec 8.3.4). */
function mulCtm(ctm: Ctm, m: Ctm): Ctm {
  const [a1, b1, c1, d1, e1, f1] = ctm
  const [a2, b2, c2, d2, e2, f2] = m
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

function mapPt(ctm: Ctm, x: number, y: number): RawPt {
  return { x: ctm[0] * x + ctm[2] * y + ctm[4], y: ctm[1] * x + ctm[3] * y + ctm[5] }
}

function normRect(x0: number, y0: number, x1: number, y1: number): PdfRect {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  }
}

/**
 * Decode one `constructPath` args value to raw subpaths. Returns null when
 * the shape is unrecognised (caller skips the path — fail-closed).
 * Expected shape: [paintOpNumber, [Float32Array|null], minMax|null].
 */
function decodeConstructPath(args: unknown): { paint: number; subs: RawSubpath[] } | null {
  const outer = readArgs(args)
  if (outer === null || outer.length < 2) return null
  if (!isNum(outer[0])) return null
  const inner = readArgs(outer[1])
  // [null] (or null) = empty path: valid, paints nothing.
  if (inner === null || inner.length === 0 || inner[0] === null || inner[0] === undefined) {
    return { paint: outer[0], subs: [] }
  }
  const data = readArgs(inner[0])
  if (data === null) return null
  const subs: RawSubpath[] = []
  let cur: RawPt[] | null = null
  let closed = false
  const pushPt = (x: number, y: number, start: boolean): void => {
    if (start || cur === null) {
      cur = []
      closed = false
      subs.push({ pts: cur, closed: false })
    }
    ;(cur as RawPt[]).push({ x, y })
  }
  let i = 0
  while (i < data.length) {
    const code = data[i++]
    if (!isNum(code)) return null
    if (code === DRAW_MOVE_TO || code === DRAW_LINE_TO) {
      if (i + 1 >= data.length) return null
      const x = data[i++]
      const y = data[i++]
      if (!isNum(x) || !isNum(y)) return null
      pushPt(x, y, code === DRAW_MOVE_TO)
    } else if (code === DRAW_CURVE_TO) {
      // L1: flatten to the endpoint (control points only affect the chord).
      if (i + 5 >= data.length) return null
      const x = data[i + 4]
      const y = data[i + 5]
      if (!isNum(x) || !isNum(y)) return null
      i += 6
      pushPt(x, y, false)
    } else if (code === DRAW_QUAD_TO) {
      if (i + 3 >= data.length) return null
      const x = data[i + 2]
      const y = data[i + 3]
      if (!isNum(x) || !isNum(y)) return null
      i += 4
      pushPt(x, y, false)
    } else if (code === DRAW_CLOSE) {
      if (cur !== null && !closed) {
        closed = true
        ;(subs[subs.length - 1] as RawSubpath).closed = true
      }
    } else {
      return null
    }
  }
  return { paint: outer[0], subs }
}

/**
 * Classify one horizontal rule against a KNOWN text baseline. Pure geometry
 * so the caller (which owns text spans) can split `underlines` into true
 * underlines vs strikes. Bands (em = textSize):
 * - underline iff rule.y in [baseY - 0.35em, baseY - 0.02em]
 * - strike iff rule.y in [baseY + 0.15em, baseY + 0.45em]
 * - else none. Boundaries inclusive; non-positive sizes never match.
 */
export function classifyHorizontalRule(
  rule: PdfRect,
  textBaseY: number,
  textSize: number,
): 'underline' | 'strike' | 'none' {
  if (!isNum(rule.y0) || !isNum(rule.y1) || !isNum(textBaseY) || !isNum(textSize)) return 'none'
  if (!(textSize > 0)) return 'none'
  const y = (rule.y0 + rule.y1) / 2
  const dy = y - textBaseY
  const em = textSize
  if (dy >= -0.35 * em && dy <= -0.02 * em) return 'underline'
  if (dy >= 0.15 * em && dy <= 0.45 * em) return 'strike'
  return 'none'
}

export function analyzePdfVectors(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  OPS: Record<string, number>,
): PdfVectorAnalysis {
  const empty: PdfVectorAnalysis = { underlines: [], strikes: [], highlights: [], tables: [] }
  if (fnArray === null || fnArray === undefined || argsArray === null || argsArray === undefined) return empty

  const lookup = (name: string): number | undefined => {
    const v = (OPS as Record<string, unknown>)[name]
    return typeof v === 'number' ? v : undefined
  }
  const OP = {
    save: lookup('save'),
    restore: lookup('restore'),
    transform: lookup('transform'),
    moveTo: lookup('moveTo'),
    lineTo: lookup('lineTo'),
    curveTo: lookup('curveTo'),
    curveTo2: lookup('curveTo2'),
    curveTo3: lookup('curveTo3'),
    closePath: lookup('closePath'),
    rectangle: lookup('rectangle'),
    stroke: lookup('stroke'),
    closeStroke: lookup('closeStroke'),
    fill: lookup('fill'),
    eoFill: lookup('eoFill'),
    fillStroke: lookup('fillStroke'),
    eoFillStroke: lookup('eoFillStroke'),
    closeFillStroke: lookup('closeFillStroke'),
    closeEOFillStroke: lookup('closeEOFillStroke'),
    endPath: lookup('endPath'),
    clip: lookup('clip'),
    eoClip: lookup('eoClip'),
    setLineWidth: lookup('setLineWidth'),
    constructPath: lookup('constructPath'),
  }
  const isStrokePaint = (fn: number): boolean => fn === OP.stroke || fn === OP.closeStroke
  const isFillPaint = (fn: number): boolean =>
    fn === OP.fill ||
    fn === OP.eoFill ||
    fn === OP.fillStroke ||
    fn === OP.eoFillStroke ||
    fn === OP.closeFillStroke ||
    fn === OP.closeEOFillStroke
  const isStrokeFillPaint = (fn: number): boolean =>
    fn === OP.fillStroke || fn === OP.eoFillStroke || fn === OP.closeFillStroke || fn === OP.closeEOFillStroke

  let ctm: Ctm = [...IDENTITY_CTM] as Ctm
  const ctmStack: Ctm[] = []
  const widthStack: number[] = []
  let lineWidth = 1
  // Current RAW (pre-CTM) path; mapped at paint time with the live CTM.
  let cur: RawSubpath[] = []

  const rules: Array<{ x0: number; x1: number; y: number; hw: number }> = []
  const hsegs: HSeg[] = []
  const vsegs: VSeg[] = []
  const fills: PdfRect[] = []

  const openSub = (): RawPt[] => {
    const last = cur[cur.length - 1]
    if (last !== undefined && !last.closed) return last.pts
    const pts: RawPt[] = []
    cur.push({ pts, closed: false })
    return pts
  }

  /** Edges of raw subpaths mapped to user space (closing edge included). */
  const userEdges = (subs: RawSubpath[], closeAll: boolean): Array<[RawPt, RawPt]> => {
    const edges: Array<[RawPt, RawPt]> = []
    for (const sub of subs) {
      const pts = sub.pts.map((p) => mapPt(ctm, p.x, p.y))
      for (let i = 0; i + 1 < pts.length; i++) {
        edges.push([pts[i] as RawPt, pts[i + 1] as RawPt])
      }
      const closed = closeAll || sub.closed
      if (closed && pts.length === 2) {
        // moveTo+lineTo+close: the closing edge duplicates the segment.
      } else if (closed && pts.length > 2) {
        edges.push([pts[pts.length - 1] as RawPt, pts[0] as RawPt])
      }
    }
    return edges
  }

  const collectSegments = (subs: RawSubpath[], closeAll: boolean): void => {
    for (const [a, b] of userEdges(subs, closeAll)) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (!(len >= GRID_MIN_SEG_LENGTH)) continue
      const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
      if (ang < RULE_MAX_ANGLE_DEG) {
        hsegs.push({ y: (a.y + b.y) / 2, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) })
      } else if (ang > 90 - RULE_MAX_ANGLE_DEG) {
        vsegs.push({ x: (a.x + b.x) / 2, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) })
      }
      // L2: diagonal segments are ignored (neither rule nor grid).
    }
  }

  const collectRules = (subs: RawSubpath[], width: number): void => {
    if (!(width >= 0) || width > RULE_MAX_THICKNESS) return
    for (const sub of subs) {
      // Single-segment iff exactly one edge: 2 pts (a 2-pt close adds no
      // edge — the closing edge duplicates the segment).
      if (sub.pts.length !== 2) continue
      const a = mapPt(ctm, (sub.pts[0] as RawPt).x, (sub.pts[0] as RawPt).y)
      const b = mapPt(ctm, (sub.pts[1] as RawPt).x, (sub.pts[1] as RawPt).y)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (!(len >= RULE_MIN_LENGTH)) continue
      const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
      if (!(ang < RULE_MAX_ANGLE_DEG)) continue
      const y = (a.y + b.y) / 2
      rules.push({
        x0: Math.min(a.x, b.x),
        x1: Math.max(a.x, b.x),
        y,
        hw: Math.max(0.25, width / 2),
      })
    }
  }

  const collectFills = (subs: RawSubpath[]): void => {
    for (const sub of subs) {
      if (sub.pts.length === 0) continue
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const p of sub.pts) {
        const m = mapPt(ctm, p.x, p.y)
        if (m.x < x0) x0 = m.x
        if (m.y < y0) y0 = m.y
        if (m.x > x1) x1 = m.x
        if (m.y > y1) y1 = m.y
      }
      // Fill implicitly closes open subpaths, so every subpath has a bbox.
      if (x1 > x0 && y1 > y0) fills.push({ x0, y0, x1, y1 })
    }
  }

  /** Apply one paint op to raw subpaths (shared by raw and constructPath). */
  const paint = (fn: number, subs: RawSubpath[], closeAll: boolean): void => {
    if (OP.stroke !== undefined && isStrokePaint(fn)) {
      collectRules(subs, lineWidth)
      collectSegments(subs, closeAll)
    } else if (OP.fill !== undefined && isFillPaint(fn)) {
      collectFills(subs)
      // `B`-family operators stroke the path too: borders ARE grid segments.
      if (isStrokeFillPaint(fn)) {
        collectSegments(subs, closeAll)
      }
    }
    // endPath / clip-family / unknown paints: path consumed, nothing kept.
  }

  const n = fnArray.length
  for (let i = 0; i < n; i++) {
    const fn = fnArray[i] as number
    if (fn === OP.constructPath && OP.constructPath !== undefined) {
      const decoded = decodeConstructPath(argsArray[i])
      if (decoded !== null) {
        const closeAll = decoded.paint === OP.closeStroke || decoded.paint === OP.closeFillStroke || decoded.paint === OP.closeEOFillStroke
        paint(decoded.paint, decoded.subs, closeAll)
      }
      continue
    }
    if (fn === OP.save && OP.save !== undefined) {
      ctmStack.push([...ctm] as Ctm)
      widthStack.push(lineWidth)
      continue
    }
    if (fn === OP.restore && OP.restore !== undefined) {
      const prev = ctmStack.pop()
      if (prev !== undefined) ctm = prev
      const w = widthStack.pop()
      if (w !== undefined) lineWidth = w
      continue
    }
    if (fn === OP.transform && OP.transform !== undefined) {
      const m = readCtmArgs(argsArray[i])
      if (m !== null) ctm = mulCtm(ctm, m)
      continue
    }
    if (fn === OP.setLineWidth && OP.setLineWidth !== undefined) {
      const a = readArgs(argsArray[i])
      if (a !== null && isNum(a[0])) lineWidth = Math.abs(a[0])
      continue
    }
    if (fn === OP.moveTo && OP.moveTo !== undefined) {
      const a = readArgs(argsArray[i])
      if (a !== null && isNum(a[0]) && isNum(a[1])) {
        const pts: RawPt[] = [{ x: a[0], y: a[1] }]
        cur.push({ pts, closed: false })
      }
      continue
    }
    if (
      (fn === OP.lineTo || fn === OP.curveTo || fn === OP.curveTo2 || fn === OP.curveTo3) &&
      fn !== undefined
    ) {
      const a = readArgs(argsArray[i])
      if (a === null) continue
      // L1: curves flatten to their endpoint (last two coords in all forms).
      const x = a[a.length - 2]
      const y = a[a.length - 1]
      if (isNum(x) && isNum(y)) openSub().push({ x, y })
      continue
    }
    if (fn === OP.closePath && OP.closePath !== undefined) {
      const last = cur[cur.length - 1]
      if (last !== undefined) last.closed = true
      continue
    }
    if (fn === OP.rectangle && OP.rectangle !== undefined) {
      const a = readArgs(argsArray[i])
      if (a !== null && isNum(a[0]) && isNum(a[1]) && isNum(a[2]) && isNum(a[3])) {
        const [x, y, w, h] = a as number[]
        cur.push({
          pts: [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
          ],
          closed: true,
        })
      }
      continue
    }
    if (
      (OP.stroke !== undefined && isStrokePaint(fn)) ||
      (OP.fill !== undefined && isFillPaint(fn))
    ) {
      const closeAll = fn === OP.closeStroke || fn === OP.closeFillStroke || fn === OP.closeEOFillStroke
      paint(fn, cur, closeAll)
      cur = []
      continue
    }
    if (fn === OP.endPath || fn === OP.clip || fn === OP.eoClip) {
      // Path consumed without paint (clip regions ignored — limit L3).
      // Branch entry implies a defined-opcode match, so the path is real.
      cur = []
      continue
    }
    // Unknown opcode (text, images, color, marked content, ...): skip.
  }

  const tables = detectGrids(hsegs, vsegs)

  // Rules on grid edges are table borders, not decorations.
  const keptRules = rules.filter((r) => !nearGridEdge(r, tables))
  // De-duplicate (shared cell borders emit twice; B + S double-paint).
  const underlines = dedupeRects(
    keptRules.map((r) => normRect(r.x0, r.y - r.hw, r.x1, r.y + r.hw)),
  )
  const highlights = dedupeRects(fills.filter((f) => isHighlight(f) && !insideGridCell(f, tables)))

  // strikes is ALWAYS empty: without text baselines this module cannot split
  // underline-vs-strike; the caller reclassifies `underlines` per span via
  // classifyHorizontalRule. Returning [] (not guessing) is the contract.
  return { underlines, strikes: [], highlights, tables }
}

function isHighlight(f: PdfRect): boolean {
  const w = f.x1 - f.x0
  const h = f.y1 - f.y0
  if (!(w >= HL_MIN_W)) return false
  if (!(h >= HL_MIN_H && h <= HL_MAX_H)) return false
  return w * h >= HL_MIN_AREA
}

function segGap(a0: number, a1: number, b0: number, b1: number): number {
  if (a1 < b0) return b0 - a1
  if (b1 < a0) return a0 - b1
  return 0
}

/** Segment distance from a horizontal rule to any grid edge (pt). */
function nearGridEdge(r: { x0: number; x1: number; y: number }, tables: PdfTableGrid[]): boolean {
  for (const t of tables) {
    for (const ey of t.rowEdges) {
      const dx = segGap(r.x0, r.x1, t.x0, t.x1)
      if (Math.hypot(dx, r.y - ey) <= GRID_EXCLUDE_DIST) return true
    }
    for (const ex of t.colEdges) {
      const dx = ex < r.x0 ? r.x0 - ex : ex > r.x1 ? ex - r.x1 : 0
      const dy = segGap(r.y, r.y, t.y0, t.y1)
      if (Math.hypot(dx, dy) <= GRID_EXCLUDE_DIST) return true
    }
  }
  return false
}

function insideGridCell(f: PdfRect, tables: PdfTableGrid[]): boolean {
  for (const t of tables) {
    if (f.x0 < t.x0 - CELL_FILL_EXPAND || f.x1 > t.x1 + CELL_FILL_EXPAND) continue
    if (f.y0 < t.y0 - CELL_FILL_EXPAND || f.y1 > t.y1 + CELL_FILL_EXPAND) continue
    for (let c = 0; c + 1 < t.colEdges.length; c++) {
      const cx0 = t.colEdges[c] as number
      const cx1 = t.colEdges[c + 1] as number
      if (f.x0 < cx0 - CELL_FILL_EXPAND || f.x1 > cx1 + CELL_FILL_EXPAND) continue
      for (let rr = 0; rr + 1 < t.rowEdges.length; rr++) {
        const ry0 = t.rowEdges[rr] as number
        const ry1 = t.rowEdges[rr + 1] as number
        if (f.y0 >= ry0 - CELL_FILL_EXPAND && f.y1 <= ry1 + CELL_FILL_EXPAND) return true
      }
    }
  }
  return false
}

function dedupeRects(rects: PdfRect[]): PdfRect[] {
  const seen = new Set<string>()
  const out: PdfRect[] = []
  for (const r of rects) {
    const key = `${Math.round(r.x0 * 2)}:${Math.round(r.y0 * 2)}:${Math.round(r.x1 * 2)}:${Math.round(r.y1 * 2)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/**
 * Grid detection over axis-aligned stroke segments.
 * 1. Connected components (segments within GRID_EDGE_TOL join) — one table
 *    candidate per component, so multi-table pages just work.
 * 2. Cluster vertical x-coords / horizontal y-coords (tolerance GRID_EDGE_TOL).
 * 3. Keep edges spanning >= 90% of the component's full range.
 * 4. Accept iff >= 3 col edges AND >= 3 row edges (i.e. >= 2 cols AND >= 2
 *    rows) AND every row band is crossed top-to-bottom by the FULL col-edge
 *    set AND every column band is crossed side-to-side by the FULL row-edge
 *    set. The crossing checks ARE the "every cell bounded on all four sides"
 *    proof: each band's left/right borders run its full height and each
 *    band's top/bottom borders run its full width.
 * 5. Nested grids: keep the largest, drop contained ones.
 * Multi-column prose has no rulings, so it can never form a component.
 */
function detectGrids(hsegs: HSeg[], vsegs: VSeg[]): PdfTableGrid[] {
  type Seg = { h: boolean; i: number }
  const segs: Seg[] = [
    ...hsegs.map((_, i) => ({ h: true, i })),
    ...vsegs.map((_, i) => ({ h: false, i })),
  ]
  if (segs.length === 0) return []

  const bboxOf = (s: Seg): PdfRect => {
    if (s.h) {
      const g = hsegs[s.i] as HSeg
      return { x0: g.x0, y0: g.y, x1: g.x1, y1: g.y }
    }
    const g = vsegs[s.i] as VSeg
    return { x0: g.x, y0: g.y0, x1: g.x, y1: g.y1 }
  }
  const bboxDist = (a: PdfRect, b: PdfRect): number =>
    Math.hypot(segGap(a.x0, a.x1, b.x0, b.x1), segGap(a.y0, a.y1, b.y0, b.y1))

  // Union-find over segment proximity.
  const parent = segs.map((_, i) => i)
  const find = (x: number): number => {
    let r = x
    while (parent[r] !== r) r = parent[r] as number
    let c = x
    while (parent[c] !== r) {
      const nxt = parent[c] as number
      parent[c] = r
      c = nxt
    }
    return r
  }
  const boxes = segs.map(bboxOf)
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (bboxDist(boxes[i] as PdfRect, boxes[j] as PdfRect) <= GRID_EDGE_TOL) {
        const ri = find(i)
        const rj = find(j)
        if (ri !== rj) parent[ri] = rj
      }
    }
  }
  const comps = new Map<number, number[]>()
  for (let i = 0; i < segs.length; i++) {
    const r = find(i)
    const arr = comps.get(r)
    if (arr !== undefined) arr.push(i)
    else comps.set(r, [i])
  }

  const grids: PdfTableGrid[] = []
  for (const members of comps.values()) {
    const hs: HSeg[] = []
    const vs: VSeg[] = []
    for (const m of members) {
      const s = segs[m] as Seg
      if (s.h) hs.push(hsegs[s.i] as HSeg)
      else vs.push(vsegs[s.i] as VSeg)
    }
    // A 2x2-cell grid needs >= 3 lines per direction; anything less cannot
    // satisfy ">= 2 cols AND >= 2 rows".
    if (hs.length < 3 || vs.length < 3) continue
    const g = tryGrid(hs, vs)
    if (g !== null) grids.push(g)
  }

  // Nested/overlapping grids: keep the largest, drop contained ones.
  grids.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
  const kept: PdfTableGrid[] = []
  for (const g of grids) {
    let contained = false
    for (const k of kept) {
      if (
        g.x0 >= k.x0 - GRID_EDGE_TOL &&
        g.x1 <= k.x1 + GRID_EDGE_TOL &&
        g.y0 >= k.y0 - GRID_EDGE_TOL &&
        g.y1 <= k.y1 + GRID_EDGE_TOL
      ) {
        contained = true
        break
      }
    }
    if (!contained) kept.push(g)
  }
  return kept
}

function clusterSorted(vals: number[], tol: number): number[] {
  const sorted = [...vals].sort((a, b) => a - b)
  const out: number[] = []
  let acc: number[] = []
  for (const v of sorted) {
    if (acc.length === 0 || v - (acc[acc.length - 1] as number) <= tol) {
      acc.push(v)
    } else {
      out.push(median(acc))
      acc = [v]
    }
  }
  if (acc.length > 0) out.push(median(acc))
  return out
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

/** Total covered length of sorted [lo,hi] intervals merged with `tol` slack. */
function coverage(intervals: Array<[number, number]>, tol: number): number {
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let cs = sorted[0]?.[0] as number
  let ce = sorted[0]?.[1] as number
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i] as [number, number]
    if (s <= ce + tol) {
      if (e > ce) ce = e
    } else {
      total += ce - cs
      cs = s
      ce = e
    }
  }
  return total + (ce - cs)
}

function tryGrid(hs: HSeg[], vs: VSeg[]): PdfTableGrid | null {
  let gx0 = Infinity
  let gx1 = -Infinity
  let gy0 = Infinity
  let gy1 = -Infinity
  for (const s of hs) {
    if (s.x0 < gx0) gx0 = s.x0
    if (s.x1 > gx1) gx1 = s.x1
    if (s.y < gy0) gy0 = s.y
    if (s.y > gy1) gy1 = s.y
  }
  for (const s of vs) {
    if (s.x < gx0) gx0 = s.x
    if (s.x > gx1) gx1 = s.x
    if (s.y0 < gy0) gy0 = s.y0
    if (s.y1 > gy1) gy1 = s.y1
  }
  const spanX = gx1 - gx0
  const spanY = gy1 - gy0
  if (!(spanX > 0) || !(spanY > 0)) return null

  const colCandidates = clusterSorted(
    vs.map((s) => s.x),
    GRID_EDGE_TOL,
  )
  const rowCandidates = clusterSorted(
    hs.map((s) => s.y),
    GRID_EDGE_TOL,
  )

  // Keep edges spanning >= 90% of the common range.
  const colEdges = colCandidates.filter((x) => {
    const iv = vs.filter((s) => Math.abs(s.x - x) <= GRID_EDGE_TOL).map((s) => [s.y0, s.y1] as [number, number])
    return coverage(iv, GRID_EDGE_TOL) / spanY >= GRID_SPAN_COVER
  })
  const rowEdges = rowCandidates.filter((y) => {
    const iv = hs.filter((s) => Math.abs(s.y - y) <= GRID_EDGE_TOL).map((s) => [s.x0, s.x1] as [number, number])
    return coverage(iv, GRID_EDGE_TOL) / spanX >= GRID_SPAN_COVER
  })
  if (colEdges.length < 3 || rowEdges.length < 3) return null
  colEdges.sort((a, b) => a - b)
  rowEdges.sort((a, b) => a - b)

  // Uniformity = boundedness: each row band crossed by the FULL col set at
  // its middle, each column band crossed by the FULL row set at its middle.
  // Crossing coords are clustered first: shared cell borders are painted once
  // per adjacent cell, so interior edges legitimately appear twice.
  for (let r = 0; r + 1 < rowEdges.length; r++) {
    const mid = ((rowEdges[r] as number) + (rowEdges[r + 1] as number)) / 2
    const crossing = vs.filter((s) => s.y0 <= mid + GRID_EDGE_TOL && s.y1 >= mid - GRID_EDGE_TOL)
    if (!coversSet(clusterSorted(crossing.map((s) => s.x), GRID_EDGE_TOL), colEdges)) return null
  }
  for (let c = 0; c + 1 < colEdges.length; c++) {
    const mid = ((colEdges[c] as number) + (colEdges[c + 1] as number)) / 2
    const crossing = hs.filter((s) => s.x0 <= mid + GRID_EDGE_TOL && s.x1 >= mid - GRID_EDGE_TOL)
    if (!coversSet(clusterSorted(crossing.map((s) => s.y), GRID_EDGE_TOL), rowEdges)) return null
  }

  return {
    x0: colEdges[0] as number,
    y0: rowEdges[0] as number,
    x1: colEdges[colEdges.length - 1] as number,
    y1: rowEdges[rowEdges.length - 1] as number,
    cols: colEdges.length - 1,
    rows: rowEdges.length - 1,
    colEdges,
    rowEdges,
  }
}

/**
 * Do `vals` cover every edge in `edges` 1:1 (same count, each within tol)?
 * Count equality is the uniformity proof: no missing borders, no extras.
 */
function coversSet(vals: number[], edges: number[]): boolean {
  if (vals.length !== edges.length) return false
  const sorted = [...vals].sort((a, b) => a - b)
  for (let i = 0; i < edges.length; i++) {
    if (Math.abs((sorted[i] as number) - (edges[i] as number)) > GRID_EDGE_TOL) return false
  }
  return true
}
