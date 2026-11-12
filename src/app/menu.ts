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

import { FORMATTING_COMMANDS } from './formatting'
import { ICON, svgEl } from './icons'
import { SHORTCUTS, labelFor } from './shortcuts'

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
  { id: 'about', label: 'About', icon: ICON.about },
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
  { id: 'list-ordered', label: 'Ordered (1, 2, 3)', hotkey: 'list-ordered' },
  { id: 'list-ordered-alpha', label: 'Ordered (a, b, c)' },
  { id: 'list-ordered-roman', label: 'Ordered (i, ii, iii)' },
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
  { id: 'spoiler', label: 'Spoiler', hotkey: 'spoiler', icon: ICON.spoiler },
  { id: 'dropdown', label: 'Dropdown', hotkey: 'dropdown', icon: ICON.dropdown },
  {
    id: 'graph',
    label: 'Graph',
    hotkey: 'graph',
    icon: ICON.graph,
    children: [
      { id: 'pie-graph', label: 'Pie chart' },
      { id: 'bar-graph', label: 'Bar chart' },
      { id: 'line-graph', label: 'Line chart' },
    ],
  },
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

  // When opened via hotkey the anchor is the full editor (view.dom, .cm-editor)
  // whose rect is the whole editor pane (left 0, bottom at pane bottom) — that
  // would place the picker at the left edge below the editor and out of view.
  // Detect the editor root and re-anchor to the caret (or centered top) instead.
  let anchorRect = anchor.getBoundingClientRect()
  const isEditorAnchor =
    anchor.classList.contains('cm-editor') ||
    anchor.classList.contains('cm-content') ||
    anchor.querySelector('.cm-content') !== null
  if (isEditorAnchor) {
    const cursorEl = anchor.querySelector('.cm-cursor') as HTMLElement | null
    if (cursorEl !== null) {
      const r = cursorEl.getBoundingClientRect()
      // Place below the caret; if caret coords are empty (detached), fall back.
      if (r.width !== 0 || r.height !== 0) {
        anchorRect = r as DOMRect
      }
    }
    if (cursorEl === null || (anchorRect.width === 0 && anchorRect.height === 0)) {
      // Fallback: center-top of the editor, just below the toolbar area.
      const pickerHalf = 122 // 244px / 2
      const centerX = anchor.getBoundingClientRect().left + anchor.getBoundingClientRect().width / 2
      const left = Math.max(8, Math.min(centerX - pickerHalf, window.innerWidth - 244 - 8))
      const top = Math.max(8, Math.round(anchor.getBoundingClientRect().top + 48))
      root.style.left = `${Math.round(left)}px`
      root.style.top = `${top}px`
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
      return
    }
  }
  // Clamp to viewport so the picker never overflows horizontally and stays
  // visible when the anchor is near the right edge (toolbar Extra button) or
  // when the caret is near the viewport edge.
  const pickerWidth = 244
  let left = Math.round(anchorRect.left)
  let top = Math.round(anchorRect.bottom + 6)
  // If anchor is the caret (isEditorAnchor true above), anchorRect is the
  // caret rect — keep the picker below it; for toolbar buttons, anchorRect
  // is the button rect (bottom is below the button). Both work with the same
  // formula.
  left = Math.max(8, Math.min(left, window.innerWidth - pickerWidth - 8))
  // If the picker would overflow the bottom edge, flip it above the anchor.
  const pickerHeight = 260 // approx (search + grid)
  if (top + pickerHeight > window.innerHeight - 8) {
    const flipped = Math.round(anchorRect.top - pickerHeight - 6)
    if (flipped >= 8) top = flipped
  }
  top = Math.max(8, top)
  root.style.left = `${left}px`
  root.style.top = `${top}px`

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
