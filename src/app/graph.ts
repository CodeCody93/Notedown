/**
 * Notedown — pure graph tag parser + renderer (graphs packet 1/3).
 *
 * Parses single-line `%% ... %%` graph tags into a {@link GraphSpec} and
 * renders that spec to standalone HTML, error HTML, or plain-text fallback.
 *
 * This module is PURE: no DOM/window access, no markdown-it import, no
 * dependencies. The HTML it returns is already escaped via
 * {@link escapeGraphHtml}, but callers that inject it into the preview pane
 * or an export document must still pass the final document through DOMPurify
 * (markdown-it runs with `html: true` — see `src/app/export.ts`).
 *
 * Locked syntax (user-approved):
 * - `%% pie "Title" (label, value)... %%` — 1+ points
 * - `%% bar "Title" "Y-label" [min N max M] (label, value)... %%` (no x param)
 * - `%% line "Title" (Xname, x…) (Yname[, min][, max]) (Series, values…)… %%`
 *   Line charts use axis/series groups: the X group names the axis + point
 *   names (axis-only auto-labels slots 1..N), the Y group names the axis with
 *   optional bounds (a lone number is the max), and each series group carries
 *   one value per x position. Points group by series (first-seen order);
 *   missing combos leave gaps.
 *
 * Leading-label heuristic, pie/bar only (deterministic):
 * - 1 leading label → title
 * - 2 leading labels → pie: xLabel, yLabel (title stays ''); bar: title, yLabel
 * - 3 leading labels → pie only: title, xLabel, yLabel
 * `min`/`max` header keywords are Y-only, optional, bar only (pie silently
 * ignores them; line bounds live in its Y group). X is categorical labels.
 *
 * CLASS-NAME CONTRACT (packets 2/3 depend on these exact names — DO NOT rename):
 * - `md-graph`, `md-graph-pie` | `md-graph-bar` | `md-graph-line` (on <figure>)
 * - `md-graph-title` (<figcaption>, only when title non-empty)
 * - `md-graph-axis`, `md-graph-x`, `md-graph-y` (axis label divs)
 * - `md-graph-chart` (chart div, always carries `style="--count:N"`);
 *   success chart divs add a modifier alongside it: `md-graph-chart-pie`
 *   (pie) or `md-graph-chart-plot` (bar/line — line keeps its existing
 *   `md-graph-plot md-graph-line-plot` inner div untouched). Error/empty
 *   chart divs (`--count:0`, pie zero-total) carry the bare `md-graph-chart`
 *   with no modifier.
 * - `md-graph-pie` (conic-gradient div), `md-graph-legend`, `md-graph-swatch`
  * - `md-graph-plot` (bar value grid: bars row over tick row, carries
  *   `--count`, `data-min`/`data-max` for the CSS scale labels), `md-graph-bar`
  *   (`--v` percent height, `--c` slice color), `md-graph-tick`
  * - `md-graph-plot md-graph-line-plot` > `md-graph-line-area`: overlaid
  *   `--c`-colored `md-graph-seg` bands (full-area clip-path `--x1/--y1` →
  *   `--x2/--y2`), `md-graph-dot` points (`--x/--y`, `--c`), `md-graph-xlab`
  *   point labels (`--x`, `--edge` 0/0.5/1 edge alignment); legend is
  *   `md-graph-legend md-graph-line-legend` after the chart
 * - `md-graph-data` (accessible fallback <table>), `md-graph-error` (error div)
 */

export type GraphType = 'pie' | 'bar' | 'line'

export interface GraphPoint {
  label: string
  value: number
  /**
   * Line-chart series name. Pie/bar points leave this undefined (unused).
   * Line pairs `(series, y)` auto-assign x slots; triples `(series, x, y)`
   * pin explicit x labels.
   */
  series?: string
}

export interface GraphSpec {
  type: GraphType
  title: string
  xLabel: string
  yLabel: string
  min?: number
  max?: number
  points: GraphPoint[]
}

export interface GraphParseOk {
  ok: true
  spec: GraphSpec
}

export interface GraphParseErr {
  ok: false
  error: string
}

export type GraphParseResult = GraphParseOk | GraphParseErr

type TokenKind = 'word' | 'number' | 'quoted' | 'lparen' | 'rparen' | 'comma'

interface Token {
  kind: TokenKind
  /** Unescaped text for quoted strings, literal source text otherwise. */
  text: string
  /** Numeric value for number tokens, 0 otherwise. */
  num: number
}

/**
 * Tokenize the inside of a `%% ... %%` tag. Handles double-quoted strings
 * (a backslash escapes the next char literally, so `\"` → `"` and `\\`
 * → `\`), bare words (runs of non-space, non-paren, non-comma, non-dquote
 * chars), parens/commas, and numbers (`Number()` + finite check — so `-5`,
 * `1e3`, `0.5` all count as numbers). `min`/`max` stay plain words here;
 * the parser treats them as keywords (case-insensitive) in header position.
 */
function tokenize(src: string): { tokens: Token[]; error?: string } {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      i++
      continue
    }
    if (c === '(' || c === ')' || c === ',') {
      const kind: TokenKind = c === '(' ? 'lparen' : c === ')' ? 'rparen' : 'comma'
      tokens.push({ kind, text: c, num: 0 })
      i++
      continue
    }
    if (c === '"') {
      let out = ''
      let j = i + 1
      let closed = false
      while (j < src.length) {
        const d = src[j]
        if (d === '\\' && j + 1 < src.length) {
          out += src[j + 1]
          j += 2
          continue
        }
        if (d === '"') {
          closed = true
          j++
          break
        }
        out += d
        j++
      }
      if (!closed) return { tokens, error: 'Unterminated string. Expected a closing `"`. ' }
      tokens.push({ kind: 'quoted', text: out, num: 0 })
      i = j
      continue
    }
    let j = i
    while (j < src.length) {
      const d = src[j]
      if (d === ' ' || d === '\t' || d === '\n' || d === '\r' || d === '\f' || d === '\v') break
      if (d === '(' || d === ')' || d === ',' || d === '"') break
      j++
    }
    const raw = src.slice(i, j)
    const n = Number(raw)
    if (raw !== '' && Number.isFinite(n)) tokens.push({ kind: 'number', text: raw, num: n })
    else tokens.push({ kind: 'word', text: raw, num: 0 })
    i = j
  }
  return { tokens }
}

/**
 * Parse the trimmed text BETWEEN the `%%` delimiters into a {@link GraphSpec}.
 *
 * Type keyword is case-insensitive. Tuple labels may be quoted or bare (a
 * bare number is kept as its literal text, e.g. `(2024, 100)` → `'2024'`);
 * tuple values may be quoted or bare but must satisfy `Number()` + finite.
 * `min`/`max` (bare, case-insensitive, header position only — a quoted
 * `"min"` is a plain label) each consume one following number; a pie tag
 * with min/max parses fine and the range is dropped from the spec.
 * Leading-label mapping (pie/bar): pie uses 1→title / 2→x,y / 3→title,x,y,
 * while bar takes at most 2 (1→title, 2→title+y — bars have no x-axis
 * parameter). Line charts skip header labels entirely and use the
 * axis/series group grammar (see parseLineTag).
 */
export function parseGraphTag(inner: string): GraphParseResult {
  const fail = (error: string): GraphParseErr => ({ ok: false, error })
  const { tokens, error } = tokenize(inner)
  if (error !== undefined) return fail(error)
  if (tokens.length === 0) {
    return fail('Empty graph tag. Expected e.g. `pie "Title" (A, 1) (B, 2)`.')
  }
  const head = tokens[0]
  const headLower = head.text.toLowerCase()
  const isType =
    (head.kind === 'word' || head.kind === 'number') &&
    (headLower === 'pie' || headLower === 'bar' || headLower === 'line')
  if (!isType) {
    const shown = head.kind === 'quoted' ? `"${head.text}"` : head.text
    return fail(`Unknown graph type "${shown}". Expected pie, bar or line.`)
  }
  const type = headLower as GraphType

  // Line charts use axis/series groups (not bare header labels):
  // %% line "Title" (Xname, x…) (Yname, min, max) (Series, values…) %%.
  if (type === 'line') return parseLineTag(tokens)

  // Header: leading labels + min/max, up to the first '('.
  let pos = 1
  const labels: string[] = []
  let min: number | undefined
  let max: number | undefined
  while (pos < tokens.length && tokens[pos].kind !== 'lparen') {
    const t = tokens[pos]
    if (t.kind === 'word' && (t.text.toLowerCase() === 'min' || t.text.toLowerCase() === 'max')) {
      const key = t.text.toLowerCase()
      const nxt = tokens[pos + 1]
      if (nxt === undefined || (nxt.kind !== 'number' && nxt.kind !== 'word' && nxt.kind !== 'quoted')) {
        return fail(`Expected a number after "${key}".`)
      }
      const v = nxt.kind === 'number' ? nxt.num : Number(nxt.text)
      if (!Number.isFinite(v)) return fail(`Invalid ${key} value "${nxt.text}". Expected a finite number.`)
      if (key === 'min') min = v
      else max = v
      pos += 2
      continue
    }
    if (t.kind === 'quoted' || t.kind === 'word' || t.kind === 'number') {
      // Bar charts only take a title + y-axis label (no x-axis parameter),
      // so they cap at 2 leading labels; pie takes 3. (Line returns early
      // above with its own group grammar.)
      const maxLabels = type === 'bar' ? 2 : 3
      if (labels.length >= maxLabels) {
        return fail(
          type === 'bar'
            ? 'Too many labels before data points. Bar charts accept at most 2 (title, y-label).'
            : 'Too many labels before data points. Expected at most 3 (title, x-label, y-label).'
        )
      }
      labels.push(t.text)
      pos++
      continue
    }
    return fail(`Unexpected "${t.text}" before data points. Expected a label, min/max, or "(label, value)".`)
  }

  // Tuples: pie/bar take exactly `(label, value)`.
  const points: GraphPoint[] = []
  while (pos < tokens.length) {
    const open = tokens[pos]
    if (open.kind !== 'lparen') {
      return fail(`Unexpected "${open.text}". Expected "(label, value)".`)
    }
    pos++
    // Collect the comma-separated elements up to ")".
    const elems: Token[] = []
    for (;;) {
      const el = tokens[pos]
      if (el === undefined) return fail('Unterminated "(". Expected ")" to close the point.')
      if (el.kind === 'rparen') {
        pos++
        break
      }
      if (el.kind !== 'quoted' && el.kind !== 'word' && el.kind !== 'number') {
        return fail(`Unexpected "${el.text}" inside point. Expected a label, number or ")".`)
      }
      elems.push(el)
      pos++
      const sep = tokens[pos]
      if (sep === undefined) return fail('Unterminated "(". Expected ")" to close the point.')
      if (sep.kind === 'comma') {
        pos++
        continue
      }
      if (sep.kind === 'rparen') {
        pos++
        break
      }
      return fail(`Unexpected "${sep.text}" inside point. Expected "," or ")".`)
    }
    const finiteNum = (t: Token): number => (t.kind === 'number' ? t.num : Number(t.text))
    if (elems.length !== 2) {
      return fail(`Expected "(label, value)" — found ${elems.length} values.`)
    }
    const label = elems[0].text
    const value = finiteNum(elems[1])
    if (!Number.isFinite(value)) {
      return fail(`Invalid value "${elems[1].text}" for label "${label}". Expected a finite number.`)
    }
    points.push({ label, value })
  }

  if (points.length === 0) {
    return fail('No data points. Expected at least one "(label, value)" pair.')
  }
  if (min !== undefined && max !== undefined && min >= max) {
    return fail(`Invalid range: min (${String(min)}) must be less than max (${String(max)}).`)
  }

  let title = ''
  let xLabel = ''
  let yLabel = ''
  if (type === 'bar') {
    // No x-axis parameter on bars: 1 label is the title, 2 are title + y.
    if (labels.length === 1) title = labels[0]
    else if (labels.length === 2) {
      title = labels[0]
      yLabel = labels[1]
    }
  } else if (labels.length === 1) title = labels[0]
  else if (labels.length === 2) {
    xLabel = labels[0]
    yLabel = labels[1]
  } else if (labels.length === 3) {
    title = labels[0]
    xLabel = labels[1]
    yLabel = labels[2]
  }
  const spec: GraphSpec = { type, title, xLabel, yLabel, points }
  if (type !== 'pie') {
    if (min !== undefined) spec.min = min
    if (max !== undefined) spec.max = max
  }
  return { ok: true, spec }
}

const LINE_USAGE =
  'Expected %% line "Title" (Xname, x…) (Yname, min, max) (Series, values…) %%.'

/**
 * Line-chart group grammar (user-approved restructure):
 * - Optional title: one quoted/word/number token (skipped when `(` follows).
 * - X group (required): `(Xname, x1, x2, …)` — axis name + point names. An
 *   axis-only `(Xname)` group auto-labels slots 1..N from the series lengths.
 * - Y group (required): `(Yname[, min][, max])` — axis name with optional
 *   bounds; a lone number is the max (min auto-scales).
 * - Series groups (≥1 required): `(Series, v1, v2, …)` — every value must be
 *   finite and every series must carry exactly one value per x position.
 *   Duplicate series names are rejected.
 */
function parseLineTag(tokens: Token[]): GraphParseResult {
  const fail = (error: string): GraphParseErr => ({ ok: false, error })
  let pos = 1 // skip the `line` keyword
  // Collect one `(…)` group into element tokens (caller validates arity).
  const readGroup = (what: string): { elems: Token[] } | { error: string } => {
    const l = tokens[pos]
    if (l === undefined || l.kind !== 'lparen') {
      return { error: `Expected ${what} group "(…)". ${LINE_USAGE}` }
    }
    pos++
    const elems: Token[] = []
    for (;;) {
      const el = tokens[pos]
      if (el === undefined) return { error: `Unterminated "(". ${LINE_USAGE}` }
      if (el.kind === 'rparen') {
        pos++
        break
      }
      if (el.kind !== 'quoted' && el.kind !== 'word' && el.kind !== 'number') {
        return { error: `Unexpected "${el.text}" inside ${what} group. ${LINE_USAGE}` }
      }
      elems.push(el)
      pos++
      const sep = tokens[pos]
      if (sep === undefined) return { error: `Unterminated "(". ${LINE_USAGE}` }
      if (sep.kind === 'comma') {
        pos++
        continue
      }
      if (sep.kind === 'rparen') {
        pos++
        break
      }
      return { error: `Unexpected "${sep.text}" inside ${what} group. Expected "," or ")".` }
    }
    return { elems }
  }

  let title = ''
  const t0 = tokens[pos]
  if (t0 !== undefined && t0.kind !== 'lparen') {
    if (t0.kind !== 'quoted' && t0.kind !== 'word' && t0.kind !== 'number') {
      return fail(`Unexpected "${t0.text}". ${LINE_USAGE}`)
    }
    title = t0.text
    pos++
  }

  const xg = readGroup('X axis')
  if ('error' in xg) return fail(xg.error)
  if (xg.elems.length === 0) return fail(`Empty X axis group. ${LINE_USAGE}`)
  const xLabel = xg.elems[0].text
  const xNames = xg.elems.slice(1).map((t) => t.text)

  const yg = readGroup('Y axis')
  if ('error' in yg) return fail(yg.error)
  if (yg.elems.length === 0) return fail(`Empty Y axis group. ${LINE_USAGE}`)
  const yLabel = yg.elems[0].text
  const boundTexts = yg.elems.slice(1)
  if (boundTexts.length > 2) return fail(`Y axis group takes at most "(Yname, min, max)". ${LINE_USAGE}`)
  const boundVals = boundTexts.map((t) => (t.kind === 'number' ? t.num : Number(t.text)))
  if (boundVals.some((v) => !Number.isFinite(v))) {
    return fail(`Y axis bounds must be finite numbers. ${LINE_USAGE}`)
  }
  let min: number | undefined
  let max: number | undefined
  if (boundVals.length === 1) max = boundVals[0]
  else if (boundVals.length === 2) {
    min = boundVals[0]
    max = boundVals[1]
  }
  if (min !== undefined && max !== undefined && min >= max) {
    return fail(`Invalid range: min (${String(min)}) must be less than max (${String(max)}).`)
  }

  interface LineSeries {
    name: string
    values: number[]
  }
  const series: LineSeries[] = []
  const seenSeries = new Set<string>()
  while (pos < tokens.length) {
    const g = readGroup('series')
    if ('error' in g) return fail(g.error)
    if (g.elems.length < 2) {
      return fail(`Series groups need a name and at least one value, e.g. "(SiteA, 50, 60)". ${LINE_USAGE}`)
    }
    const name = g.elems[0].text
    if (seenSeries.has(name)) return fail(`Duplicate series "${name}".`)
    seenSeries.add(name)
    const values: number[] = []
    for (let k = 1; k < g.elems.length; k++) {
      const t = g.elems[k]
      const v = t.kind === 'number' ? t.num : Number(t.text)
      if (!Number.isFinite(v)) {
        return fail(`Invalid value "${t.text}" in series "${name}" (position ${k}). Expected a finite number.`)
      }
      values.push(v)
    }
    series.push({ name, values })
  }
  if (series.length === 0) {
    return fail(`Line graphs need at least one "(Series, values…)" group. ${LINE_USAGE}`)
  }
  const n = xNames.length > 0 ? xNames.length : series[0].values.length
  if (n < 2) return fail('Line graphs need at least 2 x positions.')
  for (const s of series) {
    if (s.values.length !== n) {
      return fail(`Series "${s.name}" has ${s.values.length} values but there are ${n} x positions.`)
    }
  }
  const labels = xNames.length > 0 ? xNames : series[0].values.map((_, i) => String(i + 1))
  const points: GraphPoint[] = []
  for (const s of series) {
    s.values.forEach((value, i) => points.push({ label: labels[i], value, series: s.name }))
  }
  const spec: GraphSpec = { type: 'line', title, xLabel, yLabel, points }
  if (min !== undefined) spec.min = min
  if (max !== undefined) spec.max = max
  return { ok: true, spec }
}

/** Escape the five HTML-significant characters (`& < > " '`). */
export function escapeGraphHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Palette color for slice `i` of `n`: `hsl(H, 65%, 55%)`, H = i*360/n. */
function pieColor(i: number, n: number): string {
  const h = n === 0 ? 0 : (i * 360) / n
  const hs = Number.isInteger(h) ? String(h) : h.toFixed(1)
  return `hsl(${hs}, 65%, 55%)`
}

/** Normalize a Y value to 0..100 against [lo, hi]; hi === lo maps to 100. */
function normPct(value: number, lo: number, hi: number): number {
  if (hi === lo) return 100
  const p = ((value - lo) / (hi - lo)) * 100
  if (p < 0) return 0
  if (p > 100) return 100
  return p
}

/**
 * Y range for bar/line: explicit spec.min/max win, otherwise
 * autoMin = Math.min(0, min(points)) and autoMax = max(points).
 */
function rangeOf(spec: GraphSpec): { lo: number; hi: number } {
  const vals = spec.points.map((p) => p.value)
  return {
    lo: spec.min ?? Math.min(0, ...vals),
    hi: spec.max ?? Math.max(...vals),
  }
}

function pieChartHtml(spec: GraphSpec): string {
  const n = spec.points.length
  // Negative slices would run the conic gradient backwards (invalid CSS),
  // so clamp them to 0 for the geometry; legend cells keep raw values.
  const vals = spec.points.map((p) => (p.value < 0 ? 0 : p.value))
  const total = vals.reduce((a, b) => a + b, 0)
  if (!(total > 0)) {
    return `<div class="md-graph-chart" style="--count:${n}"><div class="md-graph-error" role="note"><strong>Graph error:</strong> Pie values must add up to more than 0.</div></div>`
  }
  let acc = 0
  const stops: string[] = []
  const items: string[] = []
  spec.points.forEach((p, i) => {
    const color = pieColor(i, n)
    const start = (acc / total) * 100
    acc += vals[i]
    const end = (acc / total) * 100
    stops.push(`${color} ${start.toFixed(1)}% ${end.toFixed(1)}%`)
    const pct = (vals[i] / total) * 100
    const label = escapeGraphHtml(p.label)
    const val = escapeGraphHtml(String(p.value))
    items.push(
      `<li data-label="${label}" data-value="${val}" style="--c:${color};--p:${pct.toFixed(1)}%"><span class="md-graph-swatch"></span>${label} — ${val} (${pct.toFixed(1)}%)</li>`
    )
  })
  return `<div class="md-graph-chart md-graph-chart-pie" style="--count:${n}"><div class="md-graph-pie" style="background: conic-gradient(${stops.join(', ')})"></div><ul class="md-graph-legend">${items.join('')}</ul></div>`
}

/** Compact number formatting for data-min/data-max attributes. */
function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100)
}

function barChartHtml(spec: GraphSpec, yHtml: string): string {
  const n = spec.points.length
  const { lo, hi } = rangeOf(spec)
  // Flat grid children (bars then ticks): the plot is a 2-row grid
  // (bars row over tick row), so heights are true percentages of the row.
  // Each bar gets its own palette color (--c), like pie slices.
  const bars = spec.points.map((p, i) => {
    const pct = normPct(p.value, lo, hi)
    const label = escapeGraphHtml(p.label)
    const val = escapeGraphHtml(String(p.value))
    const color = pieColor(i, n)
    return `<div class="md-graph-bar" style="--v:${pct.toFixed(1)}%;--c:${color}" data-label="${label}" data-value="${val}" title="${label}: ${val}"></div>`
  })
  const ticks = spec.points.map(
    (p) => `<span class="md-graph-tick">${escapeGraphHtml(p.label)}</span>`
  )
  return `<div class="md-graph-chart md-graph-chart-plot" style="--count:${n}">${yHtml}<div class="md-graph-plot" style="--count:${n}" data-min="${fmtNum(lo)}" data-max="${fmtNum(hi)}">${bars.join('')}${ticks.join('')}</div></div>`
}

function lineChartHtml(spec: GraphSpec, yHtml: string, xHtml: string): string {
  const n = spec.points.length
  const { lo, hi } = rangeOf(spec)
  // Group points into series (first-seen order). X slots are the union of
  // point labels in first-seen order; a missing (series, slot) combo leaves
  // a gap — segments only join consecutive present slots, never bridging one.
  const seriesOrder: string[] = []
  const bySeries = new Map<string, Map<string, number>>()
  for (const p of spec.points) {
    const s = p.series ?? ''
    let m = bySeries.get(s)
    if (m === undefined) {
      m = new Map<string, number>()
      bySeries.set(s, m)
      seriesOrder.push(s)
    }
    if (!m.has(p.label)) m.set(p.label, p.value)
  }
  const slots: string[] = []
  for (const p of spec.points) {
    if (!slots.includes(p.label)) slots.push(p.label)
  }
  const xOf = (slot: number): number => (slots.length === 1 ? 50 : (slot / (slots.length - 1)) * 100)
  const yOf = (v: number): number => normPct(v, lo, hi)
  // Segments overlay the whole area (each clips its own slanted band), dots
  // render on top of them, x labels anchor underneath. Color is per-series,
  // shared by a series' dots, segments and legend entry.
  const segs: string[] = []
  const dots: string[] = []
  seriesOrder.forEach((s, si) => {
    const color = pieColor(si, seriesOrder.length)
    const m = bySeries.get(s) as Map<string, number>
    const sEsc = escapeGraphHtml(s)
    let prev: { i: number; y: number } | undefined
    slots.forEach((slot, i) => {
      const v = m.get(slot)
      if (v === undefined) {
        prev = undefined
        return
      }
      const x = xOf(i)
      const y = yOf(v)
      const val = escapeGraphHtml(String(v))
      const lab = escapeGraphHtml(slot)
      dots.push(
        `<span class="md-graph-dot" style="--x:${x.toFixed(1)}%;--y:${y.toFixed(1)}%;--c:${color}" data-label="${sEsc}" data-value="${val}" title="${sEsc} · ${lab}: ${val}"></span>`
      )
      if (prev !== undefined) {
        const a = prev
        segs.push(
          `<div class="md-graph-seg" style="--x1:${xOf(a.i).toFixed(1)}%;--y1:${a.y.toFixed(1)}%;--x2:${x.toFixed(1)}%;--y2:${y.toFixed(1)}%;--c:${color}"></div>`
        )
      }
      prev = { i, y }
    })
  })
  const xlabs = slots.map((slot, i) => {
    const edge = i === 0 ? 0 : i === slots.length - 1 ? 1 : 0.5
    return `<span class="md-graph-xlab" style="--x:${xOf(i).toFixed(1)}%;--edge:${edge}">${escapeGraphHtml(slot)}</span>`
  })
  const legend = seriesOrder.map((s, si) => {
    const color = pieColor(si, seriesOrder.length)
    const name =
      s !== '' ? s : spec.yLabel !== '' ? spec.yLabel : spec.title !== '' ? spec.title : 'Series 1'
    return `<li data-series="${escapeGraphHtml(s)}" style="--c:${color}"><span class="md-graph-swatch"></span>${escapeGraphHtml(name)}</li>`
  })
  // X-axis name sits directly under the day-name row (centered, like the
  // y-axis name hugs its axis) with the series legend below it.
  return `<div class="md-graph-chart md-graph-chart-plot" style="--count:${n}">${yHtml}<div class="md-graph-plot md-graph-line-plot" style="--count:${n}" data-min="${fmtNum(lo)}" data-max="${fmtNum(hi)}"><div class="md-graph-line-area">${segs.join('')}${dots.join('')}${xlabs.join('')}</div></div></div>${xHtml}<ul class="md-graph-legend md-graph-line-legend">${legend.join('')}</ul>`
}

/** Accessible data-table fallback (caption = title, else `<type> chart data`). */
function dataTableHtml(spec: GraphSpec): string {
  const caption = spec.title !== '' ? spec.title : `${spec.type} chart data`
  const rows = spec.points
    .map((p) => `<tr><td>${escapeGraphHtml(p.label)}</td><td>${escapeGraphHtml(String(p.value))}</td></tr>`)
    .join('')
  return `<table class="md-graph-data"><caption>${escapeGraphHtml(caption)}</caption><thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead><tbody>${rows}</tbody></table>`
}

/**
 * Render a spec to a `<figure class="md-graph md-graph-{type}">` string.
 * Carries `data-graph` (escaped JSON of the spec) for packet 2/3 enhancers,
 * optional title/axis divs, the per-type chart div, and the fallback table.
 * Percentages render with 1 decimal; values render raw via `String(value)`.
 */
export function graphToHtml(spec: GraphSpec): string {
  const n = spec.points.length
  const dataJson = escapeGraphHtml(
    JSON.stringify({
      type: spec.type,
      title: spec.title,
      xLabel: spec.xLabel,
      yLabel: spec.yLabel,
      min: spec.min,
      max: spec.max,
      points: spec.points,
    })
  )
  const open = `<figure class="md-graph md-graph-${spec.type}" data-graph="${dataJson}">`
  const titleHtml =
    spec.title !== '' ? `<figcaption class="md-graph-title">${escapeGraphHtml(spec.title)}</figcaption>` : ''
  const yHtml =
    spec.yLabel !== '' ? `<div class="md-graph-axis md-graph-y">${escapeGraphHtml(spec.yLabel)}</div>` : ''
  const xHtml =
    spec.xLabel !== '' ? `<div class="md-graph-axis md-graph-x">${escapeGraphHtml(spec.xLabel)}</div>` : ''
  let chart: string
  if (n === 0) {
    chart = `<div class="md-graph-chart" style="--count:0"><div class="md-graph-error" role="note"><strong>Graph error:</strong> No data points.</div></div>`
    return `${open}${titleHtml}${yHtml}${chart}${xHtml}${dataTableHtml(spec)}</figure>`
  }
  // Bar and line carry the y-axis label INSIDE the chart (vertical gutter),
  // so only the title sits above it. Pie keeps the label above the chart.
  if (spec.type === 'bar') {
    return `${open}${titleHtml}${barChartHtml(spec, yHtml)}${xHtml}${dataTableHtml(spec)}</figure>`
  } else if (spec.type === 'line') {
    return `${open}${titleHtml}${lineChartHtml(spec, yHtml, xHtml)}${dataTableHtml(spec)}</figure>`
  } else {
    chart = pieChartHtml(spec)
  }
  return `${open}${titleHtml}${yHtml}${chart}${xHtml}${dataTableHtml(spec)}</figure>`
}

/** Render a parse failure inline: escaped message plus escaped raw tag text. */
export function graphToErrorHtml(message: string, raw: string): string {
  return `<div class="md-graph-error" role="note"><strong>Graph error:</strong> ${escapeGraphHtml(message)}<pre>${escapeGraphHtml(raw)}</pre></div>`
}

/**
 * Plain-text fallback for the TXT/RTF/DOCX/PDF converters, e.g.
 * `Sales (bar): Jan=120, Feb=200` (title omitted when empty → `bar: …`).
 * Line charts group by series:
 * `Traffic (line): SiteA: Mon=120, Tue=200; SiteB: Mon=150`.
 */
export function graphToTextFallback(spec: GraphSpec): string {
  const head = spec.title !== '' ? `${spec.title} (${spec.type})` : spec.type
  if (spec.type === 'line') {
    const order: string[] = []
    const bySeries = new Map<string, string[]>()
    for (const p of spec.points) {
      const s = p.series ?? ''
      let arr = bySeries.get(s)
      if (arr === undefined) {
        arr = []
        bySeries.set(s, arr)
        order.push(s)
      }
      arr.push(`${p.label}=${String(p.value)}`)
    }
    const name = (s: string): string =>
      s !== '' ? s : spec.yLabel !== '' ? spec.yLabel : spec.title !== '' ? spec.title : 'Series 1'
    return `${head}: ${order.map((s) => `${name(s)}: ${bySeries.get(s)?.join(', ')}`).join('; ')}`
  }
  const pairs = spec.points.map((p) => `${p.label}=${String(p.value)}`).join(', ')
  return `${head}: ${pairs}`
}
