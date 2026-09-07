/**
 * Help modal (P4): the Help dialog rendering HELP_SUMMARY, a table of contents
 * and one section per HELP_ENTRIES entry.
 *
 * Mirrors src/app/settingsUI.ts deliberately: module-level state (no classes),
 * dialog DOM built once at wire time, every listener attached on open and
 * removed on close, backdrop + Escape close, Tab focus trap, and focus restored
 * to the opener on close.
 *
 * Mount point: #help-modal-root when present, otherwise a div created and
 * appended to document.body — so importing this module never throws and wiring
 * works even before the host HTML adds the root. All strings render via
 * textContent, never innerHTML.
 */

import { HELP_ENTRIES, HELP_SUMMARY } from './helpContent'
import { labelFor } from './shortcuts'

interface HelpEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  closeBtn: HTMLButtonElement
}

let els: HelpEls | null = null
let wired = false
let isOpen = false
let lastFocused: HTMLElement | null = null
let onClose: (() => void) | null = null

/** Options for {@link openHelpModal}. */
export interface HelpModalOptions {
  /** Called once after any user-initiated close (× / backdrop / Esc). */
  onClose?: () => void
}

/** #help-modal-root when present, else a created div appended to body. */
function resolveRoot(): HTMLElement {
  const existing = document.getElementById('help-modal-root')
  if (existing !== null) return existing
  const created = document.createElement('div')
  created.id = 'help-modal-root'
  document.body.appendChild(created)
  return created
}

function sectionId(id: string): string {
  return `help-${id}`
}

function buildToc(): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'help-toc'
  nav.setAttribute('aria-label', 'Help topics')
  for (const entry of HELP_ENTRIES) {
    const link = document.createElement('a')
    link.className = 'help-toc-link'
    link.setAttribute('href', `#${sectionId(entry.id)}`)
    link.textContent = entry.title
    nav.appendChild(link)
  }
  return nav
}

function buildSection(entry: (typeof HELP_ENTRIES)[number]): HTMLElement {
  const section = document.createElement('section')
  section.className = 'help-section'
  section.id = sectionId(entry.id)

  const heading = document.createElement('h3')
  heading.className = 'help-section-title'
  heading.textContent = entry.title
  section.appendChild(heading)

  const example = document.createElement('p')
  example.className = 'help-example'
  example.textContent = entry.example
  section.appendChild(example)

  if (entry.syntax !== '') {
    const syntax = document.createElement('code')
    syntax.className = 'help-syntax'
    syntax.textContent = entry.syntax
    section.appendChild(syntax)
  }

  if (entry.hotkeyId !== null) {
    const label = labelFor(entry.hotkeyId)
    if (label !== '') {
      const hotkey = document.createElement('span')
      hotkey.className = 'help-hotkey'
      hotkey.textContent = label
      section.appendChild(hotkey)
    }
  }

  return section
}

function buildDialog(): HelpEls {
  const root = resolveRoot()
  const backdrop = document.createElement('div')
  backdrop.className = 'help-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'help-dialog'
  dialog.id = 'help-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'help-title')

  const header = document.createElement('header')
  header.className = 'help-header'
  const title = document.createElement('h2')
  title.id = 'help-title'
  title.className = 'help-title'
  title.textContent = 'Help'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'help-close'
  closeBtn.setAttribute('aria-label', 'Close help')
  closeBtn.textContent = '×'
  header.append(title, closeBtn)

  const summary = document.createElement('p')
  summary.className = 'help-summary'
  summary.textContent = HELP_SUMMARY

  const grid = document.createElement('div')
  grid.className = 'help-grid'
  const content = document.createElement('div')
  content.className = 'help-content'
  for (const entry of HELP_ENTRIES) content.appendChild(buildSection(entry))
  grid.append(buildToc(), content)

  dialog.append(header, summary, grid)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return { root, backdrop, dialog, closeBtn }
}

// --- handlers ---

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    closeHelpModal()
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
  if (els !== null && ev.target === els.backdrop) closeHelpModal()
}

function onCloseClick(): void {
  closeHelpModal()
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.backdrop.addEventListener('click', onBackdropClick)
  els.closeBtn.addEventListener('click', onCloseClick)
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.backdrop.removeEventListener('click', onBackdropClick)
  els.closeBtn.removeEventListener('click', onCloseClick)
}

function focusableElements(): HTMLElement[] {
  if (els === null) return []
  return Array.from(els.dialog.querySelectorAll<HTMLElement>('button, a[href]'))
}

function focusFirst(): void {
  const first = focusableElements()[0]
  if (first !== undefined) first.focus()
}

// --- exported API ---

/**
 * Attach the help modal to the app. The dialog DOM is built once; re-calls are
 * idempotent. Mounts into #help-modal-root, creating it under document.body
 * when the host HTML has not added it yet.
 */
export function wireHelpModal(): void {
  if (wired && els !== null && els.root.isConnected) return
  wired = true
  if (isOpen) {
    detachListeners()
    isOpen = false
    lastFocused = null
    onClose = null
  }
  els = buildDialog()
}

export function openHelpModal(opts?: HelpModalOptions): void {
  if (els === null) throw new Error('wireHelpModal must run before openHelpModal')
  if (isOpen) return
  isOpen = true
  onClose = opts?.onClose ?? null
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
  els.root.hidden = false
  attachListeners()
  focusFirst()
}

export function closeHelpModal(): void {
  if (!isOpen || els === null) return
  isOpen = false
  detachListeners()
  els.root.hidden = true
  if (lastFocused !== null) {
    lastFocused.focus()
    lastFocused = null
  }
  // Round-6 D2: let the app restore the editor caret after any close path
  // (× / backdrop / Esc all funnel through here).
  const cb = onClose
  onClose = null
  cb?.()
}

export function isHelpOpen(): boolean {
  return isOpen
}
