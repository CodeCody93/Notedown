// @vitest-environment jsdom
// Preview mode (PLAN §14): pane toggling, debounced re-render with stale
// indicator, external/relative/# link handling, image resolution, theme sync.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setView, togglePreview, wirePreview } from '../src/app/preview'
import { appState } from '../src/app/state'
import { HLJS_CSS_DARK } from '../src/app/export'
import type { FileIO } from '../src/platform/types'

function byId(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Missing element #${id}`)
  return node
}

function makeIo(): FileIO {
  return {
    openExternal: vi.fn().mockResolvedValue(undefined),
    exposeImage: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  } as unknown as FileIO
}

let io: FileIO

describe('preview mode', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="editor-area">
        <div id="editor" class="editor-pane"></div>
        <div id="preview-pane" class="preview-pane" hidden>
          <div id="preview-stale" class="preview-stale" hidden>Rendering…</div>
          <div id="preview-body" class="md-body"></div>
        </div>
      </main>`
    document.documentElement.dataset.theme = 'light'
    appState.set({
      doc: {
        path: '/docs/notes.md',
        name: 'notes.md',
        content: '# Hi',
        dirty: false,
        savedContent: '# Hi',
        lineEnding: 'LF',
        encoding: 'utf-8',
      },
      view: 'edit',
      settings: { ...appState.get().settings, theme: 'light' },
    })
    io = makeIo()
    wirePreview(io)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('setView shows the preview pane and hides the editor, and renders on entry', () => {
    vi.useFakeTimers()
    setView('preview')
    expect(byId('preview-pane').hidden).toBe(false)
    expect(byId('editor').hidden).toBe(true)
    vi.advanceTimersByTime(160)
    expect(byId('preview-body').innerHTML).toContain('<h1>Hi</h1>')
    setView('edit')
    expect(byId('preview-pane').hidden).toBe(true)
    expect(byId('editor').hidden).toBe(false)
  })

  it('togglePreview flips appState.view', () => {
    vi.useFakeTimers()
    expect(appState.get().view).toBe('edit')
    togglePreview()
    expect(appState.get().view).toBe('preview')
    togglePreview()
    expect(appState.get().view).toBe('edit')
    vi.runAllTimers() // flush any debounced render armed while in preview
  })

  it('re-renders debounced while in preview: only the last content appears', () => {
    vi.useFakeTimers()
    setView('preview')
    vi.advanceTimersByTime(160) // entry render
    appState.set({ doc: { ...appState.get().doc, content: '# First' } })
    expect(byId('preview-stale').hidden).toBe(false)
    vi.advanceTimersByTime(100)
    appState.set({ doc: { ...appState.get().doc, content: '# Second' } })
    vi.advanceTimersByTime(160)
    expect(byId('preview-body').innerHTML).toContain('<h1>Second</h1>')
    expect(byId('preview-body').innerHTML).not.toContain('First')
    expect(byId('preview-stale').hidden).toBe(true)
  })

  it('shows the stale indicator during a pending render and hides it after', () => {
    vi.useFakeTimers()
    setView('preview')
    vi.advanceTimersByTime(160) // entry render done
    appState.set({ doc: { ...appState.get().doc, content: '# Changed' } })
    expect(byId('preview-stale').hidden).toBe(false)
    vi.advanceTimersByTime(160)
    expect(byId('preview-stale').hidden).toBe(true)
    expect(byId('preview-body').innerHTML).toContain('<h1>Changed</h1>')
  })

  it('opens external links via openExternal and prevents default', async () => {
    vi.useFakeTimers()
    appState.set({ doc: { ...appState.get().doc, content: '[site](https://a.dev)' } })
    setView('preview')
    vi.advanceTimersByTime(160)
    const anchor = byId('preview-body').querySelector('a')
    expect(anchor).not.toBeNull()
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor!.dispatchEvent(ev)
    await Promise.resolve()
    expect(io.openExternal).toHaveBeenCalledWith('https://a.dev')
    expect(ev.defaultPrevented).toBe(true)
  })

  it('resolves relative links against the doc directory', async () => {
    vi.useFakeTimers()
    appState.set({ doc: { ...appState.get().doc, content: '[other](other.md)' } })
    setView('preview')
    vi.advanceTimersByTime(160)
    const anchor = byId('preview-body').querySelector('a')
    expect(anchor).not.toBeNull()
    anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(io.openExternal).toHaveBeenCalledWith('/docs/other.md')
  })

  it('does not open in-page # anchors externally', async () => {
    vi.useFakeTimers()
    appState.set({ doc: { ...appState.get().doc, content: '[top](#top)' } })
    setView('preview')
    vi.advanceTimersByTime(160)
    const anchor = byId('preview-body').querySelector('a')
    expect(anchor).not.toBeNull()
    anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(io.openExternal).not.toHaveBeenCalled()
  })

  it('strips javascript: URLs from the rendered HTML', () => {
    vi.useFakeTimers()
    appState.set({ doc: { ...appState.get().doc, content: '[x](javascript:alert(1))' } })
    setView('preview')
    vi.advanceTimersByTime(160)
    // markdown-it's validateLink rejects javascript: hrefs, so no anchor is
    // rendered at all — the source stays as plain text.
    expect(byId('preview-body').querySelector('a')).toBeNull()
    expect(byId('preview-body').innerHTML).toContain('[x](javascript:alert(1))')
  })

  it('resolves local image srcs via exposeImage', async () => {
    vi.useFakeTimers()
    appState.set({ doc: { ...appState.get().doc, content: '![p](pic.png)' } })
    setView('preview')
    vi.advanceTimersByTime(160)
    await Promise.resolve()
    const img = byId('preview-body').querySelector('img')
    expect(img).not.toBeNull()
    expect(io.exposeImage).toHaveBeenCalledWith('/docs/pic.png')
    expect(img!.src).toBe('data:image/png;base64,AAAA')
  })

  it('syncs the highlight.js theme when the effective theme changes', () => {
    vi.useFakeTimers()
    setView('preview')
    vi.advanceTimersByTime(160)
    document.documentElement.dataset.theme = 'dark'
    appState.set({ doc: { ...appState.get().doc, content: '# Dark' } })
    vi.advanceTimersByTime(160)
    const style = document.getElementById('preview-style')
    expect(style).not.toBeNull()
    expect(style!.textContent).toContain(HLJS_CSS_DARK)
  })
})