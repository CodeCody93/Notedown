// @vitest-environment jsdom
// Settings modal (PLAN §12): open/close lifecycle, live-apply patches, value
// refresh on every open, focus trap + restore, listener cleanup on close.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeSettingsModal,
  isSettingsOpen,
  openSettingsModal,
  wireSettingsModal,
} from '../src/app/settingsUI'
import { DEFAULT_SETTINGS } from '../src/app/settings'
import type { Settings } from '../src/app/settings'

function makeDeps(overrides: Partial<Settings> = {}) {
  return {
    getSettings: vi.fn(() => ({ ...DEFAULT_SETTINGS, ...overrides })),
    onApply: vi.fn(),
  }
}

let deps: ReturnType<typeof makeDeps>

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Missing element #${id}`)
  return node as T
}

function dialog(): HTMLElement {
  return byId('settings-modal')
}

function inputByName(name: string, value: string): HTMLInputElement {
  const el = dialog().querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)
  if (el === null) throw new Error(`Missing input ${name}=${value}`)
  return el
}

describe('settings modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="settings-modal-root"></div>'
    deps = makeDeps()
    wireSettingsModal(deps)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when the modal root element is missing', () => {
    document.body.innerHTML = ''
    expect(() => wireSettingsModal(makeDeps())).toThrow()
  })

  it('opens a dialog with current values and toggles isSettingsOpen', () => {
    openSettingsModal()
    expect(isSettingsOpen()).toBe(true)
    const dlg = dialog()
    expect(dlg.getAttribute('role')).toBe('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.getAttribute('aria-labelledby')).toBe('settings-title')
    // values come from DEFAULT_SETTINGS
    expect(inputByName('settings-theme', 'system').checked).toBe(true)
    expect(inputByName('settings-mode', 'live').checked).toBe(true)
    expect(byId<HTMLInputElement>('settings-font-size').value).toBe('15')
    expect(byId<HTMLInputElement>('settings-line-height').value).toBe('1.6')
    expect(byId<HTMLInputElement>('settings-line-wrap').checked).toBe(true)
    expect(byId<HTMLInputElement>('settings-autosave').checked).toBe(true)
    expect(byId<HTMLInputElement>('settings-extra-menu').checked).toBe(false)
    // opening/refreshing never fires onApply
    expect(deps.onApply).not.toHaveBeenCalled()
    closeSettingsModal()
    expect(isSettingsOpen()).toBe(false)
  })

  it('applies theme radio changes', () => {
    openSettingsModal()
    const dark = inputByName('settings-theme', 'dark')
    dark.checked = true
    dark.dispatchEvent(new Event('change', { bubbles: true }))
    expect(deps.onApply).toHaveBeenCalledWith({ theme: 'dark' })
    expect(deps.onApply).toHaveBeenCalledTimes(1)
  })

  it('applies font size input with clamping to 10..32', () => {
    openSettingsModal()
    const fontSize = byId<HTMLInputElement>('settings-font-size')
    fontSize.value = '18'
    fontSize.dispatchEvent(new Event('input'))
    fontSize.value = '99'
    fontSize.dispatchEvent(new Event('input'))
    fontSize.value = '1'
    fontSize.dispatchEvent(new Event('input'))
    expect(deps.onApply).toHaveBeenNthCalledWith(1, { fontSize: 18 })
    expect(deps.onApply).toHaveBeenNthCalledWith(2, { fontSize: 32 })
    expect(deps.onApply).toHaveBeenNthCalledWith(3, { fontSize: 10 })
  })

  it('applies line height input with clamping to 1..2.5', () => {
    openSettingsModal()
    const lineHeight = byId<HTMLInputElement>('settings-line-height')
    lineHeight.value = '2'
    lineHeight.dispatchEvent(new Event('input'))
    lineHeight.value = '3'
    lineHeight.dispatchEvent(new Event('input'))
    lineHeight.value = '0.5'
    lineHeight.dispatchEvent(new Event('input'))
    expect(deps.onApply).toHaveBeenNthCalledWith(1, { lineHeight: 2 })
    expect(deps.onApply).toHaveBeenNthCalledWith(2, { lineHeight: 2.5 })
    expect(deps.onApply).toHaveBeenNthCalledWith(3, { lineHeight: 1 })
  })

  it('applies checkbox toggles with only the changed key', () => {
    openSettingsModal()
    const wrap = byId<HTMLInputElement>('settings-line-wrap')
    wrap.checked = false
    wrap.dispatchEvent(new Event('change'))
    const autosave = byId<HTMLInputElement>('settings-autosave')
    autosave.checked = false
    autosave.dispatchEvent(new Event('change'))
    const extra = byId<HTMLInputElement>('settings-extra-menu')
    extra.checked = true
    extra.dispatchEvent(new Event('change'))
    expect(deps.onApply).toHaveBeenNthCalledWith(1, { lineWrapping: false })
    expect(deps.onApply).toHaveBeenNthCalledWith(2, { autosaveDrafts: false })
    expect(deps.onApply).toHaveBeenNthCalledWith(3, { extraMenuAlwaysVisible: true })
  })

  it('applies default mode radio changes', () => {
    openSettingsModal()
    const source = inputByName('settings-mode', 'source')
    source.checked = true
    source.dispatchEvent(new Event('change', { bubbles: true }))
    expect(deps.onApply).toHaveBeenCalledWith({ defaultMode: 'source' })
    expect(deps.onApply).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, backdrop click, and the close button', () => {
    openSettingsModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(isSettingsOpen()).toBe(false)

    openSettingsModal()
    const backdrop = dialog().parentElement as HTMLElement
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(isSettingsOpen()).toBe(false)

    openSettingsModal()
    const close = dialog().querySelector<HTMLButtonElement>('.settings-close')
    expect(close).not.toBeNull()
    close!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(isSettingsOpen()).toBe(false)
  })

  it('traps Tab focus inside the dialog', () => {
    openSettingsModal()
    const focusables = Array.from(dialog().querySelectorAll<HTMLElement>('button, input'))
    expect(focusables.length).toBeGreaterThan(0)
    // first focusable control is focused on open
    expect(document.activeElement).toBe(focusables[0])

    const last = focusables[focusables.length - 1]
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(focusables[0])

    focusables[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(last)
  })

  it('restores focus to the previously focused element on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    openSettingsModal()
    expect(document.activeElement).not.toBe(trigger)
    closeSettingsModal()
    expect(document.activeElement).toBe(trigger)
  })

  it('reopens with refreshed values after settings change', () => {
    openSettingsModal()
    closeSettingsModal()
    deps.getSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      fontSize: 20,
      lineWrapping: false,
      defaultMode: 'source',
    })
    openSettingsModal()
    expect(inputByName('settings-theme', 'dark').checked).toBe(true)
    expect(inputByName('settings-mode', 'source').checked).toBe(true)
    expect(byId<HTMLInputElement>('settings-font-size').value).toBe('20')
    expect(byId<HTMLInputElement>('settings-line-wrap').checked).toBe(false)
  })

  it('removes the document keydown listener on close', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    openSettingsModal()
    closeSettingsModal()
    const added = addSpy.mock.calls.filter((c) => c[0] === 'keydown')
    const removed = removeSpy.mock.calls.filter((c) => c[0] === 'keydown')
    expect(added.length).toBe(1)
    expect(removed.length).toBe(1)
    // Escape after close is inert: no handler is left attached.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(isSettingsOpen()).toBe(false)
  })

  it('re-wiring swaps deps without duplicating the dialog', () => {
    openSettingsModal()
    closeSettingsModal()
    const nextDeps = makeDeps({ theme: 'dark' })
    wireSettingsModal(nextDeps)
    expect(document.querySelectorAll('.settings-backdrop').length).toBe(1)
    openSettingsModal()
    expect(inputByName('settings-theme', 'dark').checked).toBe(true)
    const source = inputByName('settings-mode', 'source')
    source.checked = true
    source.dispatchEvent(new Event('change', { bubbles: true }))
    expect(nextDeps.onApply).toHaveBeenCalledWith({ defaultMode: 'source' })
    expect(deps.onApply).not.toHaveBeenCalled()
  })
})