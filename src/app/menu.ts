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

import type { KeyBinding } from '@codemirror/view'
import { FORMATTING_COMMANDS } from './formatting'
import { SHORTCUTS, getPlatform, labelFor } from './shortcuts'

/** One row of the data-driven menu/toolbar (PLAN §8). */
export interface MenuEntry {
  /** LOCKED action id → becomes the button's data-action attribute (consumed by app.ts's dispatcher). */
  id: string
  /** Human label shown in the menu row / tooltip. */
  label: string
  /** Inline SVG inner markup for a stroke-based 16×16 icon, OR undefined. */
  icon?: string
  /** Text glyph shown instead of an icon (e.g. 'H', '⋯', 'H1'). */
  glyph?: string
  /** Shortcut id (a SHORTCUTS id) whose label renders as the right-aligned hotkey hint. */
  hotkey?: string
  /** Submenu entries (shown for Header, List, Open Recent). */
  children?: MenuEntry[]
  /** True → render a <hr> separator before this entry. */
  dividerBefore?: boolean
  /** 'recents' → this submenu contains the dynamic <div id="recent-list" class="recent-list"></div> placeholder (filled by app.ts renderRecents) plus a 'Clear recent' entry. */
  dynamicList?: 'recents'
}

// ---------------------------------------------------------------------------
// Icons — inline SVG inner markup. Paths reused verbatim from the M0 index.html
// for the icons that existed there; the rest are simple stroke-based drawings.
// ---------------------------------------------------------------------------

/** Builds a stroke-based 16×16 inline-SVG element whose children are `inner`. */
function svgEl(inner: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = inner
  return svg
}

const ICON = {
  chevron: `<path d="M4 6l4 4 4-4" />`,
  submenuArrow: `<path d="M6 3.5l4 4.5-4 4.5" />`,
  new: `<rect x="3" y="3" width="10" height="13" rx="1.5" /><path d="M8 6v6.5M4.8 9.2h6.4" />`,
  open: `<path d="M14 12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V4a1.5 1.5 0 0 1 1.5-1.5H7l1.5 2h4A1.5 1.5 0 0 1 14 6v6.5z" />`,
  openRecent: `<circle cx="8" cy="8" r="5.8" /><path d="M8 4.8V8l2.2 1.4" />`,
  save: `<rect x="3" y="3" width="10" height="10" rx="1" /><path d="M5.5 3v3.5h5V3" /><path d="M5.5 13v-3h5v3" />`,
  saveAs: `<rect x="4.5" y="5" width="8" height="8" rx="1" /><path d="M6.5 5v2.5h4V5" /><path d="M8 1.5v3.5M6.2 3.2L8 5l1.8-1.8" />`,
  export: `<path d="M4.5 1.5h4.5l3 3v9a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z" /><path d="M8.5 7.5v4M6.8 9.8l1.7 1.7 1.7-1.7" />`,
  settings: `<path d="M2.5 4.5h6M2.5 8h3.5M2.5 11.5h7" /><circle cx="11.5" cy="4.5" r="1.7" fill="currentColor" stroke="none" /><circle cx="9" cy="8" r="1.7" fill="currentColor" stroke="none" /><circle cx="12.5" cy="11.5" r="1.7" fill="currentColor" stroke="none" />`,
  undo: `<polyline points="2.5 4.5 2.5 8 6 8" /><path d="M2.5 8a6 6 0 1 0 6-6" />`,
  redo: `<polyline points="13.5 4.5 13.5 8 10 8" /><path d="M13.5 8a6 6 0 1 1-6-6" />`,
  copy: `<rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />`,
  cut: `<circle cx="4" cy="4" r="2.2" /><circle cx="4" cy="12" r="2.2" /><path d="M13.5 3L5.5 10.8M9.5 9.8l4 3.7M5.5 5.2L8 7.7" />`,
  paste: `<rect x="6.75" y="1.5" width="2.5" height="2" rx="0.75" /><path d="M10.75 3.5h1A1.5 1.5 0 0 1 13.25 5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h1" />`,
  bold: `<path d="M4 2.7h5.3a2.7 2.7 0 0 1 0 5.3H4z" /><path d="M4 8h6a2.7 2.7 0 0 1 0 5.3H4z" />`,
  italic: `<path d="M12.5 2.5H6.7M10.6 13.5H3.3M11 2.5L6 13.5" />`,
  underline: `<path d="M4.5 2.5v4.75a3.5 3.5 0 0 0 7 0V2.5" /><path d="M3 13.5h10" />`,
  strikethrough: `<path d="M11.5 2.5H6.5a2.2 2.2 0 0 0-2.1 2.9M10 8a2.9 2.9 0 0 1 0 5.5H4.5" /><path d="M2.5 8h11" />`,
  list: `<path d="M7.5 3.5h6M7.5 8h6M7.5 12.5h6" /><circle cx="3.8" cy="3.5" r="1" fill="currentColor" stroke="none" /><circle cx="3.8" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="3.8" cy="12.5" r="1" fill="currentColor" stroke="none" />`,
  // --- M3-drawn extras (simple stroke-based, recognizable) ---
  blockquote: `<path d="M5.5 5.2c-1.5.5-2.4 1.6-2.4 3.1 0 .8.4 1.5 1.2 1.9M11 5.2c-1.5.5-2.4 1.6-2.4 3.1 0 .8.4 1.5 1.2 1.9" />`,
  inlineCode: `<path d="M6.2 4L3.2 8l3 4M9.8 4l3 4-3 4" />`,
  codeBlock: `<path d="M5.5 3.5L3 8l2.5 4.5M10.5 3.5L13 8l-2.5 4.5" />`,
  link: `<path d="M8.5 7.5l-1 1a2.4 2.4 0 0 0 3.4 3.4l1.5-1.5a2.4 2.4 0 0 0-3.4-3.4M7.5 8.5l1-1a2.4 2.4 0 0 0-3.4-3.4L3.6 5.6a2.4 2.4 0 0 0 3.4 3.4" />`,
  image: `<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" /><circle cx="6" cy="7" r="0.9" /><path d="M2.8 12l3.2-2.8 2.1 2L10.5 8.8l2.7 2.9" />`,
  table: `<rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M6 3v10" />`,
  hr: `<path d="M2.5 8h11" />`,
  footnote: `<rect x="5.5" y="2.5" width="4" height="4.2" rx="0.9" /><path d="M2.5 12.5h11" />`,
  taskList: `<rect x="3" y="3" width="10" height="10" rx="1.5" /><path d="M5.5 8l2 2 3.5-3.5" />`,
  emoji: `<circle cx="8" cy="8" r="5.8" /><path d="M5.6 9.3a2.7 2.7 0 0 0 4.8 0" /><path d="M6 6.2h.01M10 6.2h.01" />`,
  headingId: `<path d="M6.3 2.5l-1.6 11M11.3 2.5L9.7 13.5M3.5 6h9.8M3 10.5h9.8" />`,
  defList: `<path d="M2.5 4.5h4.5M2.5 8.5h11M2.5 12.5h7" /><circle cx="12.4" cy="12.2" r="0.45" fill="currentColor" stroke="none" /><circle cx="12.4" cy="13.8" r="0.45" fill="currentColor" stroke="none" />`,
  sub: `<path d="M3 3.5L6.5 7M6.5 3.5L3 7" /><path d="M9.5 9.5h3.2" /><path d="M11 11.2V13.7" /><path d="M9.5 13.4c.2-.7.7-1 1.3-1 .6 0 1 .3 1 .8 0 .4-.4.7-1 .7-.5 0-.9-.2-1.1-.6" />`,
  sup: `<path d="M3 4L6.5 7.5M6.5 4L3 7.5" /><path d="M9.5 3.5h3.2" /><path d="M11 5.2v2.5" /><path d="M9.5 7.4c.2-.7.7-1 1.3-1 .6 0 1 .3 1 .8 0 .4-.4.7-1 .7-.5 0-.9-.2-1.1-.6" />`,
  highlight: `<path d="M5 12l3.5 3.5L11 13 7.5 9.5 5 12z" /><path d="M9.5 7.5L13 11l-2 2-3.5-3.5 2-2z" /><path d="M12.5 4.5l1-1 1 1-1 1z" />`,
} as const

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
  { id: 'save', label: 'Save', hotkey: 'save', icon: ICON.save, dividerBefore: true },
  { id: 'save-as', label: 'Save as', hotkey: 'save-as', icon: ICON.saveAs },
  { id: 'export-html', label: 'Export HTML…', hotkey: 'export-html', icon: ICON.export },
  { id: 'settings', label: 'Settings', hotkey: 'settings', icon: ICON.settings, dividerBefore: true },
]

const HEADER_ITEMS: MenuEntry[] = [
  { id: 'header-0', label: 'Paragraph', glyph: '¶', hotkey: 'header-0' },
  { id: 'header-1', label: 'Heading 1', glyph: 'H1', hotkey: 'header-1' },
  { id: 'header-2', label: 'Heading 2', glyph: 'H2', hotkey: 'header-2' },
  { id: 'header-3', label: 'Heading 3', glyph: 'H3', hotkey: 'header-3' },
  { id: 'header-4', label: 'Heading 4', glyph: 'H4', hotkey: 'header-4' },
  { id: 'header-5', label: 'Heading 5', glyph: 'H5', hotkey: 'header-5' },
  { id: 'header-6', label: 'Heading 6', glyph: 'H6', hotkey: 'header-6' },
]

const LIST_ITEMS: MenuEntry[] = [
  { id: 'list-unordered', label: 'Unordered', hotkey: 'list' },
  { id: 'list-ordered', label: 'Ordered', hotkey: 'list-ordered' },
  { id: 'list-task', label: 'Task', hotkey: 'task-list' },
]

export const EXTRA_MENU: MenuEntry[] = [
  { id: 'blockquote', label: 'Blockquote', hotkey: 'blockquote', icon: ICON.blockquote },
  { id: 'inline-code', label: 'Inline code', hotkey: 'inline-code', icon: ICON.inlineCode },
  { id: 'code-block', label: 'Code block', hotkey: 'code-block', icon: ICON.codeBlock },
  { id: 'link', label: 'Link', hotkey: 'link', icon: ICON.link },
  { id: 'image', label: 'Image', hotkey: 'image', icon: ICON.image },
  { id: 'table', label: 'Table', hotkey: 'table', icon: ICON.table },
  { id: 'hr', label: 'Horizontal rule', hotkey: 'hr', icon: ICON.hr },
  { id: 'footnote', label: 'Footnote', hotkey: 'footnote', icon: ICON.footnote },
  { id: 'task-list', label: 'Task list', hotkey: 'task-list', icon: ICON.taskList },
  { id: 'emoji', label: 'Emoji picker', hotkey: 'emoji', icon: ICON.emoji },
  { id: 'heading-id', label: 'Heading ID', hotkey: 'heading-id', icon: ICON.headingId },
  { id: 'def-list', label: 'Definition list', hotkey: 'def-list', icon: ICON.defList },
  { id: 'sub', label: 'Subscript', hotkey: 'sub', icon: ICON.sub },
  { id: 'sup', label: 'Superscript', hotkey: 'sup', icon: ICON.sup },
  { id: 'highlight', label: 'Highlight', hotkey: 'highlight', icon: ICON.highlight },
]

/** Toolbar groups: history/clipboard, inline, blocks (+ header/list), Extra dropdown. */
export const TOOLBAR_GROUPS: MenuEntry[][] = [
  [
    { id: 'undo', label: 'Undo', hotkey: 'undo', icon: ICON.undo },
    { id: 'redo', label: 'Redo', hotkey: 'redo', icon: ICON.redo },
    { id: 'copy', label: 'Copy', hotkey: 'copy', icon: ICON.copy },
    { id: 'cut', label: 'Cut', hotkey: 'cut', icon: ICON.cut },
    { id: 'paste', label: 'Paste', hotkey: 'paste', icon: ICON.paste },
  ],
  [
    { id: 'bold', label: 'Bold', hotkey: 'bold', icon: ICON.bold },
    { id: 'italic', label: 'Italic', hotkey: 'italic', icon: ICON.italic },
    { id: 'underline', label: 'Underline', hotkey: 'underline', icon: ICON.underline },
    { id: 'strikethrough', label: 'Strikethrough', hotkey: 'strikethrough', icon: ICON.strikethrough },
    { id: 'header', label: 'Header', hotkey: 'header-cycle', glyph: 'H', children: HEADER_ITEMS },
    { id: 'list', label: 'List', hotkey: 'list', icon: ICON.list, children: LIST_ITEMS },
  ],
  [{ id: 'extra', label: 'Extra', glyph: '⋯', children: EXTRA_MENU }],
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
// Emoji picker
// ---------------------------------------------------------------------------

/** Curated emoji palette (char + searchable name). */
export const EMOJI_LIST: { char: string; name: string }[] = [
  { char: '😀', name: 'grinning face' },
  { char: '😃', name: 'smiley face with open mouth' },
  { char: '😄', name: 'smiling face with open mouth and smiling eyes' },
  { char: '😁', name: 'beaming face with smiling eyes' },
  { char: '😂', name: 'face with tears of joy' },
  { char: '🤣', name: 'rolling on the floor laughing' },
  { char: '😊', name: 'smiling face with smiling eyes' },
  { char: '😇', name: 'smiling face with halo' },
  { char: '🙂', name: 'slightly smiling face' },
  { char: '🙃', name: 'upside-down face' },
  { char: '😉', name: 'winking face' },
  { char: '😍', name: 'smiling face with heart-eyes' },
  { char: '😘', name: 'face blowing a kiss' },
  { char: '😋', name: 'face savoring food' },
  { char: '😎', name: 'smiling face with sunglasses' },
  { char: '🤔', name: 'thinking face' },
  { char: '🤗', name: 'hugging face' },
  { char: '🤩', name: 'star-struck face' },
  { char: '😢', name: 'crying face' },
  { char: '😭', name: 'loudly crying face' },
  { char: '😅', name: 'grinning face with sweat' },
  { char: '😳', name: 'flushed face' },
  { char: '😴', name: 'sleeping face' },
  { char: '😷', name: 'face with medical mask' },
  { char: '🤒', name: 'face with thermometer' },
  { char: '😈', name: 'smiling face with horns' },
  { char: '👻', name: 'ghost' },
  { char: '💀', name: 'skull' },
  { char: '👋', name: 'waving hand' },
  { char: '🤚', name: 'raised back of hand' },
  { char: '👌', name: 'ok hand' },
  { char: '✌️', name: 'victory hand' },
  { char: '🤞', name: 'crossed fingers' },
  { char: '👍', name: 'thumbs up' },
  { char: '👎', name: 'thumbs down' },
  { char: '👏', name: 'clapping hands' },
  { char: '🙌', name: 'raising hands' },
  { char: '🤝', name: 'handshake' },
  { char: '🙏', name: 'folded hands' },
  { char: '💪', name: 'flexed biceps' },
  { char: '👀', name: 'eyes' },
  { char: '🧠', name: 'brain' },
  { char: '❤️', name: 'red heart' },
  { char: '🧡', name: 'orange heart' },
  { char: '💛', name: 'yellow heart' },
  { char: '💚', name: 'green heart' },
  { char: '💙', name: 'blue heart' },
  { char: '💜', name: 'purple heart' },
  { char: '🖤', name: 'black heart' },
  { char: '🤍', name: 'white heart' },
  { char: '💔', name: 'broken heart' },
  { char: '💕', name: 'two hearts' },
  { char: '💯', name: 'hundred points' },
  { char: '✨', name: 'sparkles' },
  { char: '⭐', name: 'star' },
  { char: '🌟', name: 'glowing star' },
  { char: '💫', name: 'dizzy' },
  { char: '🔥', name: 'fire' },
  { char: '💧', name: 'droplet' },
  { char: '❄️', name: 'snowflake' },
  { char: '☀️', name: 'sun' },
  { char: '🌙', name: 'crescent moon' },
  { char: '🌈', name: 'rainbow' },
  { char: '☁️', name: 'cloud' },
  { char: '⚡', name: 'high voltage' },
  { char: '⏰', name: 'alarm clock' },
  { char: '⌛', name: 'hourglass done' },
  { char: '📅', name: 'calendar' },
  { char: '📌', name: 'pushpin' },
  { char: '📍', name: 'round pushpin' },
  { char: '✂️', name: 'scissors' },
  { char: '🔗', name: 'link symbol' },
  { char: '✏️', name: 'pencil' },
  { char: '📝', name: 'memo' },
  { char: '📁', name: 'file folder' },
  { char: '📂', name: 'open file folder' },
  { char: '📄', name: 'page facing up' },
  { char: '📎', name: 'paperclip' },
  { char: '🔍', name: 'magnifying glass tilted left' },
  { char: '💡', name: 'light bulb' },
  { char: '🔔', name: 'bell' },
  { char: '✅', name: 'check mark button' },
  { char: '❌', name: 'cross mark' },
  { char: '❗', name: 'red exclamation mark' },
  { char: '❓', name: 'red question mark' },
  { char: '✔️', name: 'check mark' },
  { char: '➡️', name: 'right arrow' },
  { char: '⬅️', name: 'left arrow' },
  { char: '⬆️', name: 'up arrow' },
  { char: '⬇️', name: 'down arrow' },
  { char: '↩️', name: 'right arrow curving left' },
  { char: '🔃', name: 'clockwise vertical arrows' },
  { char: '🔄', name: 'counterclockwise arrows button' },
  { char: '🔢', name: 'input numbers' },
  { char: '🔣', name: 'input symbols' },
  { char: '#️⃣', name: 'hash keycap' },
  { char: '*️⃣', name: 'asterisk keycap' },
  { char: '0️⃣', name: 'keycap digit zero' },
  { char: '1️⃣', name: 'keycap digit one' },
  { char: '2️⃣', name: 'keycap digit two' },
  { char: '3️⃣', name: 'keycap digit three' },
]

let emojiPicker: { root: HTMLElement; cleanup: () => void } | null = null

/** Close any open emoji picker (no-op when none is open). */
export function closeEmojiPicker(): void {
  if (emojiPicker === null) return
  emojiPicker.cleanup()
  emojiPicker = null
}

/**
 * Build & show a small searchable emoji popover anchored near `anchor`; clicking
 * an emoji calls `onPick(emoji)` and closes. One instance at a time (any existing
 * picker is closed first). Click-outside / Escape closes.
 */
export function openEmojiPicker(anchor: HTMLElement, onPick: (emoji: string) => void): void {
  closeEmojiPicker()

  const root = document.createElement('div')
  root.className = 'emoji-picker'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Emoji picker')

  const input = document.createElement('input')
  input.className = 'emoji-search'
  input.type = 'text'
  input.placeholder = 'Search emoji…'
  input.setAttribute('aria-label', 'Search emoji')

  const grid = document.createElement('div')
  grid.className = 'emoji-grid'

  const renderGrid = (query: string): void => {
    grid.textContent = ''
    const q = query.trim().toLowerCase()
    for (const e of EMOJI_LIST) {
      if (q !== '' && !e.name.toLowerCase().includes(q)) continue
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'emoji-cell'
      cell.textContent = e.char
      cell.title = e.name
      cell.addEventListener('click', () => {
        onPick(e.char)
        closeEmojiPicker()
      })
      grid.appendChild(cell)
    }
  }

  input.addEventListener('input', () => renderGrid(input.value))

  root.append(input, grid)
  renderGrid('')

  const anchorRect = anchor.getBoundingClientRect()
  root.style.left = `${Math.max(8, Math.round(anchorRect.left))}px`
  root.style.top = `${Math.max(8, Math.round(anchorRect.bottom) + 6)}px`

  document.body.appendChild(root)

  const onDocMousedown = (ev: MouseEvent): void => {
    const t = ev.target
    if (t instanceof Node && root.contains(t)) return
    closeEmojiPicker()
  }
  const onDocKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') closeEmojiPicker()
  }
  document.addEventListener('mousedown', onDocMousedown)
  document.addEventListener('keydown', onDocKey)
  setTimeout(() => input.focus(), 0)

  emojiPicker = {
    root,
    cleanup: () => {
      document.removeEventListener('mousedown', onDocMousedown)
      document.removeEventListener('keydown', onDocKey)
      root.remove()
    },
  }
}

// ---------------------------------------------------------------------------
// CM6 formatting hotkey layer
// ---------------------------------------------------------------------------

/** Ids of SHORTCUTS that also exist in FORMATTING_COMMANDS (the hotkey-bound set). */
export function formattingHotkeyIds(): string[] {
  return SHORTCUTS.filter((s) => s.id in FORMATTING_COMMANDS).map((s) => s.id)
}

/**
 * KeyBindings for every SHORTCUT whose id exists in FORMATTING_COMMANDS, running
 * that command against the view (a single undo step). Used as the editor's
 * formatting hotkey layer; the editor wraps the returned array with keymap.of
 * (the wrapper lives in src/editor/editor.ts so the app shell has no CM6 value
 * imports).
 */
export function formattingHotkeyMap(): KeyBinding[] {
  return SHORTCUTS.filter((s) => s.id in FORMATTING_COMMANDS).map((s) => {
    const chord = getPlatform() === 'mac' ? (s.macKeys?.[0] ?? s.keys[0]) : s.keys[0]
    return {
      key: chord,
      run: (view) => {
        view.dispatch(FORMATTING_COMMANDS[s.id](view.state))
        return true
      },
    }
  })
}
