/**
 * Navigator side panel: renders the document outline as a collapsible tree and
 * scrolls the editor to a heading when a row is clicked.
 *
 * Plain DOM (textContent only). The panel shell is built once inside `mount`;
 * only the tree is rebuilt when the outline actually changes. All state here is
 * local UI state — the persisted preference lives in settings and is read via
 * `setEnabled`, written via `onPreferenceChange`.
 */

import { parseOutline, type OutlineHeading } from './outline'
import type { EditorController } from '../editor/editor'

export interface NavigatorDeps {
  /** The #navigator-panel mount element. */
  mount: HTMLElement
  getEditor: () => EditorController | null
  /** Persist a user-initiated enabled/disabled choice. Never call this from setEnabled (avoid loops). */
  onPreferenceChange: (enabled: boolean) => void
}

export interface NavigatorController {
  /** Recompute the outline from content; debounce (~150ms) and skip rebuilding when the outline is unchanged. docId resets per-document collapse state when it changes. */
  update(content: string, docId: string): void
  /** Apply the persisted preference. Panel is visible only when enabled AND the outline has at least one heading. */
  setEnabled(enabled: boolean): void
  /** Toolbar/hotkey toggle. Reports a preference change via onPreferenceChange when it actually flips the saved preference. */
  toggle(): void
  /** Remove listeners and cancel the debounce timer. */
  destroy(): void
}

const UPDATE_DEBOUNCE_MS = 150

function isNarrowViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 800px)').matches
  )
}

/** Compact structural fingerprint used to skip redundant re-renders. */
function serializeOutline(headings: OutlineHeading[]): string {
  return JSON.stringify(
    headings.map((heading) => [
      heading.level,
      heading.text,
      heading.line,
      heading.anchor,
      heading.key,
      serializeOutline(heading.children),
    ]),
  )
}

interface ToggleRef {
  label: string
  button: HTMLButtonElement
  childList: HTMLUListElement
}

export function createNavigator(deps: NavigatorDeps): NavigatorController {
  const { mount } = deps

  let enabled = false
  let outline: OutlineHeading[] = []
  let lastSerialized = ''
  let currentDocId: string | null = null
  let latestContent = ''
  let latestDocId = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Set when the narrow-screen overlay is closed by navigating to a heading. */
  let overlayDismissed = false
  let destroyed = false
  const collapsedKeys = new Set<string>()
  let toggleRefs: ToggleRef[] = []

  // --- panel shell (built once) ---

  mount.textContent = ''

  const header = document.createElement('div')
  header.className = 'navigator-header'

  const title = document.createElement('span')
  title.className = 'navigator-title'
  title.textContent = 'Navigator'

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'navigator-close'
  closeButton.setAttribute('aria-label', 'Close navigator')
  closeButton.title = 'Close navigator'
  closeButton.textContent = '\u00d7'

  header.append(title, closeButton)

  const nav = document.createElement('nav')
  nav.className = 'navigator-list'
  nav.setAttribute('aria-label', 'Document headings')

  mount.append(header, nav)

  const mediaQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 800px)')
      : null

  function onViewportChange(): void {
    applyVisibility()
  }

  if (mediaQuery !== null && typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onViewportChange)
  }

  // --- visibility / toolbar state ---

  function applyVisibility(): void {
    // Visible only when the preference is on, there is something to list, and
    // the narrow-screen overlay has not been dismissed for this session.
    mount.hidden = !enabled || outline.length === 0 || (overlayDismissed && isNarrowViewport())
  }

  function syncToggleButton(): void {
    if (typeof document === 'undefined') return
    document.querySelectorAll<HTMLElement>('[data-action="navigator"]').forEach((el) => {
      el.setAttribute('aria-pressed', String(enabled))
      el.classList.toggle('active', enabled)
    })
  }

  function close(): void {
    enabled = false
    applyVisibility()
    syncToggleButton()
    deps.onPreferenceChange(false)
  }

  closeButton.addEventListener('click', close)

  // --- tree rendering ---

  function setCollapsedState(ref: ToggleRef, collapsed: boolean): void {
    ref.childList.hidden = collapsed
    ref.button.setAttribute('aria-expanded', String(!collapsed))
    ref.button.textContent = collapsed ? '\u25b8' : '\u25be'
    ref.button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${ref.label}`)
  }

  function navigateTo(heading: OutlineHeading): void {
    const editor = deps.getEditor()
    editor?.setCursor(heading.line, 1)
    editor?.focus()
    if (isNarrowViewport()) {
      // Overlay only: hide locally so the editor is visible. This is not a
      // preference change, so onPreferenceChange is deliberately not called.
      overlayDismissed = true
      applyVisibility()
    }
  }

  function buildItem(heading: OutlineHeading): HTMLLIElement {
    const item = document.createElement('li')
    item.className = 'navigator-item'

    const row = document.createElement('div')
    row.className = 'navigator-row'
    row.dataset.level = String(heading.level)
    row.style.setProperty('--nav-level', String(Math.max(0, heading.level - 1)))

    const label = heading.text.trim() !== '' ? heading.text : 'section'
    const collapsed = collapsedKeys.has(heading.key)
    const hasChildren = heading.children.length > 0
    let toggleButton: HTMLButtonElement | null = null

    if (hasChildren) {
      toggleButton = document.createElement('button')
      toggleButton.type = 'button'
      toggleButton.className = 'navigator-toggle'
      toggleButton.textContent = collapsed ? '\u25b8' : '\u25be'
      toggleButton.setAttribute('aria-expanded', String(!collapsed))
      toggleButton.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${label}`)
      row.appendChild(toggleButton)
    } else {
      const spacer = document.createElement('span')
      spacer.className = 'navigator-toggle-spacer'
      spacer.setAttribute('aria-hidden', 'true')
      row.appendChild(spacer)
    }

    const link = document.createElement('button')
    link.type = 'button'
    link.className = 'navigator-link'
    link.textContent = heading.text
    link.addEventListener('click', () => {
      navigateTo(heading)
    })
    row.appendChild(link)

    item.appendChild(row)

    if (hasChildren && toggleButton !== null) {
      const button = toggleButton
      const childList = document.createElement('ul')
      childList.className = 'navigator-tree navigator-sublist'
      for (const child of heading.children) childList.appendChild(buildItem(child))
      childList.hidden = collapsed
      item.appendChild(childList)

      const ref: ToggleRef = { label, button, childList }
      toggleRefs.push(ref)
      // Toggle in place: no re-render, so the disclosure keeps focus.
      button.addEventListener('click', () => {
        const nextCollapsed = !collapsedKeys.has(heading.key)
        if (nextCollapsed) collapsedKeys.add(heading.key)
        else collapsedKeys.delete(heading.key)
        setCollapsedState(ref, nextCollapsed)
      })
    }

    return item
  }

  function rebuild(next: OutlineHeading[]): void {
    outline = next
    toggleRefs = []
    nav.textContent = ''
    if (next.length === 0) return
    const root = document.createElement('ul')
    root.className = 'navigator-tree'
    for (const heading of next) root.appendChild(buildItem(heading))
    nav.appendChild(root)
  }

  function expandAllRendered(): void {
    for (const ref of toggleRefs) setCollapsedState(ref, false)
  }

  function applyParsed(docId: string): void {
    const parsed = parseOutline(latestContent)
    const serialized = serializeOutline(parsed)
    const docChanged = docId !== currentDocId

    if (docChanged) {
      currentDocId = docId
      // Collapse state is per document.
      collapsedKeys.clear()
    }

    if (serialized !== lastSerialized) {
      lastSerialized = serialized
      rebuild(parsed)
    } else {
      outline = parsed
      // Same outline but a different document: the DOM tree is still valid, so
      // only re-expand the existing toggles instead of rebuilding.
      if (docChanged) expandAllRendered()
    }

    applyVisibility()
  }

  // --- public API ---

  function update(content: string, docId: string): void {
    if (destroyed) return
    // The app calls update on every state change (recents/settings/dirty), so
    // ignore calls that carry no new document data — they must not keep resetting
    // the debounce timer.
    if (content === latestContent && docId === latestDocId) return
    latestContent = content
    latestDocId = docId
    if (timer !== null) clearTimeout(timer)
    // Debounce: parsing the whole document on every keystroke would compete
    // with typing; keep only the latest content/docId.
    timer = setTimeout(() => {
      timer = null
      if (!destroyed) applyParsed(latestDocId)
    }, UPDATE_DEBOUNCE_MS)
  }

  function setEnabled(next: boolean): void {
    const wasEnabled = enabled
    enabled = next
    // Repeated setEnabled(true) calls come from ordinary app-state updates;
    // only a real off -> on transition re-opens a dismissed overlay.
    if (next && !wasEnabled) overlayDismissed = false
    applyVisibility()
    syncToggleButton()
  }

  function toggle(): void {
    if (enabled && overlayDismissed) {
      // Re-open the dismissed narrow-screen overlay without touching the
      // persisted preference.
      overlayDismissed = false
      applyVisibility()
      syncToggleButton()
      return
    }
    setEnabled(!enabled)
    deps.onPreferenceChange(enabled)
  }

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    closeButton.removeEventListener('click', close)
    if (mediaQuery !== null && typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', onViewportChange)
    }
    mount.textContent = ''
    mount.hidden = true
  }

  syncToggleButton()
  applyVisibility()

  return { update, setEnabled, toggle, destroy }
}
