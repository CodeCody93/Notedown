/**
 * Graph builder modal: a tabbed Pie / Bar / Line form that composes a
 * `%% … %%` graph tag with a live dual preview (rendered figure + tag source).
 *
 * Mirrors the exportDialog.ts pattern: plain DOM (textContent only — the only
 * HTML injection is renderMarkdown() output, which is DOMPurify-sanitized),
 * module-level state (els/refs/wired/isOpen/lastFocused/pending), mountRoot
 * preferring a dedicated root div, Promise-based result with settle(),
 * Escape/backdrop-cancel, Tab trap, and supersede-if-open.
 *
 * Title is shared across tabs (switching tabs resets that tab's rows to its
 * starter but preserves the title). The Insert button stays disabled until
 * the whole form validates AND the generated tag re-parses via parseGraphTag
 * (belt and braces).
 *
 * Package boundary: builder UI only. No FileIO, no invoke() — app wiring
 * calls openGraphBuilder() and inserts the returned tag string.
 */

import { renderMarkdown, MARKDOWN_BODY_CSS } from '../app/export'
import { parseGraphTag } from '../app/graph'

/** Mount-point id added to index.html (`<div id="graph-modal-root">`). */
export const GRAPH_MODAL_ROOT_ID = 'graph-modal-root'

type GraphTab = 'pie' | 'bar' | 'line'

const TABS: GraphTab[] = ['pie', 'bar', 'line']
const TAB_LABELS: Record<GraphTab, string> = { pie: 'Pie', bar: 'Bar', line: 'Line' }

interface LabelValueRow {
  label: string
  value: string
}

interface LineSeriesRow {
  name: string
  values: string[]
}

interface GraphBuilderState {
  tab: GraphTab
  title: string
  pieRows: LabelValueRow[]
  barY: string
  barMin: string
  barMax: string
  barRows: LabelValueRow[]
  lineX: string
  lineSlots: string[]
  lineY: string
  lineMin: string
  lineMax: string
  lineSeries: LineSeriesRow[]
}

interface GraphDialogEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  tabButtons: Record<GraphTab, HTMLButtonElement>
  form: HTMLElement
  errors: HTMLElement
  preview: HTMLElement
  tagCode: HTMLElement
  insertBtn: HTMLButtonElement
  cancelBtn: HTMLButtonElement
}

/** Live input refs for the currently rendered tab (rebuilt by renderForm). */
interface GraphRefs {
  rowLabels: HTMLInputElement[]
  rowValues: HTMLInputElement[]
  barY: HTMLInputElement | null
  barMin: HTMLInputElement | null
  barMax: HTMLInputElement | null
  lineX: HTMLInputElement | null
  slotInputs: HTMLInputElement[]
  lineY: HTMLInputElement | null
  lineMin: HTMLInputElement | null
  lineMax: HTMLInputElement | null
  seriesNames: HTMLInputElement[]
  seriesValues: HTMLInputElement[][]
}

// --- starters (per-tab defaults; title always starts empty) ---

function starterPieRows(): LabelValueRow[] {
  return [
    { label: 'Apples', value: '30' },
    { label: 'Bananas', value: '45' },
  ]
}

function starterBarRows(): LabelValueRow[] {
  return [
    { label: 'Jan', value: '120' },
    { label: 'Feb', value: '200' },
  ]
}

function freshState(): GraphBuilderState {
  return {
    tab: 'pie',
    title: '',
    pieRows: starterPieRows(),
    barY: 'Units',
    barMin: '',
    barMax: '',
    barRows: starterBarRows(),
    lineX: 'Week',
    lineSlots: ['Mon', 'Tue'],
    lineY: 'Hits',
    lineMin: '0',
    lineMax: '100',
    lineSeries: [{ name: 'SiteA', values: ['120', '200'] }],
  }
}

let state: GraphBuilderState = freshState()
let els: GraphDialogEls | null = null
let refs: GraphRefs = emptyRefs()
let isOpen = false
let lastFocused: HTMLElement | null = null
let pending: ((tag: string | null) => void) | null = null
let currentTag = ''

function emptyRefs(): GraphRefs {
  return {
    rowLabels: [],
    rowValues: [],
    barY: null,
    barMin: null,
    barMax: null,
    lineX: null,
    slotInputs: [],
    lineY: null,
    lineMin: null,
    lineMax: null,
    seriesNames: [],
    seriesValues: [],
  }
}

/**
 * Quote a graph label for `%% … %%` source. Local copy of the (unexported)
 * quoteGraphLabel in import.ts: quote when the label would not survive as a
 * bare word (empty, whitespace, comma, paren, dquote) or would lex as a
 * min/max header keyword, with backslash escapes.
 */
function quoteGraphLabel(label: string): string {
  if (label === '' || /[\s,()"]/.test(label) || /^(min|max)$/i.test(label)) {
    return `"${label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return label
}

/** Never throws: prefers #graph-modal-root, falls back to document.body. */
function mountRoot(): HTMLElement {
  return document.getElementById(GRAPH_MODAL_ROOT_ID) ?? document.body
}

// --- DOM builders ---

function makeLabel(text: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'graph-label'
  span.textContent = text
  return span
}

function makeTextInput(value: string, dataK: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'graph-input'
  input.value = value
  input.setAttribute('data-k', dataK)
  return input
}

/** Shared title field (one per tab, all bound to state.title). */
function addTitleField(form: HTMLElement): void {
  const wrap = document.createElement('label')
  wrap.className = 'graph-field'
  const input = makeTextInput(state.title, 'title')
  input.setAttribute('aria-label', 'Graph title')
  wrap.append(makeLabel('Title'), input)
  form.appendChild(wrap)
}

/** Side-by-side name/min/max field row (bar Y group, line Y group). */
function addTriField(
  form: HTMLElement,
  legend: string,
  nameLabel: string,
  nameK: string,
  nameValue: string,
  minK: string,
  minValue: string,
  maxK: string,
  maxValue: string
): { name: HTMLInputElement; min: HTMLInputElement; max: HTMLInputElement } {
  const group = document.createElement('div')
  group.className = 'graph-group'
  const head = document.createElement('span')
  head.className = 'graph-group-label'
  head.textContent = legend
  const row = document.createElement('div')
  row.className = 'graph-field-row'
  const mk = (labelText: string, k: string, value: string): HTMLInputElement => {
    const wrap = document.createElement('label')
    wrap.className = 'graph-field'
    const input = makeTextInput(value, k)
    wrap.append(makeLabel(labelText), input)
    row.appendChild(wrap)
    return input
  }
  const name = mk(nameLabel, nameK, nameValue)
  name.setAttribute('aria-label', nameLabel)
  const min = mk('Min (optional)', minK, minValue)
  min.setAttribute('aria-label', `${legend} minimum (optional)`)
  min.setAttribute('inputmode', 'decimal')
  const max = mk('Max (optional)', maxK, maxValue)
  max.setAttribute('aria-label', `${legend} maximum (optional)`)
  max.setAttribute('inputmode', 'decimal')
  group.append(head, row)
  form.appendChild(group)
  return { name, min, max }
}

/** Label/value row list with add/remove (pie + bar tabs). */
function addLabelValueRows(
  form: HTMLElement,
  kind: 'pie' | 'bar',
  rows: LabelValueRow[],
  out: { labels: HTMLInputElement[]; values: HTMLInputElement[] }
): void {
  const list = document.createElement('div')
  list.className = 'graph-rows'
  rows.forEach((row, i) => {
    const line = document.createElement('div')
    line.className = 'graph-row'
    const labelInput = makeTextInput(row.label, 'rowLabel')
    labelInput.setAttribute('data-kind', kind)
    labelInput.setAttribute('data-i', String(i))
    labelInput.setAttribute('aria-label', `Row ${String(i + 1)} label`)
    labelInput.placeholder = 'Label'
    const valueInput = makeTextInput(row.value, 'rowValue')
    valueInput.setAttribute('data-kind', kind)
    valueInput.setAttribute('data-i', String(i))
    valueInput.setAttribute('aria-label', `Row ${String(i + 1)} value`)
    valueInput.setAttribute('inputmode', 'decimal')
    valueInput.placeholder = 'Value'
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'graph-row-remove'
    remove.setAttribute('data-action', 'remove-row')
    remove.setAttribute('data-kind', kind)
    remove.setAttribute('data-i', String(i))
    remove.textContent = '×'
    remove.title = `Remove row ${String(i + 1)}`
    remove.setAttribute('aria-label', `Remove row ${String(i + 1)}`)
    remove.disabled = rows.length <= 1
    line.append(labelInput, valueInput, remove)
    list.appendChild(line)
    out.labels.push(labelInput)
    out.values.push(valueInput)
  })
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'graph-add'
  add.setAttribute('data-action', 'add-row')
  add.setAttribute('data-kind', kind)
  add.textContent = 'Add row'
  form.append(list, add)
}

function buildDialog(): GraphDialogEls {
  const root = mountRoot()
  const backdrop = document.createElement('div')
  backdrop.className = 'graph-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'graph-dialog'
  dialog.id = 'graph-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'graph-modal-title')

  const title = document.createElement('h2')
  title.id = 'graph-modal-title'
  title.className = 'graph-title'
  title.textContent = 'Insert graph'

  const tabs = document.createElement('div')
  tabs.className = 'graph-tabs'
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Graph type')
  const tabButtons = {} as Record<GraphTab, HTMLButtonElement>
  for (const tab of TABS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'graph-tab'
    btn.setAttribute('role', 'tab')
    btn.setAttribute('data-tab', tab)
    btn.setAttribute('aria-selected', 'false')
    btn.textContent = TAB_LABELS[tab]
    tabs.appendChild(btn)
    tabButtons[tab] = btn
  }

  const form = document.createElement('div')
  form.className = 'graph-form'

  const errors = document.createElement('div')
  errors.className = 'graph-errors'
  errors.setAttribute('aria-live', 'polite')
  errors.hidden = true

  const previewLabel = document.createElement('p')
  previewLabel.className = 'graph-section-label'
  previewLabel.textContent = 'Preview'

  // Own <style> carrying MARKDOWN_BODY_CSS — same pattern as the main
  // preview pane, so the figure preview matches preview/export exactly.
  const previewStyle = document.createElement('style')
  previewStyle.textContent = MARKDOWN_BODY_CSS

  const preview = document.createElement('div')
  preview.className = 'graph-preview md-body'

  const tagLabel = document.createElement('p')
  tagLabel.className = 'graph-section-label'
  tagLabel.textContent = 'Generated tag'

  const tagPre = document.createElement('pre')
  tagPre.className = 'graph-tag'
  const tagCode = document.createElement('code')
  tagPre.appendChild(tagCode)

  const actions = document.createElement('div')
  actions.className = 'graph-actions'
  const insertBtn = document.createElement('button')
  insertBtn.type = 'button'
  insertBtn.className = 'graph-confirm'
  insertBtn.textContent = 'Insert'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'graph-cancel'
  cancelBtn.textContent = 'Cancel'
  actions.append(insertBtn, cancelBtn)

  dialog.append(title, tabs, form, errors, previewLabel, previewStyle, preview, tagLabel, tagPre, actions)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return { root, backdrop, dialog, tabButtons, form, errors, preview, tagCode, insertBtn, cancelBtn }
}

// --- form rendering (structural; per-keystroke updates use refresh only) ---

function renderPieForm(form: HTMLElement): void {
  addTitleField(form)
  const out = { labels: [] as HTMLInputElement[], values: [] as HTMLInputElement[] }
  addLabelValueRows(form, 'pie', state.pieRows, out)
  refs.rowLabels = out.labels
  refs.rowValues = out.values
}

function renderBarForm(form: HTMLElement): void {
  addTitleField(form)
  const tri = addTriField(form, 'Y axis', 'Y name', 'barY', state.barY, 'barMin', state.barMin, 'barMax', state.barMax)
  refs.barY = tri.name
  refs.barMin = tri.min
  refs.barMax = tri.max
  const out = { labels: [] as HTMLInputElement[], values: [] as HTMLInputElement[] }
  addLabelValueRows(form, 'bar', state.barRows, out)
  refs.rowLabels = out.labels
  refs.rowValues = out.values
}

function renderLineForm(form: HTMLElement): void {
  addTitleField(form)

  const xWrap = document.createElement('label')
  xWrap.className = 'graph-field'
  const xInput = makeTextInput(state.lineX, 'lineX')
  xInput.setAttribute('aria-label', 'X axis name')
  xWrap.append(makeLabel('X axis name'), xInput)
  form.appendChild(xWrap)
  refs.lineX = xInput

  const slotsGroup = document.createElement('div')
  slotsGroup.className = 'graph-group'
  const slotsHead = document.createElement('span')
  slotsHead.className = 'graph-group-label'
  slotsHead.textContent = 'X values (columns)'
  const slotsRow = document.createElement('div')
  slotsRow.className = 'graph-slots'
  state.lineSlots.forEach((slot, i) => {
    const cell = document.createElement('div')
    cell.className = 'graph-slot'
    const input = makeTextInput(slot, 'slot')
    input.setAttribute('data-i', String(i))
    input.setAttribute('aria-label', `X value ${String(i + 1)}`)
    input.placeholder = `Slot ${String(i + 1)}`
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'graph-row-remove'
    remove.setAttribute('data-action', 'remove-column')
    remove.setAttribute('data-i', String(i))
    remove.textContent = '×'
    remove.title = `Remove column ${String(i + 1)}`
    remove.setAttribute('aria-label', `Remove column ${String(i + 1)}`)
    remove.disabled = state.lineSlots.length <= 1
    cell.append(input, remove)
    slotsRow.appendChild(cell)
    refs.slotInputs.push(input)
  })
  const addCol = document.createElement('button')
  addCol.type = 'button'
  addCol.className = 'graph-add'
  addCol.setAttribute('data-action', 'add-column')
  addCol.textContent = 'Add column'
  slotsGroup.append(slotsHead, slotsRow, addCol)
  form.appendChild(slotsGroup)

  const tri = addTriField(form, 'Y axis', 'Y name', 'lineY', state.lineY, 'lineMin', state.lineMin, 'lineMax', state.lineMax)
  refs.lineY = tri.name
  refs.lineMin = tri.min
  refs.lineMax = tri.max

  const seriesGroup = document.createElement('div')
  seriesGroup.className = 'graph-group'
  const seriesHead = document.createElement('span')
  seriesHead.className = 'graph-group-label'
  seriesHead.textContent = 'Series (rows)'
  seriesGroup.appendChild(seriesHead)
  state.lineSeries.forEach((series, i) => {
    const line = document.createElement('div')
    line.className = 'graph-series-row'
    const nameInput = makeTextInput(series.name, 'seriesName')
    nameInput.setAttribute('data-i', String(i))
    nameInput.setAttribute('aria-label', `Series ${String(i + 1)} name`)
    nameInput.placeholder = 'Series name'
    line.appendChild(nameInput)
    refs.seriesNames.push(nameInput)
    const vals: HTMLInputElement[] = []
    series.values.forEach((value, j) => {
      const valueInput = makeTextInput(value, 'seriesValue')
      valueInput.setAttribute('data-i', String(i))
      valueInput.setAttribute('data-j', String(j))
      const slotName = state.lineSlots[j] ?? `Slot ${String(j + 1)}`
      valueInput.setAttribute('aria-label', `${series.name !== '' ? series.name : `Series ${String(i + 1)}`} value for ${slotName}`)
      valueInput.setAttribute('inputmode', 'decimal')
      valueInput.placeholder = slotName
      line.appendChild(valueInput)
      vals.push(valueInput)
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'graph-row-remove'
    remove.setAttribute('data-action', 'remove-series')
    remove.setAttribute('data-i', String(i))
    remove.textContent = '×'
    remove.title = `Remove series ${String(i + 1)}`
    remove.setAttribute('aria-label', `Remove series ${String(i + 1)}`)
    remove.disabled = state.lineSeries.length <= 1
    line.appendChild(remove)
    seriesGroup.appendChild(line)
    refs.seriesValues.push(vals)
  })
  const addSeries = document.createElement('button')
  addSeries.type = 'button'
  addSeries.className = 'graph-add'
  addSeries.setAttribute('data-action', 'add-series')
  addSeries.textContent = 'Add series'
  seriesGroup.appendChild(addSeries)
  form.appendChild(seriesGroup)
}

/** Rebuild the form for the active tab (structural changes + tab switches). */
function renderForm(): void {
  if (els === null) return
  refs = emptyRefs()
  while (els.form.firstChild !== null) els.form.removeChild(els.form.firstChild)
  if (state.tab === 'pie') renderPieForm(els.form)
  else if (state.tab === 'bar') renderBarForm(els.form)
  else renderLineForm(els.form)
  refresh()
}

function syncTabButtons(): void {
  if (els === null) return
  for (const tab of TABS) {
    const active = tab === state.tab
    els.tabButtons[tab].classList.toggle('graph-tab-active', active)
    els.tabButtons[tab].setAttribute('aria-selected', active ? 'true' : 'false')
  }
}

// --- tag generation (canonical forms, same quoting as specToTag) ---

interface OptionalNumber {
  present: boolean
  num: number
  raw: string
}

function parseOptionalNumber(text: string): OptionalNumber {
  const raw = text.trim()
  if (raw === '') return { present: false, num: NaN, raw }
  return { present: true, num: Number(raw), raw }
}

/** Best-effort numeric cell for point emission (blank → '0', else raw). */
function pointValueText(value: string): string {
  const raw = value.trim()
  return raw === '' ? '0' : raw
}

function buildPieTag(): string {
  const parts: string[] = ['pie']
  if (state.title !== '') parts.push(quoteGraphLabel(state.title))
  for (const row of state.pieRows) {
    parts.push(`(${quoteGraphLabel(row.label)}, ${pointValueText(row.value)})`)
  }
  return `%% ${parts.join(' ')} %%`
}

function buildBarTag(): string {
  const parts: string[] = ['bar']
  if (state.barY !== '') {
    parts.push(quoteGraphLabel(state.title), quoteGraphLabel(state.barY))
  } else if (state.title !== '') {
    parts.push(quoteGraphLabel(state.title))
  }
  const lo = parseOptionalNumber(state.barMin)
  const hi = parseOptionalNumber(state.barMax)
  if (lo.present) parts.push(`min ${lo.raw}`)
  if (hi.present) parts.push(`max ${hi.raw}`)
  for (const row of state.barRows) {
    parts.push(`(${quoteGraphLabel(row.label)}, ${pointValueText(row.value)})`)
  }
  return `%% ${parts.join(' ')} %%`
}

function buildLineTag(): string {
  const parts: string[] = ['line']
  if (state.title !== '') parts.push(quoteGraphLabel(state.title))
  parts.push(`(${[quoteGraphLabel(state.lineX), ...state.lineSlots.map(quoteGraphLabel)].join(', ')})`)
  // Lone Y bound emits in the single-bound slot, which the parser reads as
  // max — matching the parser exactly.
  const yParts: string[] = [quoteGraphLabel(state.lineY)]
  const lo = parseOptionalNumber(state.lineMin)
  const hi = parseOptionalNumber(state.lineMax)
  if (lo.present) yParts.push(lo.raw)
  if (hi.present) yParts.push(hi.raw)
  parts.push(`(${yParts.join(', ')})`)
  for (const series of state.lineSeries) {
    parts.push(`(${[quoteGraphLabel(series.name), ...series.values.map((v) => v.trim())].join(', ')})`)
  }
  return `%% ${parts.join(' ')} %%`
}

function buildTag(): string {
  if (state.tab === 'bar') return buildBarTag()
  if (state.tab === 'line') return buildLineTag()
  return buildPieTag()
}

// --- validation + live dual preview (no structural rebuild: keeps focus) ---

function validateLabelValueRows(
  rows: LabelValueRow[],
  values: HTMLInputElement[],
  fail: (message: string, ...inputs: HTMLElement[]) => void
): void {
  rows.forEach((row, i) => {
    const raw = row.value.trim()
    const num = raw === '' ? NaN : Number(raw)
    if (!Number.isFinite(num)) {
      const input = values[i]
      const marked: HTMLElement[] = input !== undefined ? [input] : []
      fail(`Invalid value "${raw}" for label "${row.label}". Expected a finite number.`, ...marked)
    }
  })
}

function validateBounds(
  minText: string,
  maxText: string,
  minInput: HTMLInputElement | null,
  maxInput: HTMLInputElement | null,
  fail: (message: string, ...inputs: HTMLElement[]) => void
): void {
  const lo = parseOptionalNumber(minText)
  const hi = parseOptionalNumber(maxText)
  if (lo.present && !Number.isFinite(lo.num) && minInput !== null) {
    fail(`Invalid min value "${lo.raw}". Expected a finite number.`, minInput)
  }
  if (hi.present && !Number.isFinite(hi.num) && maxInput !== null) {
    fail(`Invalid max value "${hi.raw}". Expected a finite number.`, maxInput)
  }
  if (Number.isFinite(lo.num) && Number.isFinite(hi.num) && lo.num >= hi.num) {
    const marked: HTMLElement[] = []
    if (minInput !== null) marked.push(minInput)
    if (maxInput !== null) marked.push(maxInput)
    fail(`Invalid range: min (${String(lo.num)}) must be less than max (${String(hi.num)}).`, ...marked)
  }
}

function refresh(): void {
  if (els === null) return
  const errors: string[] = []
  const bad = new Set<HTMLElement>()
  const fail = (message: string, ...inputs: HTMLElement[]): void => {
    errors.push(message)
    for (const input of inputs) bad.add(input)
  }

  if (state.tab === 'pie') {
    validateLabelValueRows(state.pieRows, refs.rowValues, fail)
  } else if (state.tab === 'bar') {
    validateBounds(state.barMin, state.barMax, refs.barMin, refs.barMax, fail)
    validateLabelValueRows(state.barRows, refs.rowValues, fail)
  } else {
    if (state.lineSlots.length < 2) fail('Line graphs need at least 2 x positions.')
    validateBounds(state.lineMin, state.lineMax, refs.lineMin, refs.lineMax, fail)
    const seen = new Set<string>()
    state.lineSeries.forEach((series, i) => {
      const nameInput = refs.seriesNames[i]
      if (seen.has(series.name)) {
        const marked: HTMLElement[] = nameInput !== undefined ? [nameInput] : []
        fail(`Duplicate series "${series.name}".`, ...marked)
      } else {
        seen.add(series.name)
      }
      series.values.forEach((value, j) => {
        const raw = value.trim()
        const num = raw === '' ? NaN : Number(raw)
        if (!Number.isFinite(num)) {
          const rowRefs = refs.seriesValues[i]
          const cell = rowRefs !== undefined ? rowRefs[j] : undefined
          const marked: HTMLElement[] = cell !== undefined ? [cell] : []
          fail(`Invalid value "${raw}" in series "${series.name}" (position ${String(j + 1)}). Expected a finite number.`, ...marked)
        }
      })
    })
  }

  for (const cell of els.form.querySelectorAll('.graph-cell-error')) {
    cell.classList.remove('graph-cell-error')
  }
  for (const cell of bad) cell.classList.add('graph-cell-error')

  const tag = buildTag()
  currentTag = tag
  els.tagCode.textContent = tag
  // renderMarkdown() is DOMPurify-sanitized — the only HTML injection point.
  els.preview.innerHTML = renderMarkdown(tag)

  while (els.errors.firstChild !== null) els.errors.removeChild(els.errors.firstChild)
  for (const message of errors) {
    const line = document.createElement('div')
    line.className = 'graph-error'
    line.textContent = message
    els.errors.appendChild(line)
  }
  els.errors.hidden = errors.length === 0

  // Belt and braces: the generated tag must re-parse before Insert enables.
  let parseOk = false
  try {
    parseOk = parseGraphTag(tag.slice(2, -2).trim()).ok
  } catch {
    parseOk = false
  }
  els.insertBtn.disabled = errors.length > 0 || !parseOk
}

// --- tab switching + structural edits (title preserved, rows reset) ---

function selectTab(tab: GraphTab): void {
  state.tab = tab
  if (tab === 'pie') {
    state.pieRows = starterPieRows()
  } else if (tab === 'bar') {
    state.barY = 'Units'
    state.barMin = ''
    state.barMax = ''
    state.barRows = starterBarRows()
  } else {
    state.lineX = 'Week'
    state.lineSlots = ['Mon', 'Tue']
    state.lineY = 'Hits'
    state.lineMin = '0'
    state.lineMax = '100'
    state.lineSeries = [{ name: 'SiteA', values: ['120', '200'] }]
  }
  syncTabButtons()
  renderForm()
}

function nextUniqueName(existing: string[], prefix: string): string {
  let n = existing.length + 1
  let name = `${prefix} ${String(n)}`
  while (existing.includes(name)) {
    n++
    name = `${prefix} ${String(n)}`
  }
  return name
}

function focusLastLabel(): void {
  if (els === null) return
  const inputs = els.form.querySelectorAll<HTMLInputElement>('.graph-rows .graph-row:last-child input')
  inputs[0]?.focus()
}

// --- handlers ---

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    settle(null)
  }
}

/** Tab / Shift+Tab wrap around the dialog's tabs, inputs and buttons. */
function onDialogKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || els === null) return
  const focusables = Array.from(els.dialog.querySelectorAll<HTMLElement>('button, input')).filter(
    (node) => !(node instanceof HTMLButtonElement && node.disabled)
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (first === undefined || last === undefined) return
  const active = document.activeElement
  if (ev.shiftKey) {
    if (active === first || !els.dialog.contains(active)) {
      ev.preventDefault()
      last.focus()
    }
  } else if (active === last || !els.dialog.contains(active)) {
    ev.preventDefault()
    first.focus()
  }
}

/** Clicks land on the backdrop itself, not on the dialog inside it. */
function onBackdropClick(ev: MouseEvent): void {
  if (els !== null && ev.target === els.backdrop) settle(null)
}

function onTabsClick(ev: MouseEvent): void {
  const target = ev.target
  if (!(target instanceof HTMLElement)) return
  const btn = target.closest('button[data-tab]')
  if (btn === null || els === null || !els.dialog.contains(btn)) return
  const tab = btn.getAttribute('data-tab')
  if (tab !== 'pie' && tab !== 'bar' && tab !== 'line') return
  if (tab === state.tab) return
  selectTab(tab)
}

/** Sync the edited cell into state, then re-validate + re-preview. */
function onFormInput(ev: Event): void {
  const input = ev.target
  if (!(input instanceof HTMLInputElement)) return
  const kind = input.getAttribute('data-k')
  const i = Number(input.getAttribute('data-i') ?? '-1')
  const j = Number(input.getAttribute('data-j') ?? '-1')
  const rowsKind = input.getAttribute('data-kind')
  switch (kind) {
    case 'title':
      state.title = input.value
      break
    case 'barY':
      state.barY = input.value
      break
    case 'barMin':
      state.barMin = input.value
      break
    case 'barMax':
      state.barMax = input.value
      break
    case 'rowLabel': {
      const rows = rowsKind === 'bar' ? state.barRows : state.pieRows
      const row = rows[i]
      if (row !== undefined) row.label = input.value
      break
    }
    case 'rowValue': {
      const rows = rowsKind === 'bar' ? state.barRows : state.pieRows
      const row = rows[i]
      if (row !== undefined) row.value = input.value
      break
    }
    case 'lineX':
      state.lineX = input.value
      break
    case 'slot': {
      if (i >= 0 && i < state.lineSlots.length) state.lineSlots[i] = input.value
      break
    }
    case 'lineY':
      state.lineY = input.value
      break
    case 'lineMin':
      state.lineMin = input.value
      break
    case 'lineMax':
      state.lineMax = input.value
      break
    case 'seriesName': {
      const series = state.lineSeries[i]
      if (series !== undefined) series.name = input.value
      break
    }
    case 'seriesValue': {
      const series = state.lineSeries[i]
      if (series !== undefined && j >= 0 && j < series.values.length) series.values[j] = input.value
      break
    }
    default:
      return
  }
  refresh()
}

/** Structural add/remove buttons (delegated; inputs are handled above). */
function onFormClick(ev: MouseEvent): void {
  const target = ev.target
  if (!(target instanceof HTMLElement)) return
  const btn = target.closest('button[data-action]')
  if (btn === null || els === null || !els.form.contains(btn)) return
  const action = btn.getAttribute('data-action')
  const i = Number(btn.getAttribute('data-i') ?? '-1')
  const rowsKind = btn.getAttribute('data-kind')
  switch (action) {
    case 'add-row': {
      const rows = rowsKind === 'bar' ? state.barRows : state.pieRows
      rows.push({ label: '', value: '' })
      renderForm()
      focusLastLabel()
      break
    }
    case 'remove-row': {
      const rows = rowsKind === 'bar' ? state.barRows : state.pieRows
      if (rows.length <= 1 || i < 0 || i >= rows.length) return
      rows.splice(i, 1)
      renderForm()
      break
    }
    case 'add-column': {
      state.lineSlots.push(nextUniqueName(state.lineSlots, 'Slot'))
      for (const series of state.lineSeries) series.values.push('')
      renderForm()
      break
    }
    case 'remove-column': {
      if (state.lineSlots.length <= 1 || i < 0 || i >= state.lineSlots.length) return
      state.lineSlots.splice(i, 1)
      for (const series of state.lineSeries) series.values.splice(i, 1)
      renderForm()
      break
    }
    case 'add-series': {
      state.lineSeries.push({
        name: nextUniqueName(state.lineSeries.map((s) => s.name), 'Series'),
        values: state.lineSlots.map(() => ''),
      })
      renderForm()
      break
    }
    case 'remove-series': {
      if (state.lineSeries.length <= 1 || i < 0 || i >= state.lineSeries.length) return
      state.lineSeries.splice(i, 1)
      renderForm()
      break
    }
    default:
      break
  }
}

function onInsertClick(): void {
  if (els === null || els.insertBtn.disabled) return
  settle(currentTag)
}

function onCancelClick(): void {
  settle(null)
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.backdrop.addEventListener('click', onBackdropClick)
  for (const tab of TABS) els.tabButtons[tab].addEventListener('click', onTabsClick)
  els.form.addEventListener('input', onFormInput)
  els.form.addEventListener('click', onFormClick)
  els.insertBtn.addEventListener('click', onInsertClick)
  els.cancelBtn.addEventListener('click', onCancelClick)
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.backdrop.removeEventListener('click', onBackdropClick)
  for (const tab of TABS) els.tabButtons[tab].removeEventListener('click', onTabsClick)
  els.form.removeEventListener('input', onFormInput)
  els.form.removeEventListener('click', onFormClick)
  els.insertBtn.removeEventListener('click', onInsertClick)
  els.cancelBtn.removeEventListener('click', onCancelClick)
}

// --- exported API ---

export function isGraphBuilderOpen(): boolean {
  return isOpen
}

/**
 * Show the tabbed graph builder. Resolves the finished `%% … %%` tag string
 * on [Insert], null on [Cancel], backdrop click, or Esc. A call while
 * already open supersedes the previous waiter (resolves it null) and resets
 * the form to the starters.
 */
export function openGraphBuilder(): Promise<string | null> {
  if (els === null || !els.root.isConnected) {
    if (els !== null) {
      detachListeners()
      els.backdrop.remove()
    }
    els = buildDialog()
  }
  if (isOpen) settle(null) // supersede any pending builder

  state = freshState()
  currentTag = ''
  syncTabButtons()
  renderForm()

  isOpen = true
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  els.root.hidden = false
  attachListeners()
  const firstInput = els.form.querySelector<HTMLInputElement>('input')
  if (firstInput !== null) firstInput.focus()

  return new Promise<string | null>((resolve) => {
    pending = resolve
  })
}

function settle(tag: string | null): void {
  if (!isOpen || els === null) return
  isOpen = false
  detachListeners()
  els.root.hidden = true
  const resolve = pending
  pending = null
  if (lastFocused !== null) {
    const restore = lastFocused
    lastFocused = null
    restore.focus()
  }
  resolve?.(tag)
}
