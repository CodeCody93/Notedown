// @vitest-environment jsdom
// Public embed API contract: mounting, value changes, read-only, themes, the
// toolbar, save keymap, and teardown. Everything here goes through the public
// entry point (including the stylesheet import), exactly like a consumer.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createNotedownEditor,
  createToolbar,
  FULL_TOOLBAR_GROUPS,
  type NotedownEditor,
} from '../src/embed/index'

const editors: NotedownEditor[] = []

function makeHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

function track(editor: NotedownEditor): NotedownEditor {
  editors.push(editor)
  return editor
}

// ---------------------------------------------------------------------------
// Toolbar helpers (full preset / custom dropdowns)
// ---------------------------------------------------------------------------

interface LooseDropdown {
  type: 'dropdown'
  id?: string
  label?: string
  items?: LooseEntry[]
}
type LooseEntry = string | LooseDropdown

function isDropdown(entry: LooseEntry): entry is LooseDropdown {
  return typeof entry === 'object' && entry !== null && entry.type === 'dropdown'
}

/** Flattens groups, recursing into nested dropdown descriptors. */
function collectEntries(groups: LooseEntry[][]): LooseEntry[] {
  const out: LooseEntry[] = []
  const walk = (entries: LooseEntry[]): void => {
    for (const entry of entries) {
      out.push(entry)
      if (isDropdown(entry)) walk(entry.items ?? [])
    }
  }
  walk(groups.flat())
  return out
}

function toolbarOf(editor: NotedownEditor): HTMLElement {
  const toolbar = editor.element.querySelector<HTMLElement>('.notedown-toolbar')
  expect(toolbar).not.toBeNull()
  return toolbar as HTMLElement
}

function triggerFor(root: HTMLElement, id: string): HTMLButtonElement {
  const trigger = root.querySelector<HTMLButtonElement>(`button[data-dropdown-id="${id}"]`)
  expect(trigger, `expected a trigger for dropdown "${id}"`).not.toBeNull()
  return trigger as HTMLButtonElement
}

/** Clicks a dropdown trigger and asserts its panel is open; returns the panel. */
function openDropdown(root: HTMLElement, id: string): HTMLElement {
  const trigger = triggerFor(root, id)
  trigger.click()
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const panel = root.querySelector<HTMLElement>(
    `.notedown-toolbar-menu[data-dropdown-panel="${id}"]`,
  )
  expect(panel, `expected a panel for dropdown "${id}"`).not.toBeNull()
  expect(panel?.classList.contains('is-open')).toBe(true)
  return panel as HTMLElement
}

function menuItem(panel: HTMLElement, id: string): HTMLButtonElement {
  const item = panel.querySelector<HTMLButtonElement>(
    `button.notedown-toolbar-menu-item[data-item="${id}"]`,
  )
  expect(item, `expected a menu item "${id}"`).not.toBeNull()
  return item as HTMLButtonElement
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  document.body.innerHTML = ''
})

describe('createNotedownEditor mounting', () => {
  it('mounts root, surface and CM editor into an element', () => {
    const host = makeHost()
    const editor = track(createNotedownEditor({ mount: host, value: '# Hello' }))

    expect(host.querySelector('.notedown-editor-root')).toBe(editor.element)
    expect(editor.element.parentElement).toBe(host)
    expect(editor.element.querySelector('.notedown-editor-surface')).not.toBeNull()
    expect(editor.element.querySelector('.cm-editor')).not.toBeNull()

    expect(editor.getValue()).toBe('# Hello')
    expect(editor.getOutline().map((heading) => heading.text)).toEqual(['Hello'])

    editor.setValue('changed')
    expect(editor.getValue()).toBe('changed')
  })

  it('accepts a selector string and throws clearly for a missing mount', () => {
    const host = makeHost()
    host.id = 'embed-mount-host'
    const editor = track(createNotedownEditor({ mount: '#embed-mount-host' }))
    expect(editor.element.parentElement).toBe(host)

    expect(() => createNotedownEditor({ mount: '#embed-mount-missing' })).toThrow(/mount selector/)
  })

  it('applies className and a numeric height to the wrapper', () => {
    const host = makeHost()
    const editor = track(
      createNotedownEditor({ mount: host, className: 'custom-embed another-class', height: 320 }),
    )
    expect(editor.element.classList.contains('notedown-editor-root')).toBe(true)
    expect(editor.element.classList.contains('custom-embed')).toBe(true)
    expect(editor.element.classList.contains('another-class')).toBe(true)
    expect(editor.element.style.height).toBe('320px')
  })
})

describe('createNotedownEditor change tracking', () => {
  it('setValue does not fire onChange, but a user edit does', () => {
    const host = makeHost()
    const onChange = vi.fn()
    const editor = track(createNotedownEditor({ mount: host, value: 'one', onChange }))

    editor.setValue('two')
    expect(onChange).not.toHaveBeenCalled()

    editor.getController().replaceSelection('!')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(editor.getValue())
  })
})

describe('createNotedownEditor read-only mode', () => {
  it('starts read-only and can be made editable again', () => {
    const host = makeHost()
    const editor = track(createNotedownEditor({ mount: host, value: 'locked', readOnly: true }))
    const content = editor.element.querySelector('.cm-content') as HTMLElement

    expect(content.getAttribute('contenteditable')).toBe('false')
    editor.setReadOnly(false)
    expect(content.getAttribute('contenteditable')).toBe('true')
  })
})

describe('createNotedownEditor theme', () => {
  it('applies light/dark and removes the attribute for inherit', () => {
    const host = makeHost()
    const editor = track(createNotedownEditor({ mount: host, theme: 'light' }))

    expect(editor.element.getAttribute('data-theme')).toBe('light')
    editor.setTheme('dark')
    expect(editor.element.getAttribute('data-theme')).toBe('dark')
    editor.setTheme('inherit')
    expect(editor.element.hasAttribute('data-theme')).toBe(false)
  })

  it('defaults to a resolved system theme', () => {
    const host = makeHost()
    const editor = track(createNotedownEditor({ mount: host }))
    // jsdom has no matchMedia, so system resolves to light; accept either
    // resolved value so the assertion only covers "system was resolved".
    expect(['light', 'dark']).toContain(editor.element.getAttribute('data-theme'))
  })
})

describe('createNotedownEditor toolbar', () => {
  it('renders buttons that preserve selection and run formatting commands', () => {
    const host = makeHost()
    const editor = track(createNotedownEditor({ mount: host, value: 'hello', toolbar: true }))
    const toolbar = editor.element.querySelector('.notedown-toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.querySelectorAll('.notedown-toolbar-group').length).toBe(6)

    const bold = toolbar?.querySelector('button[data-item="bold"]') as HTMLButtonElement
    expect(bold.getAttribute('aria-label')).toBe('Bold')
    expect(bold.title).toContain('Bold')

    // Pressing the button must not move focus/selection away from the editor.
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    bold.dispatchEvent(mouseDown)
    expect(mouseDown.defaultPrevented).toBe(true)

    editor.getController().runFormatting(() => ({ selection: { anchor: 0, head: 5 } }))
    bold.click()
    expect(editor.getValue()).toBe('**hello**')
  })

  it('toggles live/source mode and stays in sync with setMode', () => {
    const host = makeHost()
    const editor = track(createNotedownEditor({ mount: host, value: 'x', toolbar: true }))
    const modeButton = editor.element.querySelector(
      'button[data-item="mode"]',
    ) as HTMLButtonElement

    expect(modeButton.getAttribute('aria-pressed')).toBe('false')
    expect(modeButton.textContent).toBe('Live')

    modeButton.click()
    expect(modeButton.getAttribute('aria-pressed')).toBe('true')
    expect(modeButton.textContent).toBe('Source')

    editor.setMode('live')
    expect(modeButton.getAttribute('aria-pressed')).toBe('false')
    expect(modeButton.textContent).toBe('Live')
  })

  it('honours a custom subset/reordering of items', () => {
    const host = makeHost()
    const editor = track(
      createNotedownEditor({ mount: host, toolbar: { items: [['bold'], ['mode']] } }),
    )
    const ids = Array.from(editor.element.querySelectorAll('button[data-item]')).map((button) =>
      button.getAttribute('data-item'),
    )
    expect(ids).toEqual(['bold', 'mode'])
  })

  it('treats an empty toolbar object as the compact six-group default', () => {
    const editor = track(createNotedownEditor({ mount: makeHost(), toolbar: {} }))
    expect(editor.element.querySelectorAll('.notedown-toolbar-group').length).toBe(6)
    expect(editor.element.querySelector('button[data-item="bold"]')).not.toBeNull()
    expect(editor.element.querySelector('button[data-item="mode"]')).not.toBeNull()
  })
})

describe('createNotedownEditor save keymap', () => {
  it('binds Mod-s to onSave and prevents the browser save dialog', () => {
    const host = makeHost()
    const onSave = vi.fn()
    const editor = track(createNotedownEditor({ mount: host, value: 'draft', onSave }))
    const content = editor.element.querySelector('.cm-content') as HTMLElement

    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    content.dispatchEvent(event)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('draft')
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('createNotedownEditor teardown', () => {
  it('removes its wrapper and is idempotent on destroy', () => {
    const host = makeHost()
    const editor = createNotedownEditor({ mount: host, value: 'bye' })
    const root = editor.element

    editor.destroy()
    expect(host.contains(root)).toBe(false)
    expect(host.querySelector('.notedown-editor-root')).toBeNull()

    expect(() => editor.destroy()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Full toolbar preset and custom toolbar groups
// ---------------------------------------------------------------------------

describe('FULL_TOOLBAR_GROUPS', () => {
  it('exports the header/list/extra/graph descriptors with no app-only chrome', () => {
    const groups = FULL_TOOLBAR_GROUPS as unknown as LooseEntry[][]
    expect(Array.isArray(groups)).toBe(true)
    expect(groups.length).toBe(4)

    const entries = collectEntries(groups)
    const dropdowns = entries.filter(isDropdown)
    const dropdownIds = dropdowns.map((dropdown) => dropdown.id)
    expect(dropdownIds).toEqual(expect.arrayContaining(['header', 'list', 'extra', 'graph']))

    const leafIds = entries.filter((entry): entry is string => typeof entry === 'string')
    for (const id of ['undo', 'redo', 'bold', 'italic', 'underline', 'strikethrough', 'mode']) {
      expect(leafIds).toContain(id)
    }
    // The embed preset never includes app-shell-only actions.
    for (const appOnly of ['navigator', 'copy', 'cut', 'paste']) {
      expect(leafIds).not.toContain(appOnly)
      expect(dropdownIds).not.toContain(appOnly)
    }

    const header = dropdowns.find((dropdown) => dropdown.id === 'header')
    expect(header?.items).toEqual([
      'header-0',
      'header-1',
      'header-2',
      'header-3',
      'header-4',
      'header-5',
      'header-6',
    ])
    const list = dropdowns.find((dropdown) => dropdown.id === 'list')
    expect(list?.items).toEqual([
      'list-unordered',
      'list-ordered',
      'list-ordered-alpha',
      'list-ordered-roman',
      'list-task',
    ])
    const extra = dropdowns.find((dropdown) => dropdown.id === 'extra')
    const extraLeaves = (extra?.items ?? []).filter(
      (entry): entry is string => typeof entry === 'string',
    )
    for (const id of [
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
      'spoiler',
      'dropdown',
    ]) {
      expect(extraLeaves).toContain(id)
    }
    const graph = dropdowns.find((dropdown) => dropdown.id === 'graph')
    expect(graph?.items).toEqual(['pie-graph', 'bar-graph', 'line-graph'])
  })

  it('exports createToolbar for host-owned toolbar layouts', () => {
    expect(typeof createToolbar).toBe('function')
  })
})

describe('createNotedownEditor full toolbar preset', () => {
  it('renders four groups and the Header/List/Extra/Graph dropdown triggers', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const toolbar = toolbarOf(editor)
    expect(toolbar.querySelectorAll('.notedown-toolbar-group').length).toBe(4)

    const header = triggerFor(toolbar, 'header')
    const list = triggerFor(toolbar, 'list')
    const extra = triggerFor(toolbar, 'extra')
    for (const trigger of [header, list, extra]) {
      expect(trigger.classList.contains('notedown-toolbar-dropdown-trigger')).toBe(true)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    }

    // Only one panel is open at a time.
    header.click()
    expect(header.getAttribute('aria-expanded')).toBe('true')
    list.click()
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(list.getAttribute('aria-expanded')).toBe('true')

    // Graph is nested inside the Extra panel, so open Extra before querying it.
    extra.click()
    expect(list.getAttribute('aria-expanded')).toBe('false')
    expect(extra.getAttribute('aria-expanded')).toBe('true')
    const graph = toolbar.querySelector<HTMLButtonElement>(
      'button.notedown-toolbar-submenu-trigger[data-dropdown-id="graph"]',
    )
    expect(graph).not.toBeNull()
    expect(graph?.getAttribute('aria-expanded')).toBe('false')
  })

  it('Header lists Paragraph through Heading 6 and applies the chosen heading', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const toolbar = toolbarOf(editor)
    const panel = openDropdown(toolbar, 'header')

    const ids = Array.from(
      panel.querySelectorAll('button.notedown-toolbar-menu-item[data-item]'),
    ).map((button) => button.getAttribute('data-item'))
    expect(ids).toEqual([
      'header-0',
      'header-1',
      'header-2',
      'header-3',
      'header-4',
      'header-5',
      'header-6',
    ])

    editor.getController().setCursor(1, 1)
    menuItem(panel, 'header-3').click()
    expect(editor.getValue()).toBe('### text')

    // Running a leaf closes the panel and resets the trigger.
    expect(toolbar.querySelector('.notedown-toolbar-menu.is-open')).toBeNull()
    expect(triggerFor(toolbar, 'header').getAttribute('aria-expanded')).toBe('false')
  })

  it('List offers all marker styles and runs alpha and task variants', () => {
    const alpha = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const alphaToolbar = toolbarOf(alpha)
    const alphaPanel = openDropdown(alphaToolbar, 'list')
    const ids = Array.from(alphaPanel.querySelectorAll('button[data-item]')).map((button) =>
      button.getAttribute('data-item'),
    )
    expect(ids).toEqual([
      'list-unordered',
      'list-ordered',
      'list-ordered-alpha',
      'list-ordered-roman',
      'list-task',
    ])
    alpha.getController().setCursor(1, 1)
    menuItem(alphaPanel, 'list-ordered-alpha').click()
    expect(alpha.getValue()).toBe('a. text')

    const task = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const taskPanel = openDropdown(toolbarOf(task), 'list')
    task.getController().setCursor(1, 1)
    menuItem(taskPanel, 'list-task').click()
    expect(task.getValue()).toBe('-[] text')
  })

  it('Extra runs block formatting on the current line', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const panel = openDropdown(toolbarOf(editor), 'extra')
    editor.getController().setCursor(1, 1)
    menuItem(panel, 'blockquote').click()
    expect(editor.getValue()).toBe('> text')
  })

  it('nested Graph inserts the pie starter', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const toolbar = toolbarOf(editor)
    openDropdown(toolbar, 'extra')

    const extraPanel = toolbar.querySelector<HTMLElement>('[data-dropdown-panel="extra"]')
    expect(extraPanel).not.toBeNull()
    const graphTrigger = triggerFor(extraPanel as HTMLElement, 'graph')
    expect(graphTrigger.classList.contains('notedown-toolbar-submenu-trigger')).toBe(true)
    graphTrigger.click()
    expect(graphTrigger.getAttribute('aria-expanded')).toBe('true')

    const graphPanel = toolbar.querySelector<HTMLElement>('[data-dropdown-panel="graph"]')
    expect(graphPanel?.classList.contains('is-open')).toBe(true)
    editor.getController().setCursor(1, 1)
    menuItem(graphPanel as HTMLElement, 'pie-graph').click()
    expect(editor.getValue()).toContain('%% pie')
    expect(toolbar.querySelector('.notedown-toolbar-menu.is-open')).toBeNull()
  })

  it('opens the emoji picker and inserts the picked emoji', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const panel = openDropdown(toolbarOf(editor), 'extra')
    editor.getController().setCursor(1, 1)
    menuItem(panel, 'emoji').click()

    const picker = document.querySelector<HTMLElement>('.notedown-emoji-picker')
    expect(picker).not.toBeNull()
    expect(picker?.classList.contains('emoji-picker')).toBe(true)
    const grid = picker?.querySelector('.emoji-grid')
    expect(grid).not.toBeNull()
    const cell = picker?.querySelector<HTMLButtonElement>('.emoji-cell')
    expect(cell).not.toBeNull()
    const char = cell?.textContent ?? ''
    expect(char).not.toBe('')

    cell?.click()
    expect(editor.getValue()).toContain(char)
    expect(document.querySelector('.notedown-emoji-picker')).toBeNull()
  })

  it('outside clicks and Escape close an open panel and reset aria-expanded', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const toolbar = toolbarOf(editor)
    const header = triggerFor(toolbar, 'header')

    header.click()
    expect(header.getAttribute('aria-expanded')).toBe('true')
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    outside.click()
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(toolbar.querySelector('.notedown-toolbar-menu.is-open')).toBeNull()

    header.click()
    expect(header.getAttribute('aria-expanded')).toBe('true')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(toolbar.querySelector('.notedown-toolbar-menu.is-open')).toBeNull()
  })

  it('opening a dropdown closes an open emoji picker', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const toolbar = toolbarOf(editor)
    const panel = openDropdown(toolbar, 'extra')
    menuItem(panel, 'emoji').click()
    expect(document.querySelector('.notedown-emoji-picker')).not.toBeNull()

    const header = triggerFor(toolbar, 'header')
    header.click()
    expect(document.querySelector('.notedown-emoji-picker')).toBeNull()
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps a menu open when the menu itself scrolls, but closes it on page scroll', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const panel = openDropdown(toolbarOf(editor), 'extra')

    // A scroll inside the menu's own overflow area must not dismiss it.
    panel.dispatchEvent(new Event('scroll'))
    expect(panel.classList.contains('is-open')).toBe(true)

    // Page/document scrolling invalidates the fixed panel position: close it.
    document.dispatchEvent(new Event('scroll'))
    expect(panel.classList.contains('is-open')).toBe(false)
  })

  it('keeps every duplicate mode button in sync with clicks and setMode', () => {
    const editor = track(
      createNotedownEditor({
        mount: makeHost(),
        value: 'x',
        toolbar: { items: [['mode'], ['mode']] },
      }),
    )
    const modes = Array.from(
      editor.element.querySelectorAll<HTMLButtonElement>('button[data-item="mode"]'),
    )
    expect(modes.length).toBe(2)
    expect(modes.map((button) => button.textContent)).toEqual(['Live', 'Live'])

    modes[0]?.click()
    expect(modes.map((button) => button.textContent)).toEqual(['Source', 'Source'])
    expect(modes.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'true'])

    editor.setMode('live')
    expect(modes.map((button) => button.textContent)).toEqual(['Live', 'Live'])
    expect(modes.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
  })

  it('destroy closes an open panel/picker, removes the toolbar, and is idempotent', () => {
    const first = track(
      createNotedownEditor({ mount: makeHost(), toolbar: { preset: 'full' } }),
    )
    openDropdown(toolbarOf(first), 'extra')
    expect(first.element.querySelectorAll('.notedown-toolbar-menu').length).toBeGreaterThan(0)
    expect(() => first.destroy()).not.toThrow()
    expect(first.element.querySelector('.notedown-toolbar')).toBeNull()
    expect(first.element.querySelector('.notedown-toolbar-menu')).toBeNull()

    const second = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const panel = openDropdown(toolbarOf(second), 'extra')
    menuItem(panel, 'emoji').click()
    expect(document.querySelector('.notedown-emoji-picker')).not.toBeNull()
    expect(() => second.destroy()).not.toThrow()
    expect(second.element.querySelector('.notedown-toolbar')).toBeNull()
    expect(document.querySelector('.notedown-emoji-picker')).toBeNull()
    expect(() => second.destroy()).not.toThrow()
  })

  it('preserves the editor selection by preventing mousedown, except in emoji search', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: { preset: 'full' } }),
    )
    const toolbar = toolbarOf(editor)

    const trigger = triggerFor(toolbar, 'header')
    const triggerDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    trigger.dispatchEvent(triggerDown)
    expect(triggerDown.defaultPrevented).toBe(true)

    trigger.click()
    const panel = toolbar.querySelector<HTMLElement>('[data-dropdown-panel="header"]')
    expect(panel).not.toBeNull()
    const itemDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    menuItem(panel as HTMLElement, 'header-1').dispatchEvent(itemDown)
    expect(itemDown.defaultPrevented).toBe(true)

    // The picker search field is an input: it must keep its normal focus behavior.
    const extraPanel = openDropdown(toolbar, 'extra')
    menuItem(extraPanel, 'emoji').click()
    const search = document.querySelector<HTMLInputElement>(
      '.notedown-emoji-picker .emoji-search',
    )
    expect(search).not.toBeNull()
    const searchDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    search?.dispatchEvent(searchDown)
    expect(searchDown.defaultPrevented).toBe(false)
  })
})

describe('createNotedownEditor custom dropdown groups', () => {
  it('renders a dropdown descriptor and runs its menu items', () => {
    const editor = track(
      createNotedownEditor({
        mount: makeHost(),
        value: 'text',
        toolbar: {
          items: [
            [
              {
                type: 'dropdown',
                label: 'Heading',
                glyph: 'H',
                items: ['header-1', 'header-2'],
              },
            ],
          ],
        },
      }),
    )
    const toolbar = toolbarOf(editor)
    const trigger = toolbar.querySelector<HTMLButtonElement>(
      '.notedown-toolbar-dropdown-trigger',
    )
    expect(trigger).not.toBeNull()
    expect(trigger?.closest('.notedown-toolbar-dropdown')).not.toBeNull()
    trigger?.click()

    const panel = toolbar.querySelector<HTMLElement>('.notedown-toolbar-menu.is-open')
    expect(panel).not.toBeNull()
    const item = panel?.querySelector<HTMLButtonElement>(
      'button.notedown-toolbar-menu-item[data-item="header-2"]',
    )
    expect(item).not.toBeNull()

    editor.getController().setCursor(1, 1)
    item?.click()
    expect(editor.getValue()).toBe('## text')
  })

  it('ignores unknown ids, empty groups and empty dropdowns', () => {
    const editor = track(
      createNotedownEditor({
        mount: makeHost(),
        toolbar: {
          items: [
            ['not-a-toolbar-item', 'bold'],
            [],
            [{ type: 'dropdown', label: 'Empty', items: [] }],
          ],
        },
      }),
    )
    const toolbar = toolbarOf(editor)
    expect(toolbar.querySelectorAll('button[data-item="not-a-toolbar-item"]').length).toBe(0)
    expect(toolbar.querySelectorAll('button[data-item="bold"]').length).toBe(1)
    expect(toolbar.querySelectorAll('.notedown-toolbar-group').length).toBe(1)
    expect(toolbar.querySelectorAll('.notedown-toolbar-dropdown').length).toBe(0)
  })
})

describe('createNotedownEditor legacy toolbar aliases', () => {
  it('renders and runs h1/h2/bullet-list/ordered-list through their old ids', () => {
    const editor = track(
      createNotedownEditor({ mount: makeHost(), value: 'text', toolbar: true }),
    )
    const toolbar = toolbarOf(editor)

    const h1 = toolbar.querySelector<HTMLButtonElement>('button[data-item="h1"]')
    const h2 = toolbar.querySelector<HTMLButtonElement>('button[data-item="h2"]')
    const bullet = toolbar.querySelector<HTMLButtonElement>('button[data-item="bullet-list"]')
    const ordered = toolbar.querySelector<HTMLButtonElement>('button[data-item="ordered-list"]')
    for (const button of [h1, h2, bullet, ordered]) expect(button).not.toBeNull()
    expect(h1?.getAttribute('aria-label')).toBe('Heading 1')
    expect(h2?.getAttribute('aria-label')).toBe('Heading 2')
    expect(bullet?.getAttribute('aria-label')).toBe('Bulleted list')
    expect(ordered?.getAttribute('aria-label')).toBe('Numbered list')

    editor.getController().setCursor(1, 1)
    h1?.click()
    expect(editor.getValue()).toBe('# text')

    editor.setValue('text')
    editor.getController().setCursor(1, 1)
    bullet?.click()
    expect(editor.getValue()).toBe('- text')

    editor.setValue('text')
    editor.getController().setCursor(1, 1)
    ordered?.click()
    expect(editor.getValue()).toBe('1. text')
  })
})
