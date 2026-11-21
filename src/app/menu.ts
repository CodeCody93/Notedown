// M3 — data-driven menu/toolbar definitions + rendering (PLAN §8).
//
// The action ids in this module are LOCKED: app.ts's dispatcher consumes the
// `data-action` attribute on every rendered button/menu-item, so renaming any id
// here breaks menu clicks. Hotkey hints come from `shortcuts.labelFor()` so the
// displayed chords always match the real keymap (the M3 hotkey-consistency
// acceptance criterion).
//
// Rendering is plain DOM (createElement + textContent for labels/hotkeys); the
// only innerHTML ever set is the static inline-SVG markup for icons. No user
// input flows into it, so there is no injection surface.

import { closeEmojiPicker } from './emojiPicker'
import { FORMATTING_COMMANDS } from './formatting'
import {
  EXTRA_MENU,
  FORMATTING_TOOLBAR_GROUPS,
  type FormattingMenuEntry,
} from './formattingMenu'
import { ICON, svgEl } from './icons'
import { SHORTCUTS, labelFor } from './shortcuts'

// Re-exported so existing imports from './menu' keep working.
export { EMOJI_LIST, closeEmojiPicker, openEmojiPicker } from './emojiPicker'
export { EXTRA_MENU } from './formattingMenu'

/** One row of the data-driven menu/toolbar (PLAN §8). */
export interface MenuEntry extends FormattingMenuEntry {
  /** Submenu entries (shown for Header, List, Open Recent, Graph). */
  children?: MenuEntry[]
  /** True → render a <hr> separator before this entry. */
  dividerBefore?: boolean
  /** 'recents' → this submenu contains the dynamic <div id="recent-list" class="recent-list"></div> placeholder (filled by app.ts renderRecents) plus a 'Clear recent' entry. */
  dynamicList?: 'recents'
}

// ---------------------------------------------------------------------------
// Menu data (LOCKED structure — app.ts depends on these data-action ids)
// ---------------------------------------------------------------------------

export const FILE_MENU: MenuEntry[] = [
  { id: 'new', label: 'New', hotkey: 'new', icon: ICON.new },
  { id: 'open', label: 'Open', hotkey: 'open', icon: ICON.open },
  {
    id: 'open-recent',
    label: 'Open Recent',
    hotkey: 'open-recent',
    icon: ICON.openRecent,
    children: [{ id: 'open-recent-list', label: 'Open recent files', dynamicList: 'recents' }],
  },
  { id: 'import', label: 'Import…', icon: ICON.import },
  { id: 'save', label: 'Save', hotkey: 'save', icon: ICON.save, dividerBefore: true },
  { id: 'save-as', label: 'Save as', hotkey: 'save-as', icon: ICON.saveAs },
  { id: 'export', label: 'Export…', hotkey: 'export', icon: ICON.export },
  { id: 'settings', label: 'Settings', hotkey: 'settings', icon: ICON.settings, dividerBefore: true },
  { id: 'help', label: 'Help', icon: ICON.help },
  { id: 'check-updates', label: 'Check for updates…', icon: ICON.update, dividerBefore: true },
  { id: 'about', label: 'About', icon: ICON.about },
]

/** Toolbar groups: navigation, history/clipboard, inline, blocks (+ header/list), Extra dropdown. */
export const TOOLBAR_GROUPS: MenuEntry[][] = [
  [
    { id: 'navigator', label: 'Navigator', hotkey: 'toggle-navigator', icon: ICON.navigator },
    { id: 'undo', label: 'Undo', hotkey: 'undo', icon: ICON.undo },
    { id: 'redo', label: 'Redo', hotkey: 'redo', icon: ICON.redo },
    { id: 'copy', label: 'Copy', hotkey: 'copy', icon: ICON.copy },
    { id: 'cut', label: 'Cut', hotkey: 'cut', icon: ICON.cut },
    { id: 'paste', label: 'Paste', hotkey: 'paste', icon: ICON.paste },
  ],
  ...FORMATTING_TOOLBAR_GROUPS,
]

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function appendMenuIcon(el: HTMLElement, entry: MenuEntry): void {
  if (entry.glyph !== undefined) {
    const icon = document.createElement('span')
    icon.className = 'menu-icon menu-icon-glyph'
    const g = document.createElement('span')
    g.className = 'glyph'
    g.textContent = entry.glyph
    icon.appendChild(g)
    el.appendChild(icon)
  } else if (entry.icon !== undefined) {
    const icon = document.createElement('span')
    icon.className = 'menu-icon'
    icon.appendChild(svgEl(entry.icon))
    el.appendChild(icon)
  }
}

function appendMenuLabel(el: HTMLElement, entry: MenuEntry): void {
  const label = document.createElement('span')
  label.className = 'menu-label'
  label.textContent = entry.label
  el.appendChild(label)
}

function appendHotkey(el: HTMLElement, hotkeyId: string): void {
  const hk = document.createElement('span')
  hk.className = 'hotkey'
  hk.textContent = labelFor(hotkeyId)
  el.appendChild(hk)
}

/**
 * Renders one entry into a `.dropdown-panel` parent. `dividerBefore` emits an
 * `<hr>` first; a `dynamicList:'recents'` entry emits the `#recent-list`
 * placeholder + divider + 'Clear recent' button; entries with `children` become
 * hover-open `submenu-toggle` rows; everything else becomes a plain
 * `data-action` menu-item button.
 */
function renderMenuEntry(parent: HTMLElement, entry: MenuEntry): void {
  if (entry.dividerBefore) {
    parent.appendChild(document.createElement('hr'))
  }

  if (entry.dynamicList === 'recents') {
    const list = document.createElement('div')
    list.id = 'recent-list'
    list.className = 'recent-list'
    parent.appendChild(list)
    parent.appendChild(document.createElement('hr'))
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'menu-item'
    clear.dataset.action = 'clear-recents'
    clear.textContent = 'Clear recent'
    parent.appendChild(clear)
    return
  }

  if (entry.children !== undefined && entry.children.length > 0) {
    const toggle = document.createElement('div')
    toggle.className = 'menu-item submenu-toggle'
    toggle.dataset.action = entry.id
    toggle.setAttribute('role', 'menuitem')
    toggle.setAttribute('aria-haspopup', 'menu')
    toggle.setAttribute('aria-expanded', 'false')
    appendMenuIcon(toggle, entry)
    appendMenuLabel(toggle, entry)
    if (entry.hotkey !== undefined) appendHotkey(toggle, entry.hotkey)
    const arrow = svgEl(ICON.submenuArrow)
    arrow.classList.add('submenu-arrow')
    toggle.appendChild(arrow)
    const panel = document.createElement('div')
    panel.className = 'dropdown-panel submenu-panel'
    panel.setAttribute('role', 'menu')
    for (const child of entry.children) renderMenuEntry(panel, child)
    toggle.appendChild(panel)
    // Keep aria-expanded in sync with the hover-open state (CSS opens on :hover).
    toggle.addEventListener('mouseenter', () => toggle.setAttribute('aria-expanded', 'true'))
    toggle.addEventListener('mouseleave', () => toggle.setAttribute('aria-expanded', 'false'))
    parent.appendChild(toggle)
    return
  }

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'menu-item'
  btn.setAttribute('role', 'menuitem')
  btn.dataset.action = entry.id
  appendMenuIcon(btn, entry)
  appendMenuLabel(btn, entry)
  if (entry.hotkey !== undefined) appendHotkey(btn, entry.hotkey)
  parent.appendChild(btn)
}

function renderFileMenu(parent: HTMLElement): void {
  const dropdown = document.createElement('div')
  dropdown.className = 'dropdown'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'dropdown-trigger'
  trigger.dataset.action = 'file'
  trigger.setAttribute('role', 'menuitem')
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.appendChild(document.createTextNode('File'))
  trigger.appendChild(svgEl(ICON.chevron))

  const panel = document.createElement('div')
  panel.className = 'dropdown-panel'
  panel.setAttribute('role', 'menu')
  for (const entry of FILE_MENU) renderMenuEntry(panel, entry)

  dropdown.append(trigger, panel)
  attachDropdown(dropdown)
  parent.appendChild(dropdown)
}

function renderToolButton(parent: HTMLElement, entry: MenuEntry): void {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'tool-btn'
  btn.dataset.action = entry.id
  btn.setAttribute('aria-label', entry.label)
  btn.title = entry.hotkey !== undefined ? `${entry.label} (${labelFor(entry.hotkey)})` : entry.label
  if (entry.glyph !== undefined) {
    const g = document.createElement('span')
    g.className = 'glyph'
    g.textContent = entry.glyph
    btn.appendChild(g)
  } else if (entry.icon !== undefined) {
    btn.appendChild(svgEl(entry.icon))
  }
  parent.appendChild(btn)
}

function renderToolbarDropdown(parent: HTMLElement, entry: MenuEntry): void {
  const dropdown = document.createElement('div')
  dropdown.className = 'dropdown'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'tool-btn dropdown-trigger'
  // The List trigger uses a distinct data-action so app.ts's dispatcher (which maps
  // 'list' → runFormatting) cannot double-fire on the trigger itself.
  trigger.dataset.action = entry.id === 'list' ? 'list-trigger' : entry.id
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-label', entry.label)
  trigger.title = entry.hotkey !== undefined ? `${entry.label} (${labelFor(entry.hotkey)})` : entry.label
  if (entry.glyph !== undefined) {
    const g = document.createElement('span')
    g.className = 'glyph'
    g.textContent = entry.glyph
    trigger.appendChild(g)
  } else if (entry.icon !== undefined) {
    trigger.appendChild(svgEl(entry.icon))
  }

  const panel = document.createElement('div')
  panel.className = 'dropdown-panel'
  panel.setAttribute('role', 'menu')
  for (const child of entry.children ?? []) renderMenuEntry(panel, child)

  dropdown.append(trigger, panel)
  attachDropdown(dropdown)
  parent.appendChild(dropdown)
}

function renderToolbar(parent: HTMLElement, opts: { extraPinned: boolean }): void {
  const toolbar = document.createElement('div')
  toolbar.id = 'toolbar'
  toolbar.className = 'toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Formatting toolbar')

  for (const group of TOOLBAR_GROUPS) {
    const isExtraGroup = group.length === 1 && group[0].id === 'extra'
    if (isExtraGroup && opts.extraPinned) continue
    const groupEl = document.createElement('div')
    groupEl.className = 'toolbar-group'
    for (const entry of group) {
      if (entry.children !== undefined && entry.children.length > 0) {
        renderToolbarDropdown(groupEl, entry)
      } else {
        renderToolButton(groupEl, entry)
      }
    }
    toolbar.appendChild(groupEl)
  }
  parent.appendChild(toolbar)
}

function renderExtraRow(parent: HTMLElement): void {
  const row = document.createElement('div')
  row.id = 'extra-row'
  row.className = 'toolbar extra-row'
  row.setAttribute('role', 'toolbar')
  row.setAttribute('aria-label', 'Extra formatting')
  for (const entry of EXTRA_MENU) renderToolButton(row, entry)
  parent.appendChild(row)
}

// ---------------------------------------------------------------------------
// Dropdown open/close behavior
// ---------------------------------------------------------------------------

function closeAllDropdowns(): void {
  document.querySelectorAll<HTMLElement>('.dropdown.open').forEach((d) => {
    d.classList.remove('open')
    d.querySelector<HTMLElement>('.dropdown-trigger')?.setAttribute('aria-expanded', 'false')
  })
  document.querySelectorAll<HTMLElement>('.submenu-toggle.open').forEach((s) => {
    s.classList.remove('open')
    s.setAttribute('aria-expanded', 'false')
  })
}

/** Click a `.dropdown-trigger` toggles `.open` on its wrapping `.dropdown`. */
function attachDropdown(dropdown: HTMLElement): void {
  const trigger = dropdown.querySelector<HTMLElement>('.dropdown-trigger')
  if (trigger === null) return
  trigger.addEventListener('click', (ev) => {
    ev.stopPropagation()
    // Toggle semantics: decide the target state first, then close every open
    // dropdown and the emoji picker document-wide (the File dropdown's parent
    // is #menubar-root while toolbar dropdowns' parents are .toolbar-group
    // elements, so a parent-scoped query misses the others; the emoji picker
    // lives outside the menubar entirely), and finally restore the target
    // state on the clicked dropdown so only one popover is open at a time.
    const targetOpen = !dropdown.classList.contains('open')
    closeAllDropdowns()
    closeEmojiPicker()
    dropdown.classList.toggle('open', targetOpen)
    trigger.setAttribute('aria-expanded', String(targetOpen))
  })
}

let cleanupGlobals: (() => void) | null = null

/**
 * Installs (once per renderMenubar) the document-level listeners: any click that
 * reaches the document closes all open dropdowns (trigger clicks stopPropagation,
 * so they never reach here — a menu-item click has already dispatched its action
 * via app.ts), Escape closes everything including the emoji picker, and window
 * blur closes everything too.
 */
function installGlobalListeners(): void {
  if (cleanupGlobals !== null) {
    cleanupGlobals()
    cleanupGlobals = null
  }
  const onDocClick = (): void => {
    closeAllDropdowns()
  }
  const onDocKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      closeAllDropdowns()
      closeEmojiPicker()
    }
  }
  // Window blur (alt-tab / clicking outside the window) closes everything.
  const onBlur = (): void => {
    closeAllDropdowns()
    closeEmojiPicker()
  }
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
  window.addEventListener('blur', onBlur)
  cleanupGlobals = () => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onDocKey)
    window.removeEventListener('blur', onBlur)
    cleanupGlobals = null
  }
}

/**
 * Render the whole menubar (File dropdown + toolbar groups + Extra) into `root`,
 * wiping its prior content. `opts.extraPinned=true` renders the Extra items as a
 * second permanent toolbar row instead of a dropdown. All rendered buttons get a
 * `data-action` attribute consumed by app.ts's dispatcher.
 */
export function renderMenubar(root: HTMLElement, opts: { extraPinned: boolean }): void {
  installGlobalListeners()
  root.textContent = ''

  renderFileMenu(root)
  renderToolbar(root, opts)
  if (opts.extraPinned) renderExtraRow(root)
}

// ---------------------------------------------------------------------------
// CM6 formatting hotkey layer
// ---------------------------------------------------------------------------

/** Ids of SHORTCUTS that also exist in FORMATTING_COMMANDS (the hotkey-bound set). 'table' is excluded — it opens the table builder via tableHotkeyMap instead of the legacy template insert. */
export function formattingHotkeyIds(): string[] {
  return SHORTCUTS.filter((s) => s.id in FORMATTING_COMMANDS && s.id !== 'table').map((s) => s.id)
}

/**
 * KeyBindings for every SHORTCUT whose id exists in FORMATTING_COMMANDS, running
 * that command against the view (a single undo step). Implementation lives in
 * ./formatting (next to FORMATTING_COMMANDS); re-exported here so existing
 * imports from './menu' keep working.
 */
export { formattingHotkeyMap } from './formatting'
