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

/** Rendered list-marker widget labels in document order. */
function listMarkerLabels(view: EditorView): string[] {
  return Array.from(view.contentDOM.querySelectorAll('.cm-list-marker')).map((el) => el.textContent ?? '')
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

  it('live mode: tables render as a widget when the caret is outside, raw when inside', () => {
    const view = mountEditor(
      [markdown({ base: markdownLanguage }), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'
    )
    // Caret on line 1: every table line is inactive → rendered widget.
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    const widget = view.contentDOM.querySelector('.cm-table-widget')
    expect(widget).toBeTruthy()
    // Header row bold cell class present on the grid.
    expect(view.contentDOM.querySelector('.cm-table-head')).toBeTruthy()
    // Caret inside the table (position 11 = 'b'): raw source, no widget.
    view.dispatch({ selection: { anchor: 11, head: 11 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-table-widget')).toBeNull()
    clean(view)
  })

  it('live mode: --- renders as a horizontal rule widget when the caret is elsewhere', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n---'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-hr-widget')).toBeTruthy()
    // Caret on the rule line: the raw '---' re-appears.
    view.dispatch({ selection: { anchor: 7, head: 7 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-hr-widget')).toBeNull()
    clean(view)
  })

  it('live mode: inactive blockquote lines get the .cm-blockquote style', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n> quote'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-blockquote')).toBeTruthy()
    clean(view)
  })

  it('live mode: trailing {#custom-id} on an inactive heading line is hidden', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n## Head {#id}'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(view.contentDOM.textContent).not.toContain('{#id}')
    // Caret on the heading line: raw text (attribute visible for editing).
    view.dispatch({ selection: { anchor: 8, head: 8 } })
    view.requestMeasure()
    expect(view.contentDOM.textContent).toContain('{#id}')
    clean(view)
  })

  it('live mode: <sub> tags are hidden and the enclosed text gets .cm-sub-content', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\na<sub>x</sub>b'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(view.contentDOM.textContent).not.toContain('<sub>')
    expect(view.contentDOM.textContent).not.toContain('</sub>')
    expect(view.contentDOM.querySelector('.cm-sub-content')?.textContent).toBe('x')
    clean(view)
  })

  it('live mode: ==highlight== renders .cm-highlight-content on inactive lines', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n==hi=='
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-highlight-content')?.textContent).toBe('hi')
    clean(view)
  })

  it('live mode: __underline__ renders .cm-underline on inactive lines', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n__und__'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    const underline = view.contentDOM.querySelector('.cm-underline')
    expect(underline).toBeTruthy()
    expect(underline?.textContent).toBe('und')
    clean(view)
  })

  it('live mode: -# subtext hides the prefix and styles the rest on inactive lines', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n-# note'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(view.contentDOM.querySelector('.cm-subtext')?.textContent).toBe('note')
    expect(view.contentDOM.textContent).not.toContain('-#')
    clean(view)
  })

  it('live mode: -[] task markers render ☐ and toggle the bracket on mousedown', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n-[] task'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    const marker = view.contentDOM.querySelector('.cm-list-marker')
    expect(marker).toBeTruthy()
    expect(marker?.textContent).toContain('☐')
    // Click the marker: the bracket toggles to [x] in the doc.
    marker?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(view.state.doc.toString()).toBe('para\n\n-[x] task')
    clean(view)
  })

  it('live mode: unordered list indicators alternate dot / circle with nesting depth', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n- one\n  - two\n    - three\n  - two again'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(listMarkerLabels(view)).toEqual(['•', '◦', '•', '◦'])
    clean(view)
  })

  it('live mode: ordered list indicators cycle 1 / a / i with nesting depth', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n1. one\n   1. sub\n      1. deep\n   2. sub two\n2. two'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(listMarkerLabels(view)).toEqual(['1.', 'a.', 'i.', 'b.', '2.'])
    clean(view)
  })

  it('live mode: an alphabetical source marker starts an alphabetical list', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\na. one\nb. two\n   1. sub'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(listMarkerLabels(view)).toEqual(['a.', 'b.', 'i.'])
    clean(view)
  })

  it('live mode: an indented continuation of an alphabetical list starts the sub-list at Roman i', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\na. one\n   b. sub\nb. two'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(listMarkerLabels(view)).toEqual(['a.', 'i.', 'b.'])
    clean(view)
  })

  it('live mode: nested lists keep their depth after indented continuation text', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\n1. one\n   continuation\n   1. sub\n2. two'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(listMarkerLabels(view)).toEqual(['1.', 'a.', '2.'])
    clean(view)
  })

  it('live mode: Roman source markers render their Roman sequence', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      'para\n\ni. one\nii. two\niii. three'
    )
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    view.requestMeasure()
    expect(listMarkerLabels(view)).toEqual(['i.', 'ii.', 'iii.'])
    clean(view)
  })

  it('live mode: the active ordered line shows its depth-cycled indicator, not the source number', () => {
    const view = mountEditor(
      [markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension(), keymap.of(defaultKeymap)],
      '1. text\n2. text\n   a. text\n   4. line being edited'
    )
    // Caret at the end of the last (active) line: every list line, including
    // the active one, shows its rendered indicator. The nested `4.` is the
    // second item of the alpha sub-list, so it must read `b.` — not `4.`.
    view.dispatch({ selection: { anchor: view.state.doc.length, head: view.state.doc.length } })
    view.requestMeasure()
    expect(listMarkerLabels(view)).toEqual(['1.', '2.', 'a.', 'b.'])

    // Moving the caret onto the raw marker reveals the source `4.` for editing.
    const lastLine = view.state.doc.line(4)
    view.dispatch({ selection: { anchor: lastLine.from + 3, head: lastLine.from + 3 } })
    view.requestMeasure()
    expect(listMarkerLabels(view)).toEqual(['1.', '2.', 'a.'])
    expect(view.contentDOM.textContent).toContain('4.')
    clean(view)
  })

  it('cmTheme: the line-height rule uses .cm-content .cm-line to beat the package theme', () => {
    const view = mountEditor([markdown(), ...livePreviewExtensions({ collapse: true }), editorThemeExtension()], '')
    const sheets = Array.from(document.styleSheets)
    const rules = sheets.flatMap((sheet) => Array.from(sheet.cssRules))
    const lineHeightRule = rules
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .find((r) => r.selectorText.includes('.cm-content .cm-line'))
    expect(lineHeightRule).toBeTruthy()
    expect(lineHeightRule?.cssText).toContain('var(--cm-line-height')
    clean(view)
  })
})
