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
 * - `%% bar ["X-label"] ["Y-label"] [min N max M] (label, value)... %%`
 * - `%% line ["X-label"] ["Y-label"] [min N max M] (label, value)... %%`
 *
 * Leading-label heuristic (deterministic, documented for packet 2/3):
 * - 1 leading label → title
 * - 2 leading labels → xLabel, yLabel (title stays '')
 * - 3 leading labels → title, xLabel, yLabel
 * `min`/`max` are Y-only, optional, bar/line only (pie silently ignores them).
 * X is categorical labels.
 *
 * CLASS-NAME CONTRACT (packets 2/3 depend on these exact names — DO NOT rename):
 * - `md-graph`, `md-graph-pie` | `md-graph-bar` | `md-graph-line` (on <figure>)
 * - `md-graph-title` (<figcaption>, only when title non-empty)
 * - `md-graph-axis`, `md-graph-x`, `md-graph-y` (axis label divs)
 * - `md-graph-chart` (chart div, always carries `style="--count:N"`)
 * - `md-graph-pie` (conic-gradient div), `md-graph-legend`, `md-graph-swatch`
 * - `md-graph-bar-wrap`, `md-graph-bar`, `md-graph-tick`
 * - `md-graph-line-dots`, `md-graph-dot`, `md-graph-line-segs`, `md-graph-seg`
 * - `md-graph-data` (accessible fallback <table>), `md-graph-error` (error div)
 */

export type GraphType = 'pie' | 'bar' | 'line'

export interface GraphPoint {
  label: string
  value: number
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
      if (labels.length >= 3) {
        return fail('Too many labels before data points. Expected at most 3 (title, x-label, y-label).')
      }
      labels.push(t.text)
      pos++
      continue
    }
    return fail(`Unexpected "${t.text}" before data points. Expected a label, min/max, or "(label, value)".`)
  }

  // Tuples: exactly `(label, value)` with one comma, back to back.
  const points: GraphPoint[] = []
  while (pos < tokens.length) {
    const open = tokens[pos]
    if (open.kind !== 'lparen') {
      return fail(`Unexpected "${open.text}". Expected "(label, value)".`)
    }
    pos++
    const lab = tokens[pos]
    if (lab === undefined || (lab.kind !== 'quoted' && lab.kind !== 'word' && lab.kind !== 'number')) {
      return fail('Expected a label after "(".')
    }
    const label = lab.text
    pos++
    const comma = tokens[pos]
    if (comma === undefined || comma.kind !== 'comma') {
      return fail(`Expected "," after label "${label}".`)
    }
    pos++
    const val = tokens[pos]
    if (val === undefined || (val.kind !== 'number' && val.kind !== 'word' && val.kind !== 'quoted')) {
      return fail(`Expected a number after "," for label "${label}".`)
    }
    const value = val.kind === 'number' ? val.num : Number(val.text)
    if (!Number.isFinite(value)) {
      return fail(`Invalid value "${val.text}" for label "${label}". Expected a finite number.`)
    }
    pos++
    const close = tokens[pos]
    if (close === undefined || close.kind !== 'rparen') {
      return fail(`Expected ")" after value for label "${label}".`)
    }
    pos++
    points.push({ label, value })
  }

  if (points.length === 0) {
    return fail('No data points. Expected at least one "(label, value)" pair.')
  }
  if (type === 'line' && points.length < 2) {
    return fail('Line graphs need at least 2 points.')
  }
  if (min !== undefined && max !== undefined && min >= max) {
    return fail(`Invalid range: min (${String(min)}) must be less than max (${String(max)}).`)
  }

  let title = ''
  let xLabel = ''
  let yLabel = ''
  if (labels.length === 1) title = labels[0]
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
  return `<div class="md-graph-chart" style="--count:${n}"><div class="md-graph-pie" style="background: conic-gradient(${stops.join(', ')})"></div><ul class="md-graph-legend">${items.join('')}</ul></div>`
}

function barChartHtml(spec: GraphSpec): string {
  const n = spec.points.length
  const { lo, hi } = rangeOf(spec)
  const bars = spec.points.map((p) => {
    const pct = normPct(p.value, lo, hi)
    const label = escapeGraphHtml(p.label)
    const val = escapeGraphHtml(String(p.value))
    return `<div class="md-graph-bar-wrap"><div class="md-graph-bar" style="--v:${pct.toFixed(1)}%" data-label="${label}" data-value="${val}" title="${label}: ${val}"></div><span class="md-graph-tick">${label}</span></div>`
  })
  return `<div class="md-graph-chart" style="--count:${n}">${bars.join('')}</div>`
}

function lineChartHtml(spec: GraphSpec): string {
  const n = spec.points.length
  const { lo, hi } = rangeOf(spec)
  const posOf = (i: number): { x: number; y: number } => ({
    x: n === 1 ? 50 : (i / (n - 1)) * 100,
    y: normPct(spec.points[i].value, lo, hi),
  })
  const dots = spec.points.map((p, i) => {
    const { x, y } = posOf(i)
    const label = escapeGraphHtml(p.label)
    const val = escapeGraphHtml(String(p.value))
    return `<span class="md-graph-dot" style="--x:${x.toFixed(1)}%;--y:${y.toFixed(1)}%;--i:${i}" data-label="${label}" data-value="${val}" title="${label}: ${val}"></span>`
  })
  const segs: string[] = []
  for (let i = 1; i < n; i++) {
    const a = posOf(i - 1)
    const b = posOf(i)
    segs.push(
      `<div class="md-graph-seg" style="--x1:${a.x.toFixed(1)}%;--y1:${a.y.toFixed(1)}%;--x2:${b.x.toFixed(1)}%;--y2:${b.y.toFixed(1)}%"></div>`
    )
  }
  return `<div class="md-graph-chart" style="--count:${n}"><div class="md-graph-line-dots">${dots.join('')}</div><div class="md-graph-line-segs">${segs.join('')}</div></div>`
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
  } else if (spec.type === 'pie') {
    chart = pieChartHtml(spec)
  } else if (spec.type === 'bar') {
    chart = barChartHtml(spec)
  } else {
    chart = lineChartHtml(spec)
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
 */
export function graphToTextFallback(spec: GraphSpec): string {
  const pairs = spec.points.map((p) => `${p.label}=${String(p.value)}`).join(', ')
  const head = spec.title !== '' ? `${spec.title} (${spec.type})` : spec.type
  return `${head}: ${pairs}`
}
