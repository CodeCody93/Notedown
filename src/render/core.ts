/**
 * Environment-neutral renderer factory for Notedown's standalone markdown
 * rendering.
 *
 * This module contains NO DOM or Node globals: callers inject the sanitizer,
 * so the same factory serves the browser/Tauri app, tests and the Node-only
 * `@codecody93/notedown-editor/render` entry (which supplies a jsdom-backed
 * DOMPurify). The markdown pipeline itself is the app's single shared
 * markdown-it instance (`../app/markdown`) — there is deliberately no second
 * instance, so server output matches preview/export byte for byte.
 *
 * SECURITY: `sanitizeHtml` MUST be a real sanitizer (DOMPurify or an
 * equivalent allow-list). There is no option to bypass sanitization.
 */
import { renderMarkdownWithSanitizer } from '../app/markdown'
import type { HtmlSanitizer } from '../app/markdown'
import { wrapStandaloneHtml } from './document'
import type { RenderMarkdownDocumentOptions } from './document'

// Public renderer surface, re-exported by both `./index` (Node entry) and
// consumers that want the environment-neutral factory.
export { MARKDOWN_BODY_CSS } from '../app/markdown'
export { HLJS_CSS_DARK, HLJS_CSS_LIGHT } from '../styles/hljs-themes'
export { NOTEDOWN_THEME_CSS } from './document'
export type { HtmlSanitizer } from '../app/markdown'
export type { RenderMarkdownDocumentOptions, StandaloneHtmlOptions } from './document'

/** Default document title when `renderMarkdownDocument` is called without one. */
const DEFAULT_DOCUMENT_TITLE = 'Notedown document'

/** Default `<html lang>` value for rendered documents. */
const DEFAULT_DOCUMENT_LANG = 'en'

/**
 * A configured renderer: sanitized markdown fragments plus complete standalone
 * HTML documents, both using the shared markdown-it pipeline and document
 * wrapper.
 */
export interface NotedownRenderer {
  /** Render markdown to sanitized HTML (preview/body fragment). */
  renderMarkdown(markdown: string): string
  /** Render markdown as a complete, self-contained standalone HTML document. */
  renderMarkdownDocument(markdown: string, options?: RenderMarkdownDocumentOptions): string
}

/**
 * Create a renderer bound to `sanitizeHtml`.
 *
 * @param sanitizeHtml Sanitizer applied to EVERY rendered markdown fragment.
 *   Production callers must pass a DOMPurify-backed implementation, e.g.
 *   `(html) => DOMPurify.sanitize(html)` (with a window, or via the jsdom
 *   setup in `./index`).
 * @throws TypeError when `sanitizeHtml` is not a function — silently rendering
 *   unsanitized HTML would be an XSS hole.
 */
export function createNotedownRenderer(sanitizeHtml: HtmlSanitizer): NotedownRenderer {
  if (typeof sanitizeHtml !== 'function') {
    throw new TypeError(
      'createNotedownRenderer requires a sanitizeHtml function: (html: string) => string',
    )
  }
  return {
    renderMarkdown(markdown: string): string {
      return renderMarkdownWithSanitizer(markdown, sanitizeHtml)
    },
    renderMarkdownDocument(markdown: string, options?: RenderMarkdownDocumentOptions): string {
      const body = renderMarkdownWithSanitizer(markdown, sanitizeHtml)
      return wrapStandaloneHtml(body, {
        title: options?.title ?? DEFAULT_DOCUMENT_TITLE,
        lang: options?.lang ?? DEFAULT_DOCUMENT_LANG,
        csp: options?.csp,
      })
    },
  }
}
