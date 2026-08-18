/**
 * Settings modal (PLAN §12): the File > Settings / Ctrl+, dialog with live
 * apply — every control change fires deps.onApply({changedKey}) immediately.
 * Two-column on desktop, bottom sheet on narrow screens (settings.css).
 *
 * Deliberately dependency-free of app.ts (app.ts imports this module, never the
 * reverse): wireSettingsModal receives getSettings + onApply at wire time.
 *
 * Module-level state, no classes — same shape as preview.ts. All listeners are
 * attached on open and removed on close, so repeated open/close cycles never
 * stack handlers.
 */
import type { Settings, ThemeSetting } from './settings'

export interface SettingsModalDeps {
  getSettings: () => Settings
  onApply: (patch: Partial<Settings>) => void
}

interface SettingsEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  closeBtn: HTMLButtonElement
  fontSize: HTMLInputElement
  lineHeight: HTMLInputElement
  lineWrapping: HTMLInputElement
  autosaveDrafts: HTMLInputElement
  spellCheck: HTMLInputElement
  extraMenu: HTMLInputElement
}

let deps: SettingsModalDeps | null = null
let els: SettingsEls | null = null
let wired = false
let isOpen = false
let lastFocused: HTMLElement | null = null

function byId(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Missing element #${id}`)
  return node
}

function applyPatch(patch: Partial<Settings>): void {
  if (deps !== null) deps.onApply(patch)
}

// --- DOM construction (once, at wire time) ---

/** A labelled row that wraps its control in the label (radio/checkbox rows). */
function row(control: HTMLElement, labelText: string): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'settings-row'
  label.appendChild(control)
  const span = document.createElement('span')
  span.className = 'settings-label'
  span.textContent = labelText
  label.appendChild(span)
  return label
}

/** A number row: label on the left, input (+ optional unit suffix) on the right. */
function numberRow(input: HTMLInputElement, labelText: string, suffix: string | null): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'settings-row'
  const label = document.createElement('span')
  label.className = 'settings-label'
  label.textContent = labelText
  wrap.appendChild(label)
  const group = document.createElement('span')
  group.className = 'settings-control'
  group.appendChild(input)
  if (suffix !== null) {
    const suffixEl = document.createElement('span')
    suffixEl.className = 'settings-suffix'
    suffixEl.textContent = suffix
    group.appendChild(suffixEl)
  }
  wrap.appendChild(group)
  return wrap
}

function buildFieldset(legendText: string): HTMLFieldSetElement {
  const fieldset = document.createElement('fieldset')
  fieldset.className = 'settings-fieldset'
  const legend = document.createElement('legend')
  legend.textContent = legendText
  fieldset.appendChild(legend)
  return fieldset
}

function buildThemeFieldset(): HTMLFieldSetElement {
  const fieldset = buildFieldset('Theme')
  for (const value of ['light', 'dark', 'system'] as const) {
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'settings-theme'
    input.value = value
    fieldset.appendChild(row(input, value[0].toUpperCase() + value.slice(1)))
  }
  return fieldset
}

function buildEditingFieldset(): {
  fieldset: HTMLFieldSetElement
  fontSize: HTMLInputElement
  lineHeight: HTMLInputElement
  lineWrapping: HTMLInputElement
  autosaveDrafts: HTMLInputElement
  spellCheck: HTMLInputElement
} {
  const fieldset = buildFieldset('Editing')

  const fontSize = document.createElement('input')
  fontSize.type = 'number'
  fontSize.className = 'settings-input'
  fontSize.id = 'settings-font-size'
  fontSize.min = '10'
  fontSize.max = '32'
  fontSize.step = '1'
  fieldset.appendChild(numberRow(fontSize, 'Font size', 'px'))

  const lineHeight = document.createElement('input')
  lineHeight.type = 'number'
  lineHeight.className = 'settings-input'
  lineHeight.id = 'settings-line-height'
  lineHeight.min = '1'
  lineHeight.max = '2.5'
  lineHeight.step = '0.1'
  fieldset.appendChild(numberRow(lineHeight, 'Line height', null))

  const lineWrapping = document.createElement('input')
  lineWrapping.type = 'checkbox'
  lineWrapping.id = 'settings-line-wrap'
  fieldset.appendChild(row(lineWrapping, 'Line wrapping'))

  const autosaveDrafts = document.createElement('input')
  autosaveDrafts.type = 'checkbox'
  autosaveDrafts.id = 'settings-autosave'
  fieldset.appendChild(row(autosaveDrafts, 'Autosave drafts'))

  const spellCheck = document.createElement('input')
  spellCheck.type = 'checkbox'
  spellCheck.id = 'settings-spellcheck'
  fieldset.appendChild(row(spellCheck, 'Spell check'))

  const modeLabel = document.createElement('div')
  modeLabel.className = 'settings-group-label'
  modeLabel.textContent = 'Default editing mode'
  fieldset.appendChild(modeLabel)
  const modeGroup = document.createElement('div')
  modeGroup.className = 'settings-radio-group'
  for (const value of ['live', 'source'] as const) {
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'settings-mode'
    input.value = value
    modeGroup.appendChild(row(input, value === 'live' ? 'Live preview' : 'Source'))
  }
  fieldset.appendChild(modeGroup)

  return { fieldset, fontSize, lineHeight, lineWrapping, autosaveDrafts, spellCheck }
}

function buildMenubarFieldset(): { fieldset: HTMLFieldSetElement; extraMenu: HTMLInputElement } {
  const fieldset = buildFieldset('Menubar')
  const extraMenu = document.createElement('input')
  extraMenu.type = 'checkbox'
  extraMenu.id = 'settings-extra-menu'
  fieldset.appendChild(row(extraMenu, 'Extra menu always visible'))
  return { fieldset, extraMenu }
}

function buildDialog(): SettingsEls {
  const root = byId('settings-modal-root')
  const backdrop = document.createElement('div')
  backdrop.className = 'settings-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'settings-dialog'
  dialog.id = 'settings-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'settings-title')

  const header = document.createElement('header')
  header.className = 'settings-header'
  const title = document.createElement('h2')
  title.id = 'settings-title'
  title.className = 'settings-title'
  title.textContent = 'Settings'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'settings-close'
  closeBtn.setAttribute('aria-label', 'Close settings')
  closeBtn.textContent = '\u00d7' // ×
  header.append(title, closeBtn)

  // Desktop: Theme | Editing + Menubar side by side (.settings-grid is 2 cols).
  const grid = document.createElement('div')
  grid.className = 'settings-grid'
  grid.appendChild(buildThemeFieldset())
  const editCol = document.createElement('div')
  editCol.className = 'settings-col'
  const editing = buildEditingFieldset()
  const menubar = buildMenubarFieldset()
  editCol.append(editing.fieldset, menubar.fieldset)
  grid.appendChild(editCol)

  dialog.append(header, grid)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return {
    root,
    backdrop,
    dialog,
    closeBtn,
    fontSize: editing.fontSize,
    lineHeight: editing.lineHeight,
    lineWrapping: editing.lineWrapping,
    autosaveDrafts: editing.autosaveDrafts,
    spellCheck: editing.spellCheck,
    extraMenu: menubar.extraMenu,
  }
}

// --- handlers ---

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    closeSettingsModal()
  }
}

/** Tab / Shift+Tab wrap around the dialog's focusable controls. */
function onDialogKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || els === null) return
  const focusables = focusableElements()
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
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
  if (els !== null && ev.target === els.backdrop) closeSettingsModal()
}

function onCloseClick(): void {
  closeSettingsModal()
}

function onRadioChange(ev: Event): void {
  const input = ev.target as HTMLInputElement
  if (!input.checked) return
  if (input.name === 'settings-theme') {
    applyPatch({ theme: input.value as ThemeSetting })
  } else if (input.name === 'settings-mode') {
    applyPatch({ defaultMode: input.value as 'live' | 'source' })
  }
}

function onFontSizeInput(ev: Event): void {
  const value = Math.min(32, Math.max(10, Number((ev.target as HTMLInputElement).value)))
  if (Number.isFinite(value)) applyPatch({ fontSize: value })
}

function onLineHeightInput(ev: Event): void {
  const value = Math.min(2.5, Math.max(1, Number((ev.target as HTMLInputElement).value)))
  if (Number.isFinite(value)) applyPatch({ lineHeight: value })
}

function onLineWrappingChange(ev: Event): void {
  applyPatch({ lineWrapping: (ev.target as HTMLInputElement).checked })
}

function onAutosaveChange(ev: Event): void {
  applyPatch({ autosaveDrafts: (ev.target as HTMLInputElement).checked })
}

function onSpellCheckChange(ev: Event): void {
  applyPatch({ spellCheck: (ev.target as HTMLInputElement).checked })
}

function onExtraMenuChange(ev: Event): void {
  applyPatch({ extraMenuAlwaysVisible: (ev.target as HTMLInputElement).checked })
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.backdrop.addEventListener('click', onBackdropClick)
  els.closeBtn.addEventListener('click', onCloseClick)
  els.fontSize.addEventListener('input', onFontSizeInput)
  els.lineHeight.addEventListener('input', onLineHeightInput)
  els.lineWrapping.addEventListener('change', onLineWrappingChange)
  els.autosaveDrafts.addEventListener('change', onAutosaveChange)
  els.spellCheck.addEventListener('change', onSpellCheckChange)
  els.extraMenu.addEventListener('change', onExtraMenuChange)
  for (const radio of els.dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    radio.addEventListener('change', onRadioChange)
  }
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.backdrop.removeEventListener('click', onBackdropClick)
  els.closeBtn.removeEventListener('click', onCloseClick)
  els.fontSize.removeEventListener('input', onFontSizeInput)
  els.lineHeight.removeEventListener('input', onLineHeightInput)
  els.lineWrapping.removeEventListener('change', onLineWrappingChange)
  els.autosaveDrafts.removeEventListener('change', onAutosaveChange)
  els.spellCheck.removeEventListener('change', onSpellCheckChange)
  els.extraMenu.removeEventListener('change', onExtraMenuChange)
  for (const radio of els.dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    radio.removeEventListener('change', onRadioChange)
  }
}

// --- value sync ---

function checkRadio(name: string, value: string): void {
  if (els === null) return
  const radio = els.dialog.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)
  if (radio !== null) radio.checked = true
}

/** Re-sync every control from getSettings() — called on every open. */
function refreshValues(): void {
  if (deps === null || els === null) return
  const s = deps.getSettings()
  checkRadio('settings-theme', s.theme)
  checkRadio('settings-mode', s.defaultMode)
  els.fontSize.value = String(s.fontSize)
  els.lineHeight.value = String(s.lineHeight)
  els.lineWrapping.checked = s.lineWrapping
  els.autosaveDrafts.checked = s.autosaveDrafts
  els.spellCheck.checked = s.spellCheck
  els.extraMenu.checked = s.extraMenuAlwaysVisible
}

function focusableElements(): HTMLElement[] {
  if (els === null) return []
  return Array.from(els.dialog.querySelectorAll<HTMLElement>('button, input'))
}

function focusFirst(): void {
  const first = focusableElements()[0]
  if (first !== undefined) first.focus()
}

// --- exported API ---

/**
 * Attach the settings modal to the app. The dialog DOM is built once; re-calls
 * only swap the deps (idempotent). Throws when #settings-modal-root is missing.
 */
export function wireSettingsModal(nextDeps: SettingsModalDeps): void {
  byId('settings-modal-root') // throws when the mount point is missing
  deps = nextDeps
  if (wired && els !== null && els.root.isConnected) return
  wired = true
  if (isOpen) {
    // The previous dialog was detached (e.g. a fresh document) — reset so the
    // rebuilt DOM starts closed.
    detachListeners()
    isOpen = false
    lastFocused = null
  }
  els = buildDialog()
}

export function openSettingsModal(): void {
  if (deps === null || els === null) throw new Error('wireSettingsModal must run before openSettingsModal')
  if (isOpen) return
  isOpen = true
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
  refreshValues()
  els.root.hidden = false
  attachListeners()
  focusFirst()
}

export function closeSettingsModal(): void {
  if (!isOpen || els === null) return
  isOpen = false
  detachListeners()
  els.root.hidden = true
  if (lastFocused !== null) {
    lastFocused.focus()
    lastFocused = null
  }
}

export function isSettingsOpen(): boolean {
  return isOpen
}