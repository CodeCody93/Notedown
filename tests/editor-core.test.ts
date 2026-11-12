// @vitest-environment jsdom
// Editor-core options the embeddable package relies on: read-only mode,
// custom placeholder, and accessible label. Kept separate from the M2 smoke
// suite so the embed contract has its own small regression guard.
import { describe, it, expect } from 'vitest'
import { createEditor } from '../src/editor/editor'

function makeMount(): HTMLElement {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  return mount
}

function contentDOM(mount: HTMLElement): HTMLElement {
  const el = mount.querySelector('.cm-content')
  expect(el).toBeTruthy()
  return el as HTMLElement
}

describe('editor core options', () => {
  it('is editable by default', () => {
    const mount = makeMount()
    const editor = createEditor(mount)
    try {
      const content = contentDOM(mount)
      expect(content.getAttribute('contenteditable')).toBe('true')
      expect(content.hasAttribute('aria-readonly')).toBe(false)
    } finally {
      editor.destroy()
      mount.remove()
    }
  })

  it('readOnly: true makes the content non-editable; setReadOnly toggles it back', () => {
    const mount = makeMount()
    const editor = createEditor(mount, { content: '# locked', readOnly: true })
    try {
      expect(contentDOM(mount).getAttribute('contenteditable')).toBe('false')
      expect(contentDOM(mount).getAttribute('aria-readonly')).toBe('true')
      expect(editor.getContent()).toBe('# locked')

      editor.setReadOnly(false)
      expect(contentDOM(mount).getAttribute('contenteditable')).toBe('true')
      expect(contentDOM(mount).hasAttribute('aria-readonly')).toBe(false)

      editor.setReadOnly(true)
      expect(contentDOM(mount).getAttribute('contenteditable')).toBe('false')
      expect(contentDOM(mount).getAttribute('aria-readonly')).toBe('true')

      // A full extension rebuild (mode/wrap) must preserve the read-only state.
      editor.setWrapping(false)
      expect(contentDOM(mount).getAttribute('contenteditable')).toBe('false')
    } finally {
      editor.destroy()
      mount.remove()
    }
  })

  it('renders a custom placeholder while the document is empty', () => {
    const mount = makeMount()
    const editor = createEditor(mount, { placeholder: 'Embedded note' })
    try {
      expect(mount.querySelector('.cm-placeholder')?.textContent).toBe('Embedded note')
    } finally {
      editor.destroy()
      mount.remove()
    }
  })

  it('applies ariaLabel to the content textbox and keeps it across a reconfigure', () => {
    const mount = makeMount()
    const editor = createEditor(mount, { ariaLabel: 'Markdown editor' })
    try {
      expect(contentDOM(mount).getAttribute('aria-label')).toBe('Markdown editor')
      editor.setWrapping(false)
      expect(contentDOM(mount).getAttribute('aria-label')).toBe('Markdown editor')
    } finally {
      editor.destroy()
      mount.remove()
    }
  })

  it('destroy removes the editor DOM and leaves the mount reusable', () => {
    const mount = makeMount()
    const editor = createEditor(mount)
    expect(mount.querySelector('.cm-editor')).toBeTruthy()
    editor.destroy()
    expect(mount.querySelector('.cm-editor')).toBeNull()
    expect(mount.childElementCount).toBe(0)

    // The same mount can host a fresh editor (createEditor clears stale children).
    const recreated = createEditor(mount, { content: 'again' })
    try {
      expect(mount.querySelector('.cm-editor')).toBeTruthy()
      expect(recreated.getContent()).toBe('again')
    } finally {
      recreated.destroy()
      mount.remove()
    }
  })
})
