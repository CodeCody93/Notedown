// @vitest-environment jsdom
// TEMPORARY orchestrator integration smoke test for M2 (may be kept as a regression guard).
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { defaultKeymap } from '@codemirror/commands'
import { livePreviewExtensions, wireMouseSelection } from '../src/editor/livePreview'
import { editorThemeExtension } from '../src/editor/cmTheme'
import { createEditor } from '../src/editor/editor'

function mountEditor(extensions: Parameters<typeof EditorState.create>[0]['extensions'], doc = ''): EditorView {
  const host = document.createElement('div')
  host.id = 'host'
  document.body.appendChild(host)
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions }),
  })
  return view
}

function clean(view: EditorView): void {
  view.destroy()
  view.dom.remove()
}

describe('M2 editor smoke', () => {
  it('createEditor mounts a .cm-editor into the mount element', () => {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const controller = createEditor(mount)
    expect(mount.querySelector('.cm-editor')).toBeTruthy()
    expect(mount.querySelector('.cm-content')).toBeTruthy()
    controller.setContent('# Hello')
    expect(controller.getContent()).toBe('# Hello')
    controller.destroy()
    mount.remove()
  })

  it('live mode: **bold** hides marks outside the element; caret inside the region reveals them', () => {
    const view = mountEditor([markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)], 'xx **bold**')
    // Bold element spans [3,11); caret at 0 is outside the region.
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-formatting-inline')).toBeTruthy()
    expect(view.contentDOM.querySelector('.cm-formatting-inline-visible')).toBeNull()
    expect(view.contentDOM.querySelector('.cm-strong')?.textContent).toContain('bold')
    // Move the caret INSIDE the bold region (position 7, in "bold"): the syntax marks
    // re-appear faded (forked element-range reveal, PLAN §1/§6A).
    view.dispatch({ selection: { anchor: 7, head: 7 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-formatting-inline-visible')).toBeTruthy()
    clean(view)
  })

  it('source mode: all syntax stays visible (no hidden formatting classes)', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: false }), editorThemeExtension(), keymap.of(defaultKeymap)],
      '**bold**'
    )
    view.requestMeasure()
    // In source mode (collapse:false) the reveal plugin is excluded so the asterisks
    // remain as plain visible text.
    const html = view.contentDOM.innerHTML
    expect(html).toContain('**')
    expect(view.contentDOM.querySelector('.cm-formatting-inline')).toBeNull()
    clean(view)
  })

  it('wireMouseSelection attaches and cleans up listeners', () => {
    const view = mountEditor([markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension()])
    const cleanup = wireMouseSelection(view)
    const down = new MouseEvent('mousedown')
    const up = new MouseEvent('mouseup')
    view.contentDOM.dispatchEvent(down)
    document.dispatchEvent(up)
    cleanup()
    view.contentDOM.dispatchEvent(down)
    document.dispatchEvent(up)
    clean(view)
  })

  it('GFM strikethrough parses with the markdownLanguage base (~~strike~~ → .cm-strikethrough)', async () => {
    const view = mountEditor(
      [markdown({ base: markdownLanguage }), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      '~~strike~~'
    )
    view.requestMeasure()
    // The default `markdown()` (CommonMark) has no strikethrough; the GFM base
    // must produce a Strikethrough node for the plugin to style.
    expect(view.contentDOM.querySelector('.cm-strikethrough')).toBeTruthy()
    clean(view)
  })

  it('live mode: inactive list lines render a bullet marker widget instead of raw markdown', async () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n- item'
    )
    // Caret on line 1: the list line (line 3) is inactive → '•' widget.
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    const marker = view.contentDOM.querySelector('.cm-list-marker')
    expect(marker).toBeTruthy()
    expect(marker?.textContent).toBe('•')
    // Caret inside the list item (position 8, line 3): the raw '- ' re-appears.
    view.dispatch({ selection: { anchor: 8, head: 8 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-list-marker')).toBeNull()
    clean(view)
  })

  it('live mode: task list markers render ☐ / ☑ widgets when the line is inactive', async () => {
    const unchecked = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n- [ ] todo'
    )
    unchecked.requestMeasure()
    expect(unchecked.contentDOM.querySelector('.cm-list-marker')?.textContent).toContain('☐')
    clean(unchecked)

    const checked = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n- [x] done'
    )
    checked.requestMeasure()
    expect(checked.contentDOM.querySelector('.cm-list-marker')?.textContent).toContain('☑')
    clean(checked)
  })

  it('live mode: images render as widgets with the resolved src', async () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true, imageResolver: async () => 'data:image/png;base64,AA==' }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n![alt](img.png)'
    )
    view.requestMeasure()
    // Let the async resolver settle (microtasks) before inspecting the DOM.
    await new Promise((r) => setTimeout(r, 0))
    const img = view.contentDOM.querySelector('.cm-image-widget img')
    expect(img).toBeTruthy()
    expect((img as HTMLImageElement).src.startsWith('data:image')).toBe(true)
    clean(view)
  })

  it('live mode: unresolvable images fall back to the raw markdown text', async () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true, imageResolver: async () => null }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n![alt](img.png)'
    )
    view.requestMeasure()
    await new Promise((r) => setTimeout(r, 0))
    const unresolved = view.contentDOM.querySelector('.cm-image-unresolved')
    expect(unresolved).toBeTruthy()
    expect(unresolved?.textContent).toContain('![alt]')
    clean(view)
  })
})
