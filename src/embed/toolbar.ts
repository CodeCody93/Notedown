/**
 * Toolbar for the embeddable editor.
 *
 * The toolbar talks to the editor only through `EditorController`, so it has no
 * CodeMirror value imports and cannot leak CM6 types to embed consumers.
 *
 * Every button:
 * - is a real `<button type="button">` with `aria-label` + `title` (the title
 *   includes the canonical chord from `src/app/shortcuts.ts` when one exists);
 * - prevents the default `mousedown` action so the editor selection and focus
 *   are not lost when the button is pressed;
 * - runs its command on `click` and then refocuses the editor.
 *
 * Dropdown entries (`{ type: 'dropdown', … }`) render a menu panel anchored to
 * their trigger. Panels are `position: fixed` (so the editor root's overflow
 * never clips them) but stay descendants of the toolbar element, which keeps
 * the theme variables and selection-preserving mousedown handling intact.
 *
 * The shared formatting data (`src/app/formattingMenu.ts`) is the single source
 * of truth for labels/icons/hotkeys, so the embed toolbar and the app menubar
 * cannot drift apart.
 */
import { openEmojiPicker, type EmojiPickerHandle } from '../app/emojiPicker'
import { FORMATTING_COMMANDS } from '../app/formatting'
import { FORMATTING_TOOLBAR_GROUPS, type FormattingMenuEntry } from '../app/formattingMenu'
import { ICON, svgEl, type IconName } from '../app/icons'
import { labelFor } from '../app/shortcuts'
import type { EditorController } from '../editor/editor'

/** Built-in icon names usable by a {@link ToolbarDropdown}. */
export type ToolbarIconName = IconName

/** Stable ids for every toolbar item (legacy ids keep working). */
export type ToolbarItem =
  | 'undo'
  | 'redo'
  | 'mode'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'header-0'
  | 'header-1'
  | 'header-2'
  | 'header-3'
  | 'header-4'
  | 'header-5'
  | 'header-6'
  | 'list-unordered'
  | 'list-ordered'
  | 'list-ordered-alpha'
  | 'list-ordered-roman'
  | 'list-task'
  | 'blockquote'
  | 'inline-code'
  | 'code-block'
  | 'link'
  | 'image'
  | 'table'
  | 'hr'
  | 'footnote'
  | 'task-list'
  | 'emoji'
  | 'heading-id'
  | 'def-list'
  | 'sub'
  | 'sup'
  | 'highlight'
  | 'spoiler'
  | 'dropdown'
  | 'pie-graph'
  | 'bar-graph'
  | 'line-graph'
  // legacy aliases (kept so existing configurations keep working)
  | 'h1'
  | 'h2'
  | 'bullet-list'
  | 'ordered-list'

/** A named menu of toolbar entries rendered behind a trigger button. */
export interface ToolbarDropdown {
  type: 'dropdown'
  /** Optional stable id copied to `data-*` attributes (host styling/tests). */
  id?: string
  /** Accessible name for the trigger. */
  label: string
  /** Built-in icon name used when no glyph is supplied. */
  icon?: ToolbarIconName
  /** Short text fallback shown instead of an icon. */
  glyph?: string
  /** Shortcut id used only for the tooltip/hotkey hint (it binds no key). */
  shortcut?: string
  /** Menu contents; dropdowns may nest. */
  items: ToolbarEntry[]
}

/** One toolbar entry: a built-in item id or a dropdown descriptor. */
export type ToolbarEntry = ToolbarItem | ToolbarDropdown

/** Items rendered together as one visually separated group. */
export type ToolbarGroup = ToolbarEntry[]

/** Named toolbar layouts. `'default'` is the compact historical toolbar. */
export type ToolbarPreset = 'default' | 'full'

/**
 * Toolbar configuration. Pass `toolbar: true` (or an empty object) to use the
 * default groups; pass explicit groups to show a subset/reorder the items.
 * Each inner array is rendered as one visually separated group.
 */
export interface ToolbarOptions {
  /** Named preset. Ignored when {@link ToolbarOptions.items} is supplied. */
  preset?: ToolbarPreset
  /** Item groups, left to right. Defaults to {@link DEFAULT_TOOLBAR_GROUPS}. */
  items?: ToolbarGroup[]
}

/** Default toolbar groups (undo/redo, inline styles, headings, lists, links, mode). */
export const DEFAULT_TOOLBAR_GROUPS: ToolbarItem[][] = [
  ['undo', 'redo'],
  ['bold', 'italic', 'strikethrough'],
  ['h1', 'h2'],
  ['bullet-list', 'ordered-list'],
  ['link', 'inline-code'],
  ['mode'],
]

/** Hard cap on nested dropdown depth (defends against cyclic plain-JS configs). */
const MAX_DROPDOWN_DEPTH = 6

type ToolbarAction = 'format' | 'undo' | 'redo' | 'mode' | 'emoji'

interface ToolbarItemDef {
  /** Accessible name (also used for the title, together with the chord hint). */
  label: string
  /** Shortcut id in `src/app/shortcuts.ts` (used for the title hint). */
  shortcutId: string
  /** Icon key from `src/app/icons.ts` (when a suitable icon exists). */
  icon?: IconName
  /** Text fallback when there is no suitable icon (H1/H2, list variants, mode). */
  glyph?: string
  action: ToolbarAction
  /** FORMATTING_COMMANDS id for `action: 'format'`. */
  commandId?: string
}

/** Own-property check used for every id/descriptor read (never `in`). */
function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/** Static SVG markup → icon name, so public descriptors expose icon names only. */
const ICON_NAME_BY_MARKUP = new Map<string, IconName>()
for (const [name, markup] of Object.entries(ICON)) {
  ICON_NAME_BY_MARKUP.set(markup, name as IconName)
}

function iconNameFor(markup: string | undefined): IconName | undefined {
  if (markup === undefined) return undefined
  return ICON_NAME_BY_MARKUP.get(markup)
}

/** Registry of item ids → labels/icons/actions, shared by every toolbar. */
const ITEM_DEFS = new Map<string, ToolbarItemDef>()

function registerItem(id: string, def: ToolbarItemDef): void {
  ITEM_DEFS.set(id, def)
}

// History, mode and emoji are special actions rather than FORMATTING_COMMANDS.
registerItem('undo', { label: 'Undo', shortcutId: 'undo', icon: 'undo', action: 'undo' })
registerItem('redo', { label: 'Redo', shortcutId: 'redo', icon: 'redo', action: 'redo' })
registerItem('mode', {
  label: 'Switch to source mode',
  shortcutId: 'toggle-mode',
  glyph: 'Live',
  action: 'mode',
})
registerItem('emoji', {
  label: 'Emoji picker',
  shortcutId: 'emoji',
  icon: 'emoji',
  action: 'emoji',
})

/**
 * Register every leaf of the shared formatting data. Leaves that have no
 * FORMATTING_COMMANDS entry (unknown/malformed descriptors) are dropped.
 */
function registerFormattingLeaves(entries: FormattingMenuEntry[], depth: number): void {
  if (depth > MAX_DROPDOWN_DEPTH) return
  for (const entry of entries) {
    const children = entry.children
    if (children !== undefined && children.length > 0) {
      registerFormattingLeaves(children, depth + 1)
      continue
    }
    const id = entry.id
    if (id === '' || ITEM_DEFS.has(id)) continue
    if (!hasOwn(FORMATTING_COMMANDS, id) || typeof FORMATTING_COMMANDS[id] !== 'function') continue
    registerItem(id, {
      label: entry.label !== '' ? entry.label : id,
      shortcutId: entry.hotkey ?? '',
      icon: iconNameFor(entry.icon),
      glyph: entry.glyph,
      action: 'format',
      commandId: id,
    })
  }
}
for (const group of FORMATTING_TOOLBAR_GROUPS) {
  registerFormattingLeaves(group, 1)
}

// Legacy aliases preserve the exact labels/tooltips/glyphs of earlier releases.
registerItem('h1', {
  label: 'Heading 1',
  shortcutId: 'header-1',
  glyph: 'H1',
  action: 'format',
  commandId: 'header-1',
})
registerItem('h2', {
  label: 'Heading 2',
  shortcutId: 'header-2',
  glyph: 'H2',
  action: 'format',
  commandId: 'header-2',
})
registerItem('bullet-list', {
  label: 'Bulleted list',
  shortcutId: 'list',
  glyph: '•',
  action: 'format',
  commandId: 'list-unordered',
})
registerItem('ordered-list', {
  label: 'Numbered list',
  shortcutId: 'list-ordered',
  glyph: '1.',
  action: 'format',
  commandId: 'list-ordered',
})

// ---------------------------------------------------------------------------
// Shared formatting data → public toolbar descriptors
// ---------------------------------------------------------------------------

function convertFormattingEntry(entry: FormattingMenuEntry, depth: number): ToolbarEntry | null {
  if (depth > MAX_DROPDOWN_DEPTH) return null
  const id = entry.id
  if (id === '') return null
  const label = entry.label !== '' ? entry.label : id
  const children = entry.children
  if (children !== undefined && children.length > 0) {
    const items = convertFormattingEntries(children, depth + 1)
    if (items.length === 0) return null
    const dropdown: ToolbarDropdown = { type: 'dropdown', id, label, items }
    const icon = iconNameFor(entry.icon)
    if (icon !== undefined) dropdown.icon = icon
    if (entry.glyph !== undefined && entry.glyph !== '') dropdown.glyph = entry.glyph
    if (entry.hotkey !== undefined && entry.hotkey !== '') dropdown.shortcut = entry.hotkey
    return dropdown
  }
  if (id === 'emoji') return 'emoji'
  if (hasOwn(FORMATTING_COMMANDS, id) && typeof FORMATTING_COMMANDS[id] === 'function') {
    return id as ToolbarItem
  }
  return null
}

function convertFormattingEntries(entries: FormattingMenuEntry[], depth: number): ToolbarEntry[] {
  const out: ToolbarEntry[] = []
  for (const entry of entries) {
    const converted = convertFormattingEntry(entry, depth)
    if (converted !== null) out.push(converted)
  }
  return out
}

function convertFormattingGroups(groups: FormattingMenuEntry[][]): ToolbarGroup[] {
  const out: ToolbarGroup[] = []
  for (const group of groups) {
    const converted = convertFormattingEntries(group, 1)
    if (converted.length > 0) out.push(converted)
  }
  return out
}

/**
 * Expanded preset: history, inline styles plus Header/List dropdowns, the Extra
 * dropdown (including the nested Graph submenu), and the mode toggle. Built from
 * `FORMATTING_TOOLBAR_GROUPS`, so it stays in lockstep with the app toolbar.
 */
export const FULL_TOOLBAR_GROUPS: ToolbarGroup[] = [
  ['undo', 'redo'],
  ...convertFormattingGroups(FORMATTING_TOOLBAR_GROUPS),
  ['mode'],
]

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function titleWithHint(label: string, shortcutId: string): string {
  const hint = shortcutId === '' ? '' : labelFor(shortcutId)
  return hint === '' ? label : `${label} (${hint})`
}

/** Menu-row icon slot (an SVG, or a bold text glyph). */
function createMenuIconSlot(icon: IconName | undefined, glyph: string | undefined): HTMLElement | null {
  if (glyph !== undefined && glyph !== '') {
    const slot = document.createElement('span')
    slot.className = 'notedown-toolbar-menu-icon notedown-toolbar-menu-glyph'
    slot.textContent = glyph
    return slot
  }
  if (icon !== undefined) {
    const slot = document.createElement('span')
    slot.className = 'notedown-toolbar-menu-icon'
    slot.appendChild(svgEl(ICON[icon]))
    return slot
  }
  return null
}

function appendHotkeyHint(parent: HTMLElement, shortcutId: string): void {
  if (shortcutId === '') return
  const hint = labelFor(shortcutId)
  if (hint === '') return
  const hotkey = document.createElement('span')
  hotkey.className = 'notedown-toolbar-menu-hotkey'
  hotkey.textContent = hint
  parent.appendChild(hotkey)
}

/** Dropdown trigger content: glyph first, then icon, then the text label. */
function appendTriggerContent(
  button: HTMLButtonElement,
  icon: IconName | undefined,
  glyph: string | undefined,
  label: string,
): void {
  if (glyph !== undefined && glyph !== '') {
    const span = document.createElement('span')
    span.className = 'notedown-toolbar-glyph'
    span.textContent = glyph
    button.appendChild(span)
    return
  }
  if (icon !== undefined) {
    button.appendChild(svgEl(ICON[icon]))
    return
  }
  button.appendChild(document.createTextNode(label))
}

function createItemButton(id: string, def: ToolbarItemDef): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'notedown-toolbar-button'
  button.dataset.item = id
  button.setAttribute('aria-label', def.label)
  button.title = titleWithHint(def.label, def.shortcutId)
  if (def.icon !== undefined) {
    button.appendChild(svgEl(ICON[def.icon]))
  } else {
    const glyph = document.createElement('span')
    glyph.className = 'notedown-toolbar-glyph'
    glyph.textContent = def.glyph ?? def.label
    button.appendChild(glyph)
  }
  return button
}

function createMenuItemButton(id: string, def: ToolbarItemDef): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'notedown-toolbar-menu-item'
  button.setAttribute('role', 'menuitem')
  button.dataset.item = id
  button.setAttribute('aria-label', def.label)
  button.title = titleWithHint(def.label, def.shortcutId)
  const iconSlot = createMenuIconSlot(def.icon, def.glyph)
  if (iconSlot !== null) button.appendChild(iconSlot)
  const label = document.createElement('span')
  label.className = 'notedown-toolbar-menu-label'
  label.textContent = def.label
  button.appendChild(label)
  appendHotkeyHint(button, def.shortcutId)
  return button
}

interface DropdownSpec {
  id?: string
  label: string
  icon?: IconName
  glyph?: string
  shortcut: string
  items: unknown[]
}

/** Validate a host-supplied descriptor; malformed objects render nothing. */
function normalizeDropdownSpec(value: unknown): DropdownSpec | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (!hasOwn(raw, 'type') || raw.type !== 'dropdown') return null
  if (!hasOwn(raw, 'items') || !Array.isArray(raw.items)) return null
  if (typeof raw.label !== 'string' || raw.label === '') return null
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined
  const icon =
    typeof raw.icon === 'string' && hasOwn(ICON, raw.icon) ? (raw.icon as IconName) : undefined
  const glyph = typeof raw.glyph === 'string' && raw.glyph !== '' ? raw.glyph : undefined
  const shortcut = typeof raw.shortcut === 'string' ? raw.shortcut : ''
  return { id, label: raw.label, icon, glyph, shortcut, items: raw.items }
}

function createSubmenuTrigger(spec: DropdownSpec, dropdownId: string, panelId: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'notedown-toolbar-menu-item notedown-toolbar-submenu-trigger'
  button.dataset.dropdownId = dropdownId
  button.setAttribute('role', 'menuitem')
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', panelId)
  button.setAttribute('aria-label', spec.label)
  button.title = titleWithHint(spec.label, spec.shortcut)
  const iconSlot = createMenuIconSlot(spec.icon, spec.glyph)
  if (iconSlot !== null) button.appendChild(iconSlot)
  const label = document.createElement('span')
  label.className = 'notedown-toolbar-menu-label'
  label.textContent = spec.label
  button.appendChild(label)
  appendHotkeyHint(button, spec.shortcut)
  const arrow = svgEl(ICON.submenuArrow)
  arrow.classList.add('notedown-toolbar-submenu-arrow')
  button.appendChild(arrow)
  return button
}

/** One rendered menu panel and the trigger that owns it. */
interface PanelRecord {
  id: string
  trigger: HTMLButtonElement
  panel: HTMLElement
  parent: PanelRecord | null
}

/** Unique ids across every toolbar on the page (aria-controls must be unique). */
let toolbarSequence = 0

/** Options for {@link createToolbar}. */
export interface CreateToolbarOptions {
  controller: EditorController
  /** Mode the editor starts in (used by the mode toggle). */
  mode: 'live' | 'source'
  /** Item groups; defaults to {@link DEFAULT_TOOLBAR_GROUPS}. */
  items?: ToolbarGroup[]
  /** Called when the mode toggle is pressed. The host applies the new mode. */
  onModeChange: (mode: 'live' | 'source') => void
}

/** Handle returned by {@link createToolbar}. */
export interface ToolbarHandle {
  /** The `.notedown-toolbar` element (caller inserts it into the root). */
  element: HTMLElement
  /** Reflect the current editor mode in every mode button (label + aria-pressed). */
  syncMode(mode: 'live' | 'source'): void
  /** Close popovers, remove listeners, and detach the element. Idempotent. */
  destroy(): void
}

/** Build a toolbar wired to an existing editor controller. */
export function createToolbar(config: CreateToolbarOptions): ToolbarHandle {
  const toolbar = document.createElement('div')
  toolbar.className = 'notedown-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Formatting')

  const sequence = ++toolbarSequence
  const modeButtons: HTMLButtonElement[] = []
  const panels = new Map<string, PanelRecord>()
  const openPanels = new Set<PanelRecord>()
  const usedDropdownIds = new Set<string>()
  let panelCounter = 0
  let dropdownCounter = 0
  let mode: 'live' | 'source' = config.mode
  let emojiHandle: EmojiPickerHandle | null = null
  let lastFocusTarget: HTMLElement | null = null
  let destroyed = false

  function nextPanelId(): string {
    panelCounter += 1
    return `notedown-toolbar-${sequence}-menu-${panelCounter}`
  }

  function nextDropdownId(requested: string | undefined): string {
    dropdownCounter += 1
    const base = requested ?? `dropdown-${sequence}-${dropdownCounter}`
    let candidate = base
    let suffix = 1
    while (usedDropdownIds.has(candidate)) {
      suffix += 1
      candidate = `${base}-${suffix}`
    }
    usedDropdownIds.add(candidate)
    return candidate
  }

  function isAncestorPanel(ancestor: PanelRecord, node: PanelRecord): boolean {
    let current = node.parent
    while (current !== null) {
      if (current === ancestor) return true
      current = current.parent
    }
    return false
  }

  function outermostTrigger(record: PanelRecord): HTMLButtonElement {
    let current = record
    while (current.parent !== null) current = current.parent
    return current.trigger
  }

  /** Focus fallback after Escape: a visible, connected trigger for the row. */
  function focusTargetFor(element: HTMLElement): HTMLElement {
    const menu = element.closest('.notedown-toolbar-menu')
    if (menu !== null) {
      for (const record of panels.values()) {
        if (record.panel === menu) return outermostTrigger(record)
      }
    }
    return element
  }

  const PANEL_GAP = 4
  const PANEL_MARGIN = 8

  function positionPanel(record: PanelRecord): void {
    const rect = record.trigger.getBoundingClientRect()
    const width = record.panel.offsetWidth
    const height = record.panel.offsetHeight
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    let left: number
    let top: number

    if (record.parent === null) {
      left = rect.left
      top = rect.bottom + PANEL_GAP
      if (top + height > viewportHeight - PANEL_MARGIN) {
        const flipped = rect.top - height - PANEL_GAP
        top = flipped >= PANEL_MARGIN ? flipped : viewportHeight - height - PANEL_MARGIN
      }
    } else {
      left = rect.right + PANEL_GAP
      if (left + width > viewportWidth - PANEL_MARGIN) {
        const flipped = rect.left - width - PANEL_GAP
        left = flipped >= PANEL_MARGIN ? flipped : viewportWidth - width - PANEL_MARGIN
      }
      top = rect.top
      if (top + height > viewportHeight - PANEL_MARGIN) {
        top = viewportHeight - height - PANEL_MARGIN
      }
    }

    if (left + width > viewportWidth - PANEL_MARGIN) left = viewportWidth - width - PANEL_MARGIN
    if (left < PANEL_MARGIN) left = PANEL_MARGIN
    if (top < PANEL_MARGIN) top = PANEL_MARGIN

    record.panel.style.left = `${Math.round(left)}px`
    record.panel.style.top = `${Math.round(top)}px`
  }

  function hidePanel(record: PanelRecord): void {
    openPanels.delete(record)
    record.panel.classList.remove('is-open')
    record.trigger.setAttribute('aria-expanded', 'false')
  }

  function closeSubtree(record: PanelRecord): void {
    for (const other of [...openPanels]) {
      if (other === record || isAncestorPanel(record, other)) hidePanel(other)
    }
  }

  function closeAllPanels(): void {
    for (const record of [...openPanels]) hidePanel(record)
  }

  function openPanel(record: PanelRecord): void {
    for (const other of [...openPanels]) {
      if (other === record || isAncestorPanel(other, record)) continue
      closeSubtree(other)
    }
    if (!openPanels.has(record)) {
      record.panel.classList.add('is-open')
      record.trigger.setAttribute('aria-expanded', 'true')
      openPanels.add(record)
    }
    lastFocusTarget = outermostTrigger(record)
    positionPanel(record)
  }

  function hasRenderableEntries(
    entries: unknown[],
    dropdownDepth: number,
    ancestors: Set<object>,
  ): boolean {
    for (const entry of entries) {
      if (typeof entry === 'string') {
        if (ITEM_DEFS.has(entry)) return true
        continue
      }
      if (typeof entry !== 'object' || entry === null) continue
      if (dropdownDepth > MAX_DROPDOWN_DEPTH || ancestors.has(entry)) continue
      const spec = normalizeDropdownSpec(entry)
      if (spec === null) continue
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(entry)
      if (hasRenderableEntries(spec.items, dropdownDepth + 1, nextAncestors)) return true
    }
    return false
  }

  function renderEntries(
    entries: unknown[],
    container: HTMLElement,
    parent: PanelRecord | null,
    dropdownDepth: number,
    ancestors: Set<object>,
  ): void {
    for (const entry of entries) {
      if (typeof entry === 'string') {
        const def = ITEM_DEFS.get(entry)
        if (def === undefined) continue
        const button =
          parent === null
            ? createItemButton(entry, def)
            : createMenuItemButton(entry, def)
        if (entry === 'mode') modeButtons.push(button)
        container.appendChild(button)
        continue
      }
      if (typeof entry !== 'object' || entry === null) continue
      if (dropdownDepth > MAX_DROPDOWN_DEPTH || ancestors.has(entry)) continue
      const spec = normalizeDropdownSpec(entry)
      if (spec === null) continue
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(entry)
      if (!hasRenderableEntries(spec.items, dropdownDepth + 1, nextAncestors)) continue
      renderDropdown(spec, container, parent, dropdownDepth, nextAncestors)
    }
  }

  function renderDropdown(
    spec: DropdownSpec,
    container: HTMLElement,
    parent: PanelRecord | null,
    dropdownDepth: number,
    ancestors: Set<object>,
  ): void {
    const dropdownId = nextDropdownId(spec.id)
    const panelId = nextPanelId()

    const panel = document.createElement('div')
    panel.className = 'notedown-toolbar-menu'
    panel.id = panelId
    panel.dataset.dropdownPanel = dropdownId
    panel.setAttribute('role', 'menu')
    panel.setAttribute('aria-label', spec.label)

    let wrapper: HTMLElement | null = null
    let trigger: HTMLButtonElement
    if (parent === null) {
      wrapper = document.createElement('div')
      wrapper.className = 'notedown-toolbar-dropdown'
      trigger = document.createElement('button')
      trigger.type = 'button'
      trigger.className = 'notedown-toolbar-button notedown-toolbar-dropdown-trigger'
      trigger.dataset.dropdownId = dropdownId
      trigger.setAttribute('aria-haspopup', 'menu')
      trigger.setAttribute('aria-expanded', 'false')
      trigger.setAttribute('aria-controls', panelId)
      trigger.setAttribute('aria-label', spec.label)
      trigger.title = titleWithHint(spec.label, spec.shortcut)
      appendTriggerContent(trigger, spec.icon, spec.glyph, spec.label)
      wrapper.append(trigger, panel)
      container.appendChild(wrapper)
    } else {
      trigger = createSubmenuTrigger(spec, dropdownId, panelId)
      container.append(trigger, panel)
    }

    const record: PanelRecord = { id: dropdownId, trigger, panel, parent }
    panels.set(dropdownId, record)
    renderEntries(spec.items, panel, record, dropdownDepth + 1, ancestors)

    // Defensive: never leave an empty menu (or a dangling trigger) behind.
    if (panel.childElementCount === 0) {
      panels.delete(dropdownId)
      if (wrapper !== null) {
        wrapper.remove()
      } else {
        trigger.remove()
        panel.remove()
      }
    }
  }

  // Build the grouped layout left to right. Unknown ids (plain-JS callers) are
  // ignored defensively; empty groups are not rendered so separators never dangle.
  const groups: ToolbarGroup[] = Array.isArray(config.items)
    ? config.items
    : DEFAULT_TOOLBAR_GROUPS
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    const groupEl = document.createElement('div')
    groupEl.className = 'notedown-toolbar-group'
    renderEntries(group, groupEl, null, 1, new Set<object>())
    if (groupEl.childElementCount > 0) toolbar.appendChild(groupEl)
  }

  function syncMode(next: 'live' | 'source'): void {
    mode = next
    const isSource = next === 'source'
    const action = isSource ? 'Switch to live preview' : 'Switch to source mode'
    const glyphText = isSource ? 'Source' : 'Live'
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(isSource))
      button.setAttribute('aria-label', action)
      button.title = titleWithHint(action, 'toggle-mode')
      const glyph = button.querySelector('.notedown-toolbar-glyph, .notedown-toolbar-menu-glyph')
      if (glyph !== null) glyph.textContent = glyphText
      const label = button.querySelector('.notedown-toolbar-menu-label')
      if (label !== null) label.textContent = action
    }
  }

  function closePicker(): void {
    if (emojiHandle === null) return
    emojiHandle.close()
    emojiHandle = null
  }

  function openPicker(button: HTMLButtonElement): void {
    closeAllPanels()
    closePicker()
    lastFocusTarget = focusTargetFor(button)
    emojiHandle = openEmojiPicker(
      button,
      (emoji) => {
        emojiHandle = null
        config.controller.replaceSelection(emoji)
        config.controller.focus()
      },
      { container: toolbar, className: 'notedown-emoji-picker', fixed: true },
    )
  }

  /** Run a leaf item; returns true when it opened the emoji picker. */
  function runItem(def: ToolbarItemDef, button: HTMLButtonElement): boolean {
    switch (def.action) {
      case 'undo':
        config.controller.undo()
        return false
      case 'redo':
        config.controller.redo()
        return false
      case 'mode': {
        const next: 'live' | 'source' = mode === 'live' ? 'source' : 'live'
        mode = next
        config.onModeChange(next)
        syncMode(next)
        return false
      }
      case 'emoji':
        openPicker(button)
        return true
      case 'format': {
        const commandId = def.commandId
        if (commandId === undefined) return false
        if (!hasOwn(FORMATTING_COMMANDS, commandId)) return false
        const command = FORMATTING_COMMANDS[commandId]
        if (command !== undefined) config.controller.runFormatting(command)
        return false
      }
      default:
        return false
    }
  }

  const onMouseDown = (event: MouseEvent): void => {
    // Keep the editor selection (and focus) intact while a button is pressed —
    // but never intercept text inputs (the emoji search field must focus).
    const target = event.target
    if (!(target instanceof Element)) return
    const editable = target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
    if (editable !== null) return
    if (target.closest('button') !== null) event.preventDefault()
  }

  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return

    const dropdownTrigger = target.closest('button[data-dropdown-id]')
    if (dropdownTrigger !== null && toolbar.contains(dropdownTrigger)) {
      const dropdownId = dropdownTrigger.getAttribute('data-dropdown-id')
      const record = dropdownId !== null ? panels.get(dropdownId) : undefined
      if (record !== undefined && record.trigger === dropdownTrigger) {
        event.preventDefault()
        if (openPanels.has(record)) {
          closeSubtree(record)
        } else {
          // Opening a menu closes the emoji popover so only one popover is
          // visible at a time (and vice versa in openPicker).
          closePicker()
          openPanel(record)
        }
        return
      }
    }

    const itemButton = target.closest('button[data-item]')
    if (itemButton === null || !toolbar.contains(itemButton) || !(itemButton instanceof HTMLButtonElement)) {
      return
    }
    const itemId = itemButton.getAttribute('data-item')
    if (itemId === null) return
    const def = ITEM_DEFS.get(itemId)
    if (def === undefined) return

    const openedEmoji = runItem(def, itemButton)
    closeAllPanels()
    if (!openedEmoji) {
      closePicker()
      config.controller.focus()
    }
  }

  const onDocumentMouseDown = (event: MouseEvent): void => {
    const target = event.target
    if (target instanceof Node && toolbar.contains(target)) return
    closeAllPanels()
    closePicker()
  }

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    if (openPanels.size === 0 && emojiHandle === null) return
    const active = document.activeElement
    const focusInside = active instanceof Node && toolbar.contains(active)
    closeAllPanels()
    closePicker()
    if (focusInside && lastFocusTarget !== null && lastFocusTarget.isConnected) {
      lastFocusTarget.focus()
    }
  }

  const closePopovers = (): void => {
    closeAllPanels()
    closePicker()
  }

  const onResize = (): void => {
    closePopovers()
  }

  const onScroll = (event: Event): void => {
    // Scrolling inside an open menu (its max-height can overflow) must not
    // dismiss it; only page/ancestor scrolling invalidates the fixed position.
    const target = event.target
    if (target instanceof Node && toolbar.contains(target)) return
    closePopovers()
  }

  toolbar.addEventListener('mousedown', onMouseDown)
  toolbar.addEventListener('click', onClick)
  document.addEventListener('mousedown', onDocumentMouseDown)
  document.addEventListener('keydown', onDocumentKeyDown)
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onScroll, true)

  syncMode(mode)

  return {
    element: toolbar,
    syncMode,
    destroy(): void {
      if (destroyed) return
      destroyed = true
      closePicker()
      closeAllPanels()
      toolbar.removeEventListener('mousedown', onMouseDown)
      toolbar.removeEventListener('click', onClick)
      document.removeEventListener('mousedown', onDocumentMouseDown)
      document.removeEventListener('keydown', onDocumentKeyDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
      modeButtons.length = 0
      panels.clear()
      toolbar.remove()
    },
  }
}
