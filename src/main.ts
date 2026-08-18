import { getEditor, initApp } from './app/app'
import { appState } from './app/state'
import type { AppState } from './app/state'

function countWords(content: string): number {
  const trimmed = content.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Missing element #${id}`)
  return node
}

function renderStatusBar(state: AppState): void {
  byId('status-filename').textContent = state.doc.name
  byId('status-dirty').hidden = !state.doc.dirty
  byId('status-mode').textContent =
    state.view === 'preview' ? 'Preview' : state.mode === 'live' ? 'Live' : 'Source'
  // Ln/Col come from the editor cursor callback (wired after initApp resolves).
  byId('status-words').textContent = `${countWords(state.doc.content)} words`
  byId('status-chars').textContent = `${state.doc.content.length} chars`
}

function renderTitle(state: AppState): void {
  document.title = `${state.doc.dirty ? '• ' : ''}${state.doc.name} — MarkItDown`
}

appState.subscribe((s) => {
  renderStatusBar(s)
  renderTitle(s)
})

renderStatusBar(appState.get())
renderTitle(appState.get())

initApp()
  .then(() => {
    getEditor()?.onCursorChange((c) => {
      byId('status-ln').textContent = `Ln ${c.line}`
      byId('status-col').textContent = `Col ${c.col}`
    })
  })
  .catch((err) => console.error('init failed', err))