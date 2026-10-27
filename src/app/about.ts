/**
 * About dialog (P4): app name, version, one-paragraph summary, support link.
 *
 * Mirrors src/app/settingsUI.ts deliberately: module-level state (no classes),
 * dialog DOM built once at wire time, every listener attached on open and
 * removed on close, backdrop + Escape close, Tab focus trap, and focus restored
 * to the opener on close.
 *
 * Mount point: #about-modal-root when present, otherwise a div created and
 * appended to document.body — so importing this module never throws and wiring
 * works even before the host HTML adds the root. All strings render via
 * textContent (the anchor href via setAttribute), never innerHTML.
 */

/** Keep in sync with package.json + Cargo.toml. */
export const APP_VERSION = '0.6.0'

/** PLACEHOLDER — user replaces with Ko-fi/GitHub Sponsors URL. */
export const SUPPORT_URL = 'https://example.com/support-notedown-TODO'

export const ABOUT_SUMMARY: string =
  'Notedown is a Markdown note-taking app with live preview, offline-first files ' +
  'and distraction-free editing on desktop and mobile.'

interface AboutEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  closeBtn: HTMLButtonElement
}

let els: AboutEls | null = null
let wired = false
let isOpen = false
let lastFocused: HTMLElement | null = null
let onClose: (() => void) | null = null

/** Options for {@link openAboutModal}. */
export interface AboutModalOptions {
  /** Called once after any user-initiated close (× / backdrop / Esc). */
  onClose?: () => void
}

/** #about-modal-root when present, else a created div appended to body. */
function resolveRoot(): HTMLElement {
  const existing = document.getElementById('about-modal-root')
  if (existing !== null) return existing
  const created = document.createElement('div')
  created.id = 'about-modal-root'
  document.body.appendChild(created)
  return created
}

function buildDialog(): AboutEls {
  const root = resolveRoot()
  const backdrop = document.createElement('div')
  backdrop.className = 'about-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'about-dialog'
  dialog.id = 'about-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'about-title')

  const header = document.createElement('header')
  header.className = 'about-header'
  const title = document.createElement('h2')
  title.id = 'about-title'
  title.className = 'about-title'
  title.textContent = 'Notedown'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'about-close'
  closeBtn.setAttribute('aria-label', 'Close about')
  closeBtn.textContent = '×'
  header.append(title, closeBtn)

  const version = document.createElement('p')
  version.className = 'about-version'
  version.textContent = `Version ${APP_VERSION}`

  const summary = document.createElement('p')
  summary.className = 'about-summary'
  summary.textContent = ABOUT_SUMMARY

  const support = document.createElement('a')
  support.className = 'about-support'
  support.setAttribute('href', SUPPORT_URL)
  support.setAttribute('target', '_blank')
  support.setAttribute('rel', 'noopener')
  support.textContent = 'Support Notedown'

  const actions = document.createElement('div')
  actions.className = 'about-actions'
  const doneBtn = document.createElement('button')
  doneBtn.type = 'button'
  doneBtn.className = 'about-done'
  doneBtn.textContent = 'Close'
  actions.appendChild(doneBtn)

  dialog.append(header, version, summary, support, actions)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return { root, backdrop, dialog, closeBtn }
}

// --- handlers ---

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    closeAboutModal()
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
  if (els !== null && ev.target === els.backdrop) closeAboutModal()
}

function onCloseClick(): void {
  closeAboutModal()
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.backdrop.addEventListener('click', onBackdropClick)
  els.closeBtn.addEventListener('click', onCloseClick)
  for (const done of els.dialog.querySelectorAll('.about-done')) {
    done.addEventListener('click', onCloseClick)
  }
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.backdrop.removeEventListener('click', onBackdropClick)
  els.closeBtn.removeEventListener('click', onCloseClick)
  for (const done of els.dialog.querySelectorAll('.about-done')) {
    done.removeEventListener('click', onCloseClick)
  }
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
 * Attach the about dialog to the app. The dialog DOM is built once; re-calls
 * are idempotent. Mounts into #about-modal-root, creating it under
 * document.body when the host HTML has not added it yet.
 */
export function wireAboutModal(): void {
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

export function openAboutModal(opts?: AboutModalOptions): void {
  if (els === null) throw new Error('wireAboutModal must run before openAboutModal')
  if (isOpen) return
  isOpen = true
  onClose = opts?.onClose ?? null
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
  els.root.hidden = false
  attachListeners()
  focusFirst()
}

export function closeAboutModal(): void {
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

export function isAboutOpen(): boolean {
  return isOpen
}
