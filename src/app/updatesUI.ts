/**
 * Check-for-updates dialog: version line, manual check, download/release links,
 * and the opt-in automatic-check toggle.
 *
 * Mirrors src/app/about.ts deliberately (that dialog used to host this panel):
 * module-level state (no classes), dialog DOM built once at wire time, every
 * listener attached on open and removed on close, backdrop + Escape close, Tab
 * focus trap, and focus restored to the opener on close.
 *
 * Mount point: #updates-modal-root when present, otherwise a div created and
 * appended to document.body — so importing this module never throws and wiring
 * works even before the host HTML adds the root. All strings render via
 * textContent (the anchor href via setAttribute), never innerHTML.
 */
import type { Settings } from './settings'
import { getFileIO } from '../platform'
import { APP_VERSION, checkForUpdates, getUpdateState, subscribeUpdateState } from './updates'
import type { UpdateState } from './updates'

/**
 * Version shown in the dialog, re-exported from the shared update module (which
 * reads the root package.json, so it can never drift from the release).
 */
export { APP_VERSION }

/** App-layer hooks the dialog needs; supplied by {@link wireUpdatesModal}. */
export interface UpdatesModalDeps {
  getSettings: () => Settings
  onApply: (patch: Partial<Settings>) => void
}

interface UpdatesEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  closeBtn: HTMLButtonElement
  checkBtn: HTMLButtonElement
  updateStatus: HTMLParagraphElement
  downloadLink: HTMLAnchorElement
  releaseLink: HTMLAnchorElement
  autoCheckInput: HTMLInputElement
  doneBtn: HTMLButtonElement
}

let els: UpdatesEls | null = null
let deps: UpdatesModalDeps | null = null
let wired = false
let subscribed = false
let isOpen = false
let lastFocused: HTMLElement | null = null
let onClose: (() => void) | null = null

/** Options for {@link openUpdatesModal}. */
export interface UpdatesModalOptions {
  /** Called once after any user-initiated close (× / backdrop / Esc / Close). */
  onClose?: () => void
  /** Start a forced update check as soon as the dialog opens (or is already open). */
  checkForUpdates?: boolean
}

/** #updates-modal-root when present, else a created div appended to body. */
function resolveRoot(): HTMLElement {
  const existing = document.getElementById('updates-modal-root')
  if (existing !== null) return existing
  const created = document.createElement('div')
  created.id = 'updates-modal-root'
  document.body.appendChild(created)
  return created
}

function buildDialog(): UpdatesEls {
  const root = resolveRoot()
  const backdrop = document.createElement('div')
  backdrop.className = 'updates-backdrop'

  const dialog = document.createElement('div')
  dialog.className = 'updates-dialog'
  dialog.id = 'updates-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'updates-title')

  const header = document.createElement('header')
  header.className = 'updates-header'
  const title = document.createElement('h2')
  title.id = 'updates-title'
  title.className = 'updates-title'
  title.textContent = 'Check for updates'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'updates-close'
  closeBtn.setAttribute('aria-label', 'Close check for updates')
  closeBtn.textContent = '\u00d7' // ×
  header.append(title, closeBtn)

  const version = document.createElement('p')
  version.className = 'updates-version'
  version.textContent = `Version ${APP_VERSION}`

  const panel = document.createElement('section')
  panel.className = 'updates-panel'

  const checkBtn = document.createElement('button')
  checkBtn.type = 'button'
  checkBtn.className = 'updates-check-updates'
  checkBtn.textContent = 'Check for updates'

  const updateStatus = document.createElement('p')
  updateStatus.className = 'updates-status'
  updateStatus.setAttribute('role', 'status')
  updateStatus.setAttribute('aria-live', 'polite')

  const downloadLink = document.createElement('a')
  downloadLink.className = 'updates-download'
  downloadLink.setAttribute('target', '_blank')
  downloadLink.setAttribute('rel', 'noopener')
  downloadLink.hidden = true

  const releaseLink = document.createElement('a')
  releaseLink.className = 'updates-release-notes'
  releaseLink.setAttribute('target', '_blank')
  releaseLink.setAttribute('rel', 'noopener')
  releaseLink.textContent = 'Release notes'
  releaseLink.hidden = true

  const autoLabel = document.createElement('label')
  autoLabel.className = 'updates-auto-update'
  const autoCheckInput = document.createElement('input')
  autoCheckInput.type = 'checkbox'
  autoCheckInput.className = 'updates-auto-update-input'
  const autoText = document.createElement('span')
  autoText.textContent = 'Check for updates automatically'
  autoLabel.append(autoCheckInput, autoText)

  panel.append(checkBtn, updateStatus, downloadLink, releaseLink, autoLabel)

  const actions = document.createElement('div')
  actions.className = 'updates-actions'
  const doneBtn = document.createElement('button')
  doneBtn.type = 'button'
  doneBtn.className = 'updates-done'
  doneBtn.textContent = 'Close'
  actions.appendChild(doneBtn)

  dialog.append(header, version, panel, actions)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return {
    root,
    backdrop,
    dialog,
    closeBtn,
    checkBtn,
    updateStatus,
    downloadLink,
    releaseLink,
    autoCheckInput,
    doneBtn,
  }
}

// --- update state rendering ---

function hideUpdateLink(link: HTMLAnchorElement): void {
  link.hidden = true
  link.removeAttribute('href')
}

function showUpdateLink(link: HTMLAnchorElement, url: string, text: string): void {
  link.setAttribute('href', url)
  link.textContent = text
  link.hidden = false
}

/**
 * Paint the shared update store into the dialog. Runs on every store change,
 * even while the dialog is closed, so reopening it never flashes stale text.
 */
function renderUpdate(state: UpdateState): void {
  if (els === null) return
  const result = state.result
  const checking = state.phase === 'checking'
  els.checkBtn.disabled = checking
  els.checkBtn.textContent = checking ? 'Checking…' : 'Check for updates'

  if (checking) {
    els.updateStatus.textContent = 'Checking for updates…'
    hideUpdateLink(els.downloadLink)
    hideUpdateLink(els.releaseLink)
    return
  }

  if (result === null) {
    els.updateStatus.textContent = ''
    hideUpdateLink(els.downloadLink)
    hideUpdateLink(els.releaseLink)
    return
  }

  switch (result.status) {
    case 'up-to-date':
      els.updateStatus.textContent = `You're on the latest version (${result.currentVersion}).`
      hideUpdateLink(els.downloadLink)
      showUpdateLink(els.releaseLink, result.releaseUrl, 'Release notes')
      break
    case 'available':
      els.updateStatus.textContent = `Notedown ${result.latestVersion} is available.`
      if (result.download !== null) {
        showUpdateLink(
          els.downloadLink,
          result.download.url,
          `Download ${result.latestVersion} (${result.download.label})`,
        )
        showUpdateLink(els.releaseLink, result.releaseUrl, 'Release notes')
      } else {
        // No validated installer for this platform: one primary link to the
        // release page, no duplicate release-notes link.
        showUpdateLink(els.downloadLink, result.releaseUrl, 'Open the release page')
        hideUpdateLink(els.releaseLink)
      }
      break
    case 'error':
      els.updateStatus.textContent = `Couldn't check for updates. ${result.message}`
      hideUpdateLink(els.downloadLink)
      showUpdateLink(els.releaseLink, result.releaseUrl, 'View releases on GitHub')
      break
  }
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  // Only one subscription per page, even across re-wires; renderUpdate always
  // reads the current module-level `els`.
  subscribeUpdateState((state) => {
    renderUpdate(state)
  })
}

// --- handlers ---

function startUpdateCheck(): void {
  void checkForUpdates({ force: true }).catch(() => {
    // The store already renders an error result; never surface an unhandled
    // rejection from a user-initiated check.
  })
}

function onCheckUpdatesClick(): void {
  startUpdateCheck()
}

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    closeUpdatesModal()
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
  if (els !== null && ev.target === els.backdrop) closeUpdatesModal()
}

function onCloseClick(): void {
  closeUpdatesModal()
}

/** Route the update links through the platform layer: system browser on
 *  desktop, new tab on the web. The href/target/rel attributes stay on the
 *  anchors for accessibility and for middle-click/copy-link use. */
function onUpdateLinkClick(ev: MouseEvent): void {
  const target = ev.currentTarget
  if (!(target instanceof HTMLAnchorElement)) return
  const href = target.getAttribute('href')
  if (href === null || href === '') return
  ev.preventDefault()
  void getFileIO()
    .openExternal(href)
    .catch((error: unknown) => {
      console.warn('[updates] failed to open the update page', error)
    })
}

function onAutoCheckChange(): void {
  if (els === null || deps === null) return
  deps.onApply({ autoCheckForUpdates: els.autoCheckInput.checked })
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.backdrop.addEventListener('click', onBackdropClick)
  els.closeBtn.addEventListener('click', onCloseClick)
  els.checkBtn.addEventListener('click', onCheckUpdatesClick)
  els.downloadLink.addEventListener('click', onUpdateLinkClick)
  els.releaseLink.addEventListener('click', onUpdateLinkClick)
  els.autoCheckInput.addEventListener('change', onAutoCheckChange)
  els.doneBtn.addEventListener('click', onCloseClick)
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.backdrop.removeEventListener('click', onBackdropClick)
  els.closeBtn.removeEventListener('click', onCloseClick)
  els.checkBtn.removeEventListener('click', onCheckUpdatesClick)
  els.downloadLink.removeEventListener('click', onUpdateLinkClick)
  els.releaseLink.removeEventListener('click', onUpdateLinkClick)
  els.autoCheckInput.removeEventListener('change', onAutoCheckChange)
  els.doneBtn.removeEventListener('click', onCloseClick)
}

/**
 * Hidden controls (the collapsed update links) are not focusable, so they must
 * not participate in the Tab wrap or it would jump to an invisible target.
 */
function focusableElements(): HTMLElement[] {
  if (els === null) return []
  return Array.from(els.dialog.querySelectorAll<HTMLElement>('button, a[href], input')).filter(
    (el) => !el.hidden && el.closest('[hidden]') === null,
  )
}

function focusFirst(): void {
  const first = focusableElements()[0]
  if (first !== undefined) first.focus()
}

// --- exported API ---

/**
 * Attach the dialog to the app. The dialog DOM is built once; re-calls are
 * idempotent (they refresh deps and re-render the update state). Mounts into
 * #updates-modal-root, creating it under document.body when the host HTML has
 * not added it yet.
 */
export function wireUpdatesModal(nextDeps: UpdatesModalDeps): void {
  deps = nextDeps
  ensureSubscribed()
  if (!wired || els === null || !els.root.isConnected) {
    wired = true
    if (isOpen) {
      detachListeners()
      isOpen = false
      lastFocused = null
      onClose = null
    }
    els = buildDialog()
    // Start closed even when the mount root lacks the `hidden` attribute
    // (tests host their own #updates-modal-root without it).
    els.root.hidden = true
  }
  // A closed dialog is never visible, even after a re-wire of a root whose
  // hidden attribute was removed by the host.
  if (!isOpen && els !== null) els.root.hidden = true
  renderUpdate(getUpdateState())
}

export function openUpdatesModal(opts?: UpdatesModalOptions): void {
  if (els === null) throw new Error('wireUpdatesModal must run before openUpdatesModal')
  if (isOpen) {
    // A second open (e.g. File → Check for updates while the dialog is
    // visible) still honors the check request instead of silently doing nothing.
    if (opts?.checkForUpdates === true) startUpdateCheck()
    return
  }
  isOpen = true
  onClose = opts?.onClose ?? null
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
  els.autoCheckInput.checked = deps?.getSettings().autoCheckForUpdates === true
  els.root.hidden = false
  renderUpdate(getUpdateState())
  attachListeners()
  focusFirst()
  if (opts?.checkForUpdates === true) startUpdateCheck()
}

export function closeUpdatesModal(): void {
  if (!isOpen || els === null) return
  isOpen = false
  detachListeners()
  els.root.hidden = true
  if (lastFocused !== null) {
    lastFocused.focus()
    lastFocused = null
  }
  // Let the app restore the editor caret after any close path
  // (× / backdrop / Esc / Close all funnel through here).
  const cb = onClose
  onClose = null
  cb?.()
}

export function isUpdatesOpen(): boolean {
  return isOpen
}
