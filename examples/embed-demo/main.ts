import { createNotedownEditor } from '../../src/embed/index.ts'

type ThemeOption = 'light' | 'dark' | 'system'
type ModeOption = 'live' | 'source'

const SAMPLE_MARKDOWN = [
  '# Notedown embed demo',
  '',
  'A **standalone Markdown editor** with live preview, tables, task lists, and syntax-highlighted code. The host page imports a single TypeScript entry and the embed owns its stylesheet.',
  '',
  '## Highlights',
  '',
  '- Live preview while you type',
  '- Source mode for raw Markdown',
  '- Light, dark, and system themes',
  '- Read-only mode for published documents',
  '',
  '## Task list',
  '',
  '- [x] Build the embeddable entry point',
  '- [x] Scope the stylesheet to the editor root',
  '- [ ] Publish `@codecody93/notedown-editor`',
  '- [ ] Embed it in another product',
  '',
  '## Keyboard shortcuts',
  '',
  '| Action | Windows / Linux | macOS |',
  '| --- | --- | --- |',
  '| Save | Ctrl+S | Cmd+S |',
  '| Bold | Ctrl+B | Cmd+B |',
  '| Italic | Ctrl+I | Cmd+I |',
  '',
  '## Code',
  '',
  '```ts',
  'const editor = createNotedownEditor({',
  '  mount: document.querySelector("#editor")!,',
  '  value: "# Hello"',
  '})',
  '',
  'editor.focus()',
  '```',
  '',
  '> Tip: use the controls above to switch theme, mode, and read-only state at runtime.',
  '',
].join('\n')

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`[embed-demo] expected an element with id "${id}".`)
  }
  return element as T
}

const mountElement = requireElement<HTMLDivElement>('editor')
const themeSelect = requireElement<HTMLSelectElement>('theme-select')
const modeSelect = requireElement<HTMLSelectElement>('mode-select')
const readOnlyToggle = requireElement<HTMLInputElement>('readonly-toggle')
const valueStats = requireElement<HTMLSpanElement>('value-stats')
const cursorPosition = requireElement<HTMLSpanElement>('cursor-position')
const valueReadout = requireElement<HTMLPreElement>('value-readout')

function renderValue(value: string): void {
  const lines = value.length === 0 ? 0 : value.split('\n').length
  valueStats.textContent = `${value.length.toLocaleString()} chars · ${lines.toLocaleString()} lines`
  valueReadout.textContent = value
}

const editor = createNotedownEditor({
  mount: mountElement,
  value: SAMPLE_MARKDOWN,
  mode: 'live',
  theme: 'system',
  toolbar: true,
  ariaLabel: 'Notedown embed demo editor',
  onChange: renderValue,
  onCursorChange: ({ line, col }) => {
    cursorPosition.textContent = `Ln ${line}, Col ${col}`
  },
  onSave: (value) => {
    // A real host would persist the document here. The demo only logs it; the
    // keydown listener below suppresses the browser's save-page dialog.
    console.log('[embed-demo] onSave', value)
  },
})

themeSelect.addEventListener('change', () => {
  editor.setTheme(themeSelect.value as ThemeOption)
})

modeSelect.addEventListener('change', () => {
  const mode: ModeOption = modeSelect.value === 'source' ? 'source' : 'live'
  editor.setMode(mode)
})

readOnlyToggle.addEventListener('change', () => {
  editor.setReadOnly(readOnlyToggle.checked)
})

function suppressBrowserSave(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
  }
}

document.addEventListener('keydown', suppressBrowserSave)

window.addEventListener('beforeunload', () => {
  document.removeEventListener('keydown', suppressBrowserSave)
  editor.destroy()
})

renderValue(editor.getValue())
