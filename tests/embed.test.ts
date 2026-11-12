// @vitest-environment jsdom
// Public embed API contract: mounting, value changes, read-only, themes, the
// toolbar, save keymap, and teardown. Everything here goes through the public
// entry point (including the stylesheet import), exactly like a consumer.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNotedownEditor, type NotedownEditor } from '../src/embed/index'

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
