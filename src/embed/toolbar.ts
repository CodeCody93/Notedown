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
 */
import { FORMATTING_COMMANDS } from '../app/formatting'
import { ICON, svgEl, type IconName } from '../app/icons'
import { labelFor } from '../app/shortcuts'
import type { EditorController } from '../editor/editor'

/** Stable ids for every toolbar item. */
export type ToolbarItem =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'h1'
  | 'h2'
  | 'bullet-list'
  | 'ordered-list'
  | 'link'
  | 'inline-code'
  | 'mode'

/**
 * Toolbar configuration. Pass `toolbar: true` (or an empty object) to use the
 * default groups; pass explicit groups to show a subset/reorder the items.
 * Each inner array is rendered as one visually separated group.
 */
export interface ToolbarOptions {
  /** Item groups, left to right. Defaults to {@link DEFAULT_TOOLBAR_GROUPS}. */
  items?: ToolbarItem[][]
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

type ToolbarAction = 'format' | 'undo' | 'redo' | 'mode'

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

const ITEM_DEFS: Record<ToolbarItem, ToolbarItemDef> = {
  undo: { label: 'Undo', shortcutId: 'undo', icon: 'undo', action: 'undo' },
  redo: { label: 'Redo', shortcutId: 'redo', icon: 'redo', action: 'redo' },
  bold: { label: 'Bold', shortcutId: 'bold', icon: 'bold', action: 'format', commandId: 'bold' },
  italic: { label: 'Italic', shortcutId: 'italic', icon: 'italic', action: 'format', commandId: 'italic' },
  strikethrough: {
    label: 'Strikethrough',
    shortcutId: 'strikethrough',
    icon: 'strikethrough',
    action: 'format',
    commandId: 'strikethrough',
  },
  h1: { label: 'Heading 1', shortcutId: 'header-1', glyph: 'H1', action: 'format', commandId: 'header-1' },
  h2: { label: 'Heading 2', shortcutId: 'header-2', glyph: 'H2', action: 'format', commandId: 'header-2' },
  'bullet-list': {
    label: 'Bulleted list',
    shortcutId: 'list',
    glyph: '•',
    action: 'format',
    commandId: 'list-unordered',
  },
  'ordered-list': {
    label: 'Numbered list',
    shortcutId: 'list-ordered',
    glyph: '1.',
    action: 'format',
    commandId: 'list-ordered',
  },
  link: { label: 'Link', shortcutId: 'link', icon: 'link', action: 'format', commandId: 'link' },
  'inline-code': {
    label: 'Inline code',
    shortcutId: 'inline-code',
    icon: 'inlineCode',
    action: 'format',
    commandId: 'inline-code',
  },
  mode: { label: 'Switch to source mode', shortcutId: 'toggle-mode', glyph: 'Live', action: 'mode' },
}

function titleWithHint(label: string, shortcutId: string): string {
  const hint = labelFor(shortcutId)
  return hint === '' ? label : `${label} (${hint})`
}

function createItemButton(item: ToolbarItem): HTMLButtonElement {
  const def = ITEM_DEFS[item]
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'notedown-toolbar-button'
  button.dataset.item = item
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

/** Options for {@link createToolbar}. */
export interface CreateToolbarOptions {
  controller: EditorController
  /** Mode the editor starts in (used by the mode toggle). */
  mode: 'live' | 'source'
  /** Item groups; defaults to {@link DEFAULT_TOOLBAR_GROUPS}. */
  items?: ToolbarItem[][]
  /** Called when the mode toggle is pressed. The host applies the new mode. */
  onModeChange: (mode: 'live' | 'source') => void
}

/** Handle returned by {@link createToolbar}. */
export interface ToolbarHandle {
  /** The `.notedown-toolbar` element (caller inserts it into the root). */
  element: HTMLElement
  /** Reflect the current editor mode in the mode button (label + aria-pressed). */
  syncMode(mode: 'live' | 'source'): void
  /** Remove listeners (and detach the element). Idempotent. */
  destroy(): void
}

/** Build a toolbar wired to an existing editor controller. */
export function createToolbar(config: CreateToolbarOptions): ToolbarHandle {
  const toolbar = document.createElement('div')
  toolbar.className = 'notedown-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Formatting')

  const buttons = new Map<ToolbarItem, HTMLButtonElement>()
  let mode: 'live' | 'source' = config.mode

  /* Grouped layout. Unknown ids (plain-JS callers) are ignored defensively;
     empty groups are not rendered so separators never dangle. */
  for (const group of config.items ?? DEFAULT_TOOLBAR_GROUPS) {
    const groupEl = document.createElement('div')
    groupEl.className = 'notedown-toolbar-group'
    for (const item of group) {
      if (!(item in ITEM_DEFS)) continue
      const button = createItemButton(item)
      buttons.set(item, button)
      groupEl.appendChild(button)
    }
    if (groupEl.childElementCount > 0) toolbar.appendChild(groupEl)
  }

  /** Resolve the toolbar item a delegated event came from. */
  const itemFromEvent = (event: Event): ToolbarItem | null => {
    const target = event.target
    if (!(target instanceof Element)) return null
    const button = target.closest('button[data-item]')
    if (button === null || !toolbar.contains(button)) return null
    const item = button.getAttribute('data-item')
    if (item === null || !(item in ITEM_DEFS)) return null
    return item as ToolbarItem
  }

  const runItem = (item: ToolbarItem): void => {
    const def = ITEM_DEFS[item]
    switch (def.action) {
      case 'undo':
        config.controller.undo()
        break
      case 'redo':
        config.controller.redo()
        break
      case 'format': {
        const command = def.commandId !== undefined ? FORMATTING_COMMANDS[def.commandId] : undefined
        if (command !== undefined) config.controller.runFormatting(command)
        break
      }
      case 'mode': {
        const next: 'live' | 'source' = mode === 'live' ? 'source' : 'live'
        mode = next
        config.onModeChange(next)
        break
      }
    }
  }

  const onMouseDown = (event: MouseEvent): void => {
    // Keep the editor selection (and focus) intact while the button is pressed.
    if (itemFromEvent(event) !== null) event.preventDefault()
  }

  const onClick = (event: MouseEvent): void => {
    const item = itemFromEvent(event)
    if (item === null) return
    runItem(item)
    config.controller.focus()
  }

  toolbar.addEventListener('mousedown', onMouseDown)
  toolbar.addEventListener('click', onClick)

  const syncMode = (next: 'live' | 'source'): void => {
    mode = next
    const button = buttons.get('mode')
    if (button === undefined) return
    const isSource = next === 'source'
    const action = isSource ? 'Switch to live preview' : 'Switch to source mode'
    button.setAttribute('aria-pressed', String(isSource))
    button.setAttribute('aria-label', action)
    button.title = titleWithHint(action, 'toggle-mode')
    const glyph = button.querySelector('.notedown-toolbar-glyph')
    if (glyph !== null) glyph.textContent = isSource ? 'Source' : 'Live'
  }
  syncMode(mode)

  let destroyed = false
  return {
    element: toolbar,
    syncMode,
    destroy(): void {
      if (destroyed) return
      destroyed = true
      toolbar.removeEventListener('mousedown', onMouseDown)
      toolbar.removeEventListener('click', onClick)
      buttons.clear()
      toolbar.remove()
    },
  }
}
