// @vitest-environment jsdom
// M3 menu/toolbar unit tests: data-driven rendering, hotkey-consistency
// (the M3 accept criterion), extra-pin behavior, formatting hotkey map and the
// emoji picker. Mirrors tests/editor.smoke.test.ts (jsdom).
import { describe, it, expect, afterEach } from 'vitest'
import {
  renderMenubar,
  openEmojiPicker,
  formattingHotkeyMap,
  formattingHotkeyIds,
  EMOJI_LIST,
  FILE_MENU,
  EXTRA_MENU,
  TOOLBAR_GROUPS,
} from '../src/app/menu'
import type { MenuEntry } from '../src/app/menu'
import { labelFor } from '../src/app/shortcuts'

afterEach(() => {
  document.body.textContent = ''
})

/** Renders the menubar into a fresh div attached to document.body. */
function renderRoot(extraPinned = false): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  renderMenubar(root, { extraPinned })
  return root
}

/** Flattens every menu entry (recursing into submenus). */
function collectEntries(): MenuEntry[] {
  const out: MenuEntry[] = []
  const walk = (list: MenuEntry[]): void => {
    for (const e of list) {
      out.push(e)
      if (e.children !== undefined) walk(e.children)
    }
  }
  walk([...FILE_MENU, ...EXTRA_MENU, ...TOOLBAR_GROUPS.flat()])
  return out
}

describe('renderMenubar', () => {
  it('renders the File dropdown trigger with menuitem ARIA', () => {
    const root = renderRoot()
    const trigger = root.querySelector<HTMLElement>('.dropdown-trigger[data-action="file"]')
    expect(trigger).toBeTruthy()
    expect(trigger?.getAttribute('role')).toBe('menuitem')
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
  })

  it('renders toolbar groups with a bold tool-btn carrying data-action', () => {
    const root = renderRoot()
    const bold = root.querySelector<HTMLElement>('.tool-btn[data-action="bold"]')
    expect(bold).toBeTruthy()
    expect(bold?.getAttribute('aria-label')).toBe('Bold')
  })

  it('renders the navigator toolbar button with its label and hotkey tooltip', () => {
    const root = renderRoot()
    const navigator = root.querySelector<HTMLElement>('.tool-btn[data-action="navigator"]')
    expect(navigator).toBeTruthy()
    expect(navigator?.getAttribute('aria-label')).toBe('Navigator')
    expect(navigator?.title).toContain(labelFor('toggle-navigator'))
  })

  it('places the navigator toggle before Undo in the first toolbar group', () => {
    const root = renderRoot()
    const actions = Array.from(
      root.querySelectorAll<HTMLElement>('.toolbar > .toolbar-group:first-child > .tool-btn'),
    ).map((button) => button.dataset.action)
    expect(actions).toEqual(['navigator', 'undo', 'redo', 'copy', 'cut', 'paste'])
  })

  it('renders every locked action id with a data-action attribute', () => {
    const root = renderRoot()
    const ids = [
      // File
      'new',
      'open',
      'open-recent',
      'save',
      'save-as',
      'export',
      'settings',
      'clear-recents',
      // Toolbar
      'undo',
      'redo',
      'copy',
      'cut',
      'paste',
      'bold',
      'italic',
      'underline',
      'strikethrough',
      // Header submenu
      'header-0',
      'header-1',
      'header-2',
      'header-3',
      'header-4',
      'header-5',
      'header-6',
      // List submenu
      'list-unordered',
      'list-ordered',
      'list-task',
      // Extra
      'blockquote',
      'inline-code',
      'code-block',
      'link',
      'image',
      'table',
      'hr',
      'footnote',
      'task-list',
      'emoji',
      'heading-id',
      'def-list',
      'sub',
      'sup',
      'highlight',
      // Navigation
      'navigator',
    ]
    for (const id of ids) {
      const el = root.querySelector<HTMLElement>(`[data-action="${id}"]`)
      expect(el, `expected a rendered element with data-action="${id}"`).toBeTruthy()
    }
  })

  it('File menu order is New, Open, Open Recent, Import…, Save, Save as, Export…, Settings, Help, About (round-9 unified export)', () => {
    expect(FILE_MENU.map((e) => e.id)).toEqual([
      'new',
      'open',
      'open-recent',
      'import',
      'save',
      'save-as',
      'export',
      'settings',
      'help',
      'about',
    ])
    const exportEntry = FILE_MENU.find((e) => e.id === 'export')
    expect(exportEntry?.label).toBe('Export…')
    expect(exportEntry?.hotkey).toBe('export')
  })

  it('renders the Open Recent submenu with the #recent-list placeholder and Clear recent', () => {
    const root = renderRoot()
    const list = root.querySelector('#recent-list.recent-list')
    expect(list).toBeTruthy()
    const clear = root.querySelector<HTMLElement>('[data-action="clear-recents"]')
    expect(clear).toBeTruthy()
    expect(clear?.textContent).toBe('Clear recent')
  })

  it('renders the Extra dropdown trigger when not pinned', () => {
    const root = renderRoot(false)
    const extra = root.querySelector<HTMLElement>('.dropdown-trigger[data-action="extra"]')
    expect(extra).toBeTruthy()
  })

  it('extraPinned renders a second flat toolbar row and no Extra dropdown', () => {
    const root = renderRoot(true)
    const row = root.querySelector<HTMLElement>('#extra-row.extra-row')
    expect(row).toBeTruthy()
    expect(row?.querySelector('.tool-btn[data-action="blockquote"]')).toBeTruthy()
    expect(row?.querySelector('.dropdown')).toBeNull()
    expect(root.querySelector('[data-action="extra"]')).toBeNull()

    root.textContent = ''
    renderMenubar(root, { extraPinned: false })
    expect(root.querySelector('#extra-row')).toBeNull()
    expect(root.querySelector('.dropdown-trigger[data-action="extra"]')).toBeTruthy()
  })

  it('every rendered hotkey hint matches labelFor (M3 hotkey-consistency accept criterion)', () => {
    const root = renderRoot()
    for (const entry of collectEntries()) {
      if (entry.hotkey === undefined) continue
      const el = root.querySelector<HTMLElement>(`[data-action="${entry.id}"]`)
      if (el === null) continue
      // Menu rows show the chord right-aligned in a .hotkey span.
      const hk = el.querySelector<HTMLElement>('.hotkey')
      if (hk !== null) {
        expect(hk.textContent, `hotkey hint for "${entry.id}"`).toBe(labelFor(entry.hotkey))
      }
      // Toolbar buttons show the chord in their tooltip instead.
      if (el.classList.contains('tool-btn')) {
        expect(el.title, `tooltip for "${entry.id}"`).toBe(`${entry.label} (${labelFor(entry.hotkey)})`)
      }
    }
  })
})

describe('formattingHotkeyMap', () => {
  it('returns a non-null extension covering SHORTCUTS ∩ FORMATTING ids', () => {
    // Expected final set: every SHORTCUTS id that also exists in
    // FORMATTING_COMMANDS, in SHORTCUTS order. 'emoji' and 'graph' are
    // intentionally absent: each binds its own app-level keymap (the emoji
    // picker and the graph builder respectively). 'table' is likewise
    // absent: Mod-t opens the table builder via its own tableHotkeyMap
    // instead of the legacy template insert. 'toggle-preview' was
    // removed, and 'list-unordered'/'list-task' have no SHORTCUTS entry.
    const expected = [
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'header-cycle',
      'header-1',
      'header-2',
      'header-3',
      'header-4',
      'header-5',
      'header-6',
      'header-0',
      'list',
      'list-ordered',
      'blockquote',
      'inline-code',
      'code-block',
      'link',
      'image',
      'hr',
      'footnote',
      'task-list',
      'heading-id',
      'def-list',
      'sub',
      'sup',
      'highlight',
      'spoiler',
      'dropdown',
    ]
    expect(expected.length).toBeGreaterThan(0)
    expect(formattingHotkeyIds()).toEqual(expected)
    expect(formattingHotkeyMap()).toBeTruthy()
  })
})

describe('openEmojiPicker', () => {
  it('renders a grid and calls onPick when a cell is clicked', () => {
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    let picked: string | null = null
    openEmojiPicker(anchor, (emoji) => {
      picked = emoji
    })

    const grid = document.querySelector('.emoji-grid')
    expect(grid).toBeTruthy()
    const cells = grid?.querySelectorAll<HTMLElement>('.emoji-cell')
    expect(cells && cells.length).toBeGreaterThan(0)

    cells?.[0]?.click()
    expect(picked).toBe(EMOJI_LIST[0].char)
    // Selecting closes the picker and removes the popover node.
    expect(document.querySelector('.emoji-picker')).toBeNull()
  })

  it('filters the grid by search name', () => {
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    openEmojiPicker(anchor, () => {})

    const grid = document.querySelector('.emoji-grid')
    const input = document.querySelector<HTMLInputElement>('.emoji-search')
    expect(grid).toBeTruthy()
    expect(input).toBeTruthy()
    const before = grid?.querySelectorAll('.emoji-cell').length ?? 0
    expect(before).toBeGreaterThan(1)

    if (input !== null) {
      input.value = EMOJI_LIST[0].name
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const after = grid?.querySelectorAll('.emoji-cell').length ?? 0
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThanOrEqual(before)
  })
})

describe('dropdown exclusivity & blur', () => {
  it('opening a toolbar dropdown closes the File dropdown (different parents)', () => {
    const root = renderRoot()
    const fileTrigger = root.querySelector<HTMLElement>('.dropdown-trigger[data-action="file"]')
    const extraTrigger = root.querySelector<HTMLElement>('.dropdown-trigger[data-action="extra"]')
    expect(fileTrigger).toBeTruthy()
    expect(extraTrigger).toBeTruthy()

    fileTrigger?.click()
    expect(fileTrigger?.getAttribute('aria-expanded')).toBe('true')

    extraTrigger?.click()
    const open = document.querySelectorAll('.dropdown.open')
    expect(open.length).toBe(1)
    expect(extraTrigger?.closest('.dropdown')?.classList.contains('open')).toBe(true)
    expect(fileTrigger?.closest('.dropdown')?.classList.contains('open')).toBe(false)
    expect(fileTrigger?.getAttribute('aria-expanded')).toBe('false')
    expect(extraTrigger?.getAttribute('aria-expanded')).toBe('true')
  })

  it('clicking the already-open trigger toggles it closed', () => {
    const root = renderRoot()
    const extraTrigger = root.querySelector<HTMLElement>('.dropdown-trigger[data-action="extra"]')
    extraTrigger?.click()
    expect(extraTrigger?.closest('.dropdown')?.classList.contains('open')).toBe(true)
    extraTrigger?.click()
    expect(extraTrigger?.closest('.dropdown')?.classList.contains('open')).toBe(false)
    expect(extraTrigger?.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelectorAll('.dropdown.open').length).toBe(0)
  })

  it('opening a dropdown closes the emoji picker', () => {
    const root = renderRoot()
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    openEmojiPicker(anchor, () => {})
    expect(document.querySelector('.emoji-picker')).toBeTruthy()

    root.querySelector<HTMLElement>('.dropdown-trigger[data-action="file"]')?.click()
    expect(document.querySelector('.emoji-picker')).toBeNull()
    expect(document.querySelectorAll('.dropdown.open').length).toBe(1)
  })

  it('window blur closes all dropdowns and the emoji picker', () => {
    const root = renderRoot()
    root.querySelector<HTMLElement>('.dropdown-trigger[data-action="file"]')?.click()
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    openEmojiPicker(anchor, () => {})
    expect(document.querySelectorAll('.dropdown.open').length).toBe(1)
    expect(document.querySelector('.emoji-picker')).toBeTruthy()

    window.dispatchEvent(new Event('blur'))
    expect(document.querySelectorAll('.dropdown.open').length).toBe(0)
    expect(document.querySelector('.emoji-picker')).toBeNull()
  })
})
