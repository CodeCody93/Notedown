/**
 * Import confirmation modal (P3): the "some formatting may be lost" dialog
 * shown between picking a file and converting it.
 *
 * Mirrors the settingsUI.ts pattern: plain DOM (textContent only, no
 * innerHTML), module-level state, listeners attached on open and detached on
 * close so repeated cycles never stack handlers, backdrop click + Esc to
 * cancel, and a Tab focus trap.
 *
 * One deliberate deviation: the mount point. settingsUI throws when
 * #settings-modal-root is missing; this module MUST never throw at import
 * time, so it builds into #import-modal-root when present and falls back to
 * document.body otherwise. The mount root itself is hidden/shown (mirroring
 * help.ts / about.ts / settingsUI.ts), so the dialog is never trapped inside
 * a parent that stays `hidden`.
 *
 * Package boundary: UI confirmation only. Picking stays behind
 * `src/platform/` (`FileIO.importFile`); conversion lives in `import.ts`.
 * app.ts wiring (menu item, orchestration) is the orchestrator's packet.
 */

import type { ImportFormat } from './import'

/** Mount-point id the orchestrator adds to index.html (`<div id="import-modal-root">`). */
export const IMPORT_MODAL_ROOT_ID = 'import-modal-root'

const FORMAT_LABELS: Record<ImportFormat, string> = {
  markdown: 'Markdown',
  txt: 'Plain text',
  html: 'HTML',
  pdf: 'PDF',
  docx: 'Word document (.docx)',
  rtf: 'Rich Text (.rtf)',
}

interface ImportDialogEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  fileName: HTMLElement
  format: HTMLElement
  lead: HTMLElement
  list: HTMLElement
  emptyNote: HTMLElement
  importBtn: HTMLButtonElement
  cancelBtn: HTMLButtonElement
}

let els: ImportDialogEls | null = null
let wired = false
let isOpen = false
let lastFocused: HTMLElement | null = null
let pending: ((confirmed: boolean) => void) | null = null

/** Never throws: prefers #import-modal-root, falls back to document.body. */
function mountRoot(): HTMLElement {
  return document.getElementById(IMPORT_MODAL_ROOT_ID) ?? document.body
}

function buildDialog(): ImportDialogEls {
  const root = mountRoot()
  const backdrop = document.createElement('div')
  backdrop.className = 'import-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'import-dialog'
  dialog.id = 'import-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'import-title')

  const title = document.createElement('h2')
  title.id = 'import-title'
  title.className = 'import-title'
  title.textContent = 'Import file'

  const meta = document.createElement('p')
  meta.className = 'import-meta'
  const fileName = document.createElement('span')
  fileName.className = 'import-filename'
  const formatSep = document.createElement('span')
  formatSep.className = 'import-format-sep'
  formatSep.textContent = ' — '
  const format = document.createElement('span')
  format.className = 'import-format'
  meta.append(fileName, formatSep, format)

  const lead = document.createElement('p')
  lead.className = 'import-lead'
  lead.textContent = 'Some formatting may be lost during import:'

  const list = document.createElement('ul')
  list.className = 'import-losses'

  const emptyNote = document.createElement('p')
  emptyNote.className = 'import-clean'
  emptyNote.textContent = 'No formatting will be lost.'

  const actions = document.createElement('div')
  actions.className = 'import-actions'
  const importBtn = document.createElement('button')
  importBtn.type = 'button'
  importBtn.className = 'import-confirm'
  importBtn.textContent = 'Import anyway'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'import-cancel'
  cancelBtn.textContent = 'Cancel'
  actions.append(importBtn, cancelBtn)

  dialog.append(title, meta, lead, list, emptyNote, actions)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return { root, backdrop, dialog, fileName, format, lead, list, emptyNote, importBtn, cancelBtn }
}

// --- handlers ---

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    settle(false)
  }
}

/** Tab / Shift+Tab wrap around the dialog's buttons. */
function onDialogKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || els === null) return
  const focusables = Array.from(els.dialog.querySelectorAll<HTMLElement>('button'))
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
  if (els !== null && ev.target === els.backdrop) settle(false)
}

function onImportClick(): void {
  settle(true)
}

function onCancelClick(): void {
  settle(false)
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.backdrop.addEventListener('click', onBackdropClick)
  els.importBtn.addEventListener('click', onImportClick)
  els.cancelBtn.addEventListener('click', onCancelClick)
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.backdrop.removeEventListener('click', onBackdropClick)
  els.importBtn.removeEventListener('click', onImportClick)
  els.cancelBtn.removeEventListener('click', onCancelClick)
}

// --- exported API ---

/**
 * Build the dialog DOM once; re-calls only re-check the mount (idempotent).
 * Never throws — falls back to document.body when #import-modal-root is
 * missing. Called lazily by confirmImportLosses, or eagerly by app wiring.
 */
export function wireImportDialog(): void {
  if (wired && els !== null && els.root.isConnected) return
  if (isOpen) {
    // The previous dialog was detached (e.g. a fresh document) — reset so the
    // rebuilt DOM starts closed. A superseded waiter resolves as cancelled.
    detachListeners()
    isOpen = false
    lastFocused = null
    const superseded = pending
    pending = null
    superseded?.(false)
  }
  els = buildDialog()
  wired = true
}

/**
 * Tear the dialog down completely (removes the DOM, clears state, resolves a
 * pending waiter as cancelled). Used for HMR/reset paths; normal flows never
 * need it.
 */
export function resetImportDialog(): void {
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
  waiter?.(false)
}

export function isImportDialogOpen(): boolean {
  return isOpen
}

/** Close the dialog resolving the pending confirmation as cancelled. */
export function closeImportDialog(): void {
  settle(false)
}

/**
 * Show the loss warning for a picked file. Resolves true on [Import anyway],
 * false on [Cancel], backdrop click, or Esc. A call while already open
 * supersedes the previous waiter (resolves it false) and re-renders.
 */
export function confirmImportLosses(
  fileName: string,
  format: ImportFormat,
  losses: string[],
): Promise<boolean> {
  wireImportDialog()
  const e = els
  if (e === null) throw new Error('confirmImportLosses: dialog failed to build')
  if (isOpen) settle(false) // supersede any pending confirmation

  e.fileName.textContent = fileName
  e.format.textContent = FORMAT_LABELS[format]
  while (e.list.firstChild !== null) e.list.removeChild(e.list.firstChild)
  for (const loss of losses) {
    const item = document.createElement('li')
    item.textContent = loss
    e.list.appendChild(item)
  }
  const clean = losses.length === 0
  e.lead.hidden = clean
  e.list.hidden = clean
  e.emptyNote.hidden = !clean

  isOpen = true
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  e.root.hidden = false
  attachListeners()
  e.cancelBtn.focus() // safe default: Enter activates Cancel, not Import

  return new Promise<boolean>((resolve) => {
    pending = resolve
  })
}

function settle(confirmed: boolean): void {
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
  resolve?.(confirmed)
}
