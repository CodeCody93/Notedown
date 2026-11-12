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
import { chordLabel, keysFor } from './shortcuts'

interface HelpEls {
  root: HTMLElement
  backdrop: HTMLElement
  dialog: HTMLElement
  closeBtn: HTMLButtonElement
  toc: HTMLElement
  content: HTMLElement
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

  // The syntax chip and every effective hotkey chip share a wrapping flex row
  // (.help-meta) so multiple chords (e.g. redo) wrap tidily. Only append the
  // wrapper when it has at least one child.
  const meta = document.createElement('div')
  meta.className = 'help-meta'

  if (entry.syntax !== '') {
    const syntax = document.createElement('code')
    syntax.className = 'help-syntax'
    syntax.textContent = entry.syntax
    meta.appendChild(syntax)
  }

  if (entry.hotkeyId !== null) {
    // Every effective chord, not just the first: Windows/Linux redo has two.
    for (const chord of keysFor(entry.hotkeyId)) {
      const hotkey = document.createElement('span')
      hotkey.className = 'help-hotkey'
      hotkey.textContent = chordLabel(chord)
      meta.appendChild(hotkey)
    }
  }

  if (meta.childElementCount > 0) section.appendChild(meta)

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
  dialog.setAttribute('aria-describedby', 'help-summary')

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
  summary.id = 'help-summary'
  summary.className = 'help-summary'
  summary.textContent = HELP_SUMMARY

  const grid = document.createElement('div')
  grid.className = 'help-grid'
  const content = document.createElement('div')
  content.className = 'help-content'
  for (const entry of HELP_ENTRIES) content.appendChild(buildSection(entry))
  const toc = buildToc()
  grid.append(toc, content)

  dialog.append(header, summary, grid)
  backdrop.appendChild(dialog)
  root.appendChild(backdrop)

  return { root, backdrop, dialog, closeBtn, toc, content }
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

/**
 * TOC links scroll the guide in place. The default anchor navigation would
 * append `#help-...` to the app URL and leave it there after close, so always
 * preventDefault and scroll by element id instead. `scrollIntoView` is
 * optional-chained because jsdom does not implement it.
 */
function onDialogClick(ev: MouseEvent): void {
  if (els === null || !(ev.target instanceof Element)) return
  const link = ev.target.closest('a.help-toc-link')
  if (link === null || !els.dialog.contains(link)) return
  ev.preventDefault()
  const href = link.getAttribute('href') ?? ''
  const hashIndex = href.indexOf('#')
  if (hashIndex === -1) return
  const id = href.slice(hashIndex + 1)
  if (id === '') return
  const section = document.getElementById(id)
  section?.scrollIntoView?.({ block: 'start' })
}

function onCloseClick(): void {
  closeHelpModal()
}

// --- listener lifecycle: attached on open, removed on close (no leaks) ---

function attachListeners(): void {
  if (els === null) return
  document.addEventListener('keydown', onDocKeydown)
  els.dialog.addEventListener('keydown', onDialogKeydown)
  els.dialog.addEventListener('click', onDialogClick)
  els.backdrop.addEventListener('click', onBackdropClick)
  els.closeBtn.addEventListener('click', onCloseClick)
}

function detachListeners(): void {
  if (els === null) return
  document.removeEventListener('keydown', onDocKeydown)
  els.dialog.removeEventListener('keydown', onDialogKeydown)
  els.dialog.removeEventListener('click', onDialogClick)
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
  // Start closed even when the mount root lacks the `hidden` attribute
  // (tests host their own #help-modal-root without it).
  els.root.hidden = true
}

export function openHelpModal(opts?: HelpModalOptions): void {
  if (els === null) throw new Error('wireHelpModal must run before openHelpModal')
  if (isOpen) return
  isOpen = true
  onClose = opts?.onClose ?? null
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
  els.root.hidden = false
  // Always open the guide at the top, regardless of where it was last left.
  els.toc.scrollTop = 0
  els.content.scrollTop = 0
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
