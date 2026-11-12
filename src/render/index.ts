/**
 * `@codecody93/notedown-editor/render` — Node-only server-side rendering entry.
 *
 * Renders Notedown markdown with the EXACT same pipeline as the app (one shared
 * markdown-it instance, highlight.js, plugins) and sanitizes every fragment
 * with DOMPurify running against a jsdom window. `renderMarkdownDocument`
 * reuses the File → Export HTML document wrapper, so server output and
 * desktop/web exports are identical.
 *
 * NODE ONLY: this entry imports `jsdom` and must never be bundled for the
 * browser — browser consumers use the editor entry or the environment-neutral
 * factory in `./core`. No editor/CodeMirror, CSS, Tauri, app-shell or platform
 * imports here.
 *
 * The shared jsdom window + DOMPurify renderer is created lazily on first
 * render; jsdom itself is imported at module load so Node bundlers can trace
 * it as a dependency.
 */
import { JSDOM } from 'jsdom'
import DOMPurify from 'dompurify'
import { createNotedownRenderer } from './core'
import type { NotedownRenderer } from './core'
import type { RenderMarkdownDocumentOptions } from './document'

export * from './core'

/** Lazily-created renderer shared by every call in this process. */
let sharedRenderer: NotedownRenderer | null = null

/**
 * Create (once) and return the jsdom-backed renderer.
 *
 * WHY `Window & typeof globalThis`: DOMPurify's `WindowLike` parameter needs
 * the window's constructors (`DocumentFragment`, `DOMParser`, `Node`, …),
 * which the plain TypeScript `Window` type does not carry. The runtime object
 * is a jsdom window in every case.
 */
function getSharedRenderer(): NotedownRenderer {
  if (sharedRenderer === null) {
    const dom = new JSDOM('')
    const purifier = DOMPurify(dom.window as unknown as Window & typeof globalThis)
    sharedRenderer = createNotedownRenderer((html) => purifier.sanitize(html))
  }
  return sharedRenderer
}

/**
 * Render markdown to sanitized HTML (body fragment) using the shared renderer.
 *
 * Synchronous; safe to call repeatedly. The first call initializes jsdom.
 */
export function renderMarkdown(markdown: string): string {
  return getSharedRenderer().renderMarkdown(markdown)
}

/**
 * Render markdown as a complete standalone HTML document using the shared
 * renderer. Defaults: title "Notedown document", lang "en", and the export
 * CSP; the document follows `prefers-color-scheme` like File → Export HTML.
 */
export function renderMarkdownDocument(
  markdown: string,
  options?: RenderMarkdownDocumentOptions,
): string {
  return getSharedRenderer().renderMarkdownDocument(markdown, options)
}
