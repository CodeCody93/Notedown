/**
 * About dialog (P4): app name, version, one-paragraph summary, sponsor link.
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
import pkg from '../../package.json'
import { getFileIO } from '../platform'

/**
 * Version shown in the dialog, read from the root package.json so it can never
 * drift from the release. `npm run version:bump` keeps package.json,
 * src-tauri/Cargo.toml, and tauri.conf.json in sync.
 */
export const APP_VERSION: string = pkg.version

/** GitHub Sponsors page opened by the About dialog. */
export const SPONSOR_URL = 'https://github.com/sponsors/CodeCody93'

export const ABOUT_SUMMARY: string =
  'Notedown is a Markdown note-taking app with live preview, offline-first files ' +
  'and distraction-free editing on desktop and mobile.'

interface AboutEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  closeBtn: HTMLButtonElement
  sponsorLink: HTMLAnchorElement
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

  const sponsorLink = document.createElement('a')
  sponsorLink.className = 'about-support'
  sponsorLink.setAttribute('href', SPONSOR_URL)
  sponsorLink.setAttribute('target', '_blank')
  sponsorLink.setAttribute('rel', 'noopener')
  sponsorLink.textContent = 'Sponsor Notedown'

  const actions = document.createElement('div')
  actions.className = 'about-actions'
  const doneBtn = document.createElement('button')
  doneBtn.type = 'button'
  doneBtn.className = 'about-done'
  doneBtn.textContent = 'Close'
  actions.appendChild(doneBtn)

  dialog.append(header, version, summary, sponsorLink, actions)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return { root, backdrop, dialog, closeBtn, sponsorLink }
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

/**
 * Route the sponsor link through the platform layer: Tauri opens the system
 * browser and the web target opens a new tab. The href/target/rel attributes
 * stay on the anchor for accessibility and for middle-click/copy-link use.
 */
function onSponsorClick(ev: MouseEvent): void {
  ev.preventDefault()
  void getFileIO()
    .openExternal(SPONSOR_URL)
    .catch((error: unknown) => {
      console.error('[about] failed to open the sponsor page', error)
    })
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.backdrop.addEventListener('click', onBackdropClick)
  els.closeBtn.addEventListener('click', onCloseClick)
  els.sponsorLink.addEventListener('click', onSponsorClick)
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
  els.sponsorLink.removeEventListener('click', onSponsorClick)
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
