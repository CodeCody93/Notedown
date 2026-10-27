// @vitest-environment jsdom
// Navigator panel controller: visibility rules, tree rendering, collapse state,
// heading navigation and toolbar-toggle state. The markdown parsing itself is
// covered by tests/navigator.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNavigator } from '../src/app/navigator'
import type { EditorController } from '../src/editor/editor'

function setup(): {
  mount: HTMLElement
  nav: ReturnType<typeof createNavigator>
  setCursor: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  preferenceChanges: boolean[]
} {
  const mount = document.createElement('aside')
  document.body.appendChild(mount)

  const setCursor = vi.fn()
  const focus = vi.fn()
  const editor = { setCursor, focus } as unknown as EditorController
  const preferenceChanges: boolean[] = []

  const nav = createNavigator({
    mount,
    getEditor: () => editor,
    onPreferenceChange: (enabled) => preferenceChanges.push(enabled),
  })

  return { mount, nav, setCursor, focus, preferenceChanges }
}

function flushOutline(): void {
  vi.advanceTimersByTime(200)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.textContent = ''
})

describe('createNavigator', () => {
  it('stays hidden when enabled but the document has no headings', () => {
    const { mount, nav } = setup()
    nav.setEnabled(true)

    expect(mount.hidden).toBe(true)

    nav.update('just a paragraph', 'untitled')
    flushOutline()

    expect(mount.hidden).toBe(true)
    nav.destroy()
  })

  it('renders a nested tree and reveals the panel when headings arrive', () => {
    const { mount, nav } = setup()
    nav.setEnabled(true)
    nav.update('# One\n\n## Two\n\n### Three', 'doc-1')
    flushOutline()

    expect(mount.hidden).toBe(false)
    const links = Array.from(mount.querySelectorAll<HTMLButtonElement>('.navigator-link'))
    expect(links.map((link) => link.textContent)).toEqual(['One', 'Two', 'Three'])
    expect(mount.querySelectorAll('.navigator-item')).toHaveLength(3)
    nav.destroy()
  })

  it('moves the editor caret to the clicked heading and focuses it', () => {
    const { mount, nav, setCursor, focus } = setup()
    nav.setEnabled(true)
    nav.update('# One\n\n## Two', 'doc-1')
    flushOutline()

    const links = mount.querySelectorAll<HTMLButtonElement>('.navigator-link')
    links[1].click()

    expect(setCursor).toHaveBeenCalledWith(3, 1)
    expect(focus).toHaveBeenCalledTimes(1)
    nav.destroy()
  })

  it('collapses and expands a heading with children', () => {
    const { mount, nav } = setup()
    nav.setEnabled(true)
    nav.update('# One\n\n## Two\n\n### Three', 'doc-1')
    flushOutline()

    const toggle = mount.querySelector<HTMLButtonElement>('.navigator-toggle')
    expect(toggle).not.toBeNull()
    const childList = toggle?.closest('.navigator-item')?.querySelector<HTMLUListElement>('.navigator-sublist')
    expect(childList).toBeTruthy()

    toggle?.click()
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(childList?.hidden).toBe(true)

    toggle?.click()
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(childList?.hidden).toBe(false)
    nav.destroy()
  })

  it('hides on disable and shows the toolbar button as pressed only when enabled', () => {
    const { mount, nav } = setup()
    const toolbar = document.createElement('button')
    toolbar.dataset.action = 'navigator'
    document.body.appendChild(toolbar)

    nav.setEnabled(true)
    nav.update('# One', 'doc-1')
    flushOutline()
    expect(mount.hidden).toBe(false)
    expect(toolbar.getAttribute('aria-pressed')).toBe('true')
    expect(toolbar.classList.contains('active')).toBe(true)

    nav.setEnabled(false)
    expect(mount.hidden).toBe(true)
    expect(toolbar.getAttribute('aria-pressed')).toBe('false')
    expect(toolbar.classList.contains('active')).toBe(false)
    nav.destroy()
  })

  it('toggles the persisted preference and updates the button state', () => {
    const { nav, preferenceChanges } = setup()
    const toolbar = document.createElement('button')
    toolbar.dataset.action = 'navigator'
    document.body.appendChild(toolbar)

    nav.setEnabled(true)
    nav.toggle()

    expect(preferenceChanges).toEqual([false])
    expect(toolbar.getAttribute('aria-pressed')).toBe('false')

    nav.toggle()
    expect(preferenceChanges).toEqual([false, true])
    expect(toolbar.getAttribute('aria-pressed')).toBe('true')
    nav.destroy()
  })

  it('preserves collapse state when the outline changes but keys stay the same', () => {
    const { mount, nav } = setup()
    nav.setEnabled(true)
    nav.update('# One\n\n## Two', 'doc-1')
    flushOutline()

    const toggle = mount.querySelector<HTMLButtonElement>('.navigator-toggle')
    toggle?.click()
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')

    // Add a paragraph after the headings: the outline structure/keys are unchanged.
    nav.update('# One\n\n## Two\n\nA new paragraph.', 'doc-1')
    flushOutline()

    const after = mount.querySelector<HTMLButtonElement>('.navigator-toggle')
    expect(after?.getAttribute('aria-expanded')).toBe('false')
    nav.destroy()
  })
})
