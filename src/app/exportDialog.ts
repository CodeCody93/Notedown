/**
 * Unified export-format picker modal (round-9 unified export): the single
 * File→Export… dialog offering txt/html/pdf/docx/rtf (same list as import).
 *
 * Mirrors the importDialog.ts pattern: plain DOM (textContent only, no
 * innerHTML), module-level state, listeners attached on open and detached on
 * close so repeated cycles never stack handlers, backdrop click + Esc to
 * cancel, and a Tab focus trap.
 *
 * Same mount-point tolerance: builds into #export-modal-root when present
 * and falls back to document.body otherwise. The mount root itself is
 * hidden/shown (mirroring help.ts / about.ts / settingsUI.ts /
 * importDialog.ts), so the dialog is never trapped inside a parent that
 * stays `hidden`.
 *
 * Package boundary: UI picker only. No FileIO, no invoke(), no conversion —
 * app.ts wiring calls chooseExportFormat() then acts on the chosen format
 * (save dialog lives outside this module).
 */

import type { ExportFormat } from './export'
import { exportLossSummaryFor } from './export'

/** Mount-point id the orchestrator adds to index.html (`<div id="export-modal-root">`). */
export const EXPORT_MODAL_ROOT_ID = 'export-modal-root'

/**
 * Round-9 unified export: dialog order fallback (txt/html/pdf/docx/rtf, same
 * list as import). The export.ts packet owns the canonical EXPORT_FORMATS;
 * this local copy keeps the dialog working against the specified contract.
 */
const EXPORT_FORMATS: ExportFormat[] = ['txt', 'html', 'pdf', 'docx', 'rtf']

const FORMAT_LABELS: Record<ExportFormat, string> = {
  txt: 'Plain text (.txt)',
  html: 'HTML (.html)',
  pdf: 'PDF (.pdf)',
  docx: 'Word (.docx)',
  rtf: 'Rich Text (.rtf)',
}

interface ExportDialogEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  radios: HTMLElement
  radioInputs: HTMLInputElement[]
  lead: HTMLElement
  list: HTMLElement
  emptyNote: HTMLElement
  exportBtn: HTMLButtonElement
  cancelBtn: HTMLButtonElement
}

let els: ExportDialogEls | null = null
let wired = false
let isOpen = false
let lastFocused: HTMLElement | null = null
let pending: ((format: ExportFormat | null) => void) | null = null
let selected: ExportFormat = 'html'

/** Never throws: prefers #export-modal-root, falls back to document.body. */
function mountRoot(): HTMLElement {
  return document.getElementById(EXPORT_MODAL_ROOT_ID) ?? document.body
}

function buildDialog(): ExportDialogEls {
  const root = mountRoot()
  const backdrop = document.createElement('div')
  backdrop.className = 'export-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'export-dialog'
  dialog.id = 'export-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'export-title')

  const title = document.createElement('h2')
  title.id = 'export-title'
  title.className = 'export-title'
  title.textContent = 'Export'

  const formatLead = document.createElement('p')
  formatLead.className = 'export-lead'
  formatLead.textContent = 'Choose a format:'

  const radios = document.createElement('div')
  radios.className = 'export-radios'
  radios.setAttribute('role', 'radiogroup')
  radios.setAttribute('aria-label', 'Export format')

  const radioInputs: HTMLInputElement[] = []
  for (const format of EXPORT_FORMATS) {
    const row = document.createElement('label')
    row.className = 'export-radio-row'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'export-format'
    input.value = format
    input.className = 'export-radio'
    const text = document.createElement('span')
    text.className = 'export-radio-label'
    text.textContent = FORMAT_LABELS[format]
    row.append(input, text)
    radios.appendChild(row)
    radioInputs.push(input)
  }

  const lead = document.createElement('p')
  lead.className = 'export-losses-lead'
  lead.textContent = 'Some formatting may be lost during export:'

  const list = document.createElement('ul')
  list.className = 'export-losses'

  const emptyNote = document.createElement('p')
  emptyNote.className = 'export-clean'
  emptyNote.textContent = 'No formatting will be lost.'

  const actions = document.createElement('div')
  actions.className = 'export-actions'
  const exportBtn = document.createElement('button')
  exportBtn.type = 'button'
  exportBtn.className = 'export-confirm'
  exportBtn.textContent = 'Export'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'export-cancel'
  cancelBtn.textContent = 'Cancel'
  actions.append(exportBtn, cancelBtn)

  dialog.append(title, formatLead, radios, lead, list, emptyNote, actions)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return { root, backdrop, dialog, radios, radioInputs, lead, list, emptyNote, exportBtn, cancelBtn }
}

/** Re-render the live loss list for the given format. */
function renderLosses(format: ExportFormat): void {
  if (els === null) return
  const losses = exportLossSummaryFor(format)
  while (els.list.firstChild !== null) els.list.removeChild(els.list.firstChild)
  for (const loss of losses) {
    const item = document.createElement('li')
    item.textContent = loss
    els.list.appendChild(item)
  }
  const clean = losses.length === 0
  els.lead.hidden = clean
  els.list.hidden = clean
  els.emptyNote.hidden = !clean
}

// --- handlers ---

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    settle(null)
  }
}

/** Tab / Shift+Tab wrap around the dialog's radios and buttons. */
function onDialogKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || els === null) return
  const focusables = Array.from(els.dialog.querySelectorAll<HTMLElement>('input, button'))
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

/** Radio change re-selects the format and re-renders the live loss list. */
function onRadiosChange(ev: Event): void {
  const target = ev.target
  if (!(target instanceof HTMLInputElement) || target.name !== 'export-format') return
  const value = target.value as ExportFormat
  if (!EXPORT_FORMATS.includes(value)) return
  selected = value
  renderLosses(selected)
}

function onExportClick(): void {
  settle(selected)
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
  els.radios.addEventListener('change', onRadiosChange)
  els.exportBtn.addEventListener('click', onExportClick)
  els.cancelBtn.addEventListener('click', onCancelClick)
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.backdrop.removeEventListener('click', onBackdropClick)
  els.radios.removeEventListener('change', onRadiosChange)
  els.exportBtn.removeEventListener('click', onExportClick)
  els.cancelBtn.removeEventListener('click', onCancelClick)
}

// --- exported API ---

/**
 * Build the dialog DOM once; re-calls only re-check the mount (idempotent).
 * Never throws — falls back to document.body when #export-modal-root is
 * missing. Called lazily by chooseExportFormat, or eagerly by app wiring.
 */
export function wireExportDialog(): void {
  if (wired && els !== null && els.root.isConnected) return
  if (isOpen) {
    // The previous dialog was detached (e.g. a fresh document) — reset so the
    // rebuilt DOM starts closed. A superseded waiter resolves as cancelled.
    detachListeners()
    isOpen = false
    lastFocused = null
    const superseded = pending
    pending = null
    superseded?.(null)
  }
  els = buildDialog()
  wired = true
}

/**
 * Tear the dialog down completely (removes the DOM, clears state, resolves a
 * pending waiter as cancelled). Used for HMR/reset paths; normal flows never
 * need it.
 */
export function resetExportDialog(): void {
  const root = els?.root
  detachListeners()
  els?.backdrop.remove()
  // The mount root outlives the backdrop: re-hide it so a fresh wire/build
  // starts closed. Never hide document.body (the mount fallback) itself.
  if (root !== undefined && root !== document.body && root.isConnected) root.hidden = true
  els = null
  wired = false
  isOpen = false
  lastFocused = null
  const waiter = pending
  pending = null
  waiter?.(null)
}

export function isExportDialogOpen(): boolean {
  return isOpen
}

/**
 * Show the unified export-format picker (round-9 unified export). Resolves
 * the chosen format on [Export], null on [Cancel], backdrop click, or Esc.
 * A call while already open supersedes the previous waiter (resolves it
 * null) and re-renders.
 */
export function chooseExportFormat(defaultFormat?: ExportFormat): Promise<ExportFormat | null> {
  wireExportDialog()
  const e = els
  if (e === null) throw new Error('chooseExportFormat: dialog failed to build')
  if (isOpen) settle(null) // supersede any pending picker

  selected =
    defaultFormat !== undefined && EXPORT_FORMATS.includes(defaultFormat)
      ? defaultFormat
      : (EXPORT_FORMATS[0] ?? 'html')
  for (const input of e.radioInputs) {
    input.checked = (input.value as ExportFormat) === selected
  }
  renderLosses(selected)

  isOpen = true
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  e.root.hidden = false
  attachListeners()
  // Safe default: exporting writes a NEW file via a save dialog
  // (non-destructive), so [Export] takes initial focus.
  e.exportBtn.focus()

  return new Promise<ExportFormat | null>((resolve) => {
    pending = resolve
  })
}

function settle(format: ExportFormat | null): void {
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
  resolve?.(format)
}
