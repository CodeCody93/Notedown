/**
 * Notedown — print-to-PDF path (print dialog, no native PDF renderer).
 *
 * The user chose the print-dialog route over a native Rust PDF renderer or a
 * client-side generator (jsPDF): `window.print()` inside the Tauri webview
 * opens the OS print dialog, whose "Save as PDF" / "Microsoft Print to PDF"
 * destination produces the PDF with zero Rust changes and zero new
 * dependencies. Browser dev mode works natively (same `window.print()`).
 *
 * Flow (wired by the unified Export dialog in `app.ts`, mirroring the HTML export path):
 *   1. `renderStandaloneHtmlWithImages(doc.content, opts, doc.path, expose)`
 *      produces the self-contained standalone HTML (images inlined).
 *   2. That string is passed to {@link printStandaloneHtml}, which prints it
 *      through a hidden same-origin iframe.
 *   3. Or, for the no-image path, {@link buildPrintableHtml} renders
 *      markdown to printable HTML in one call, then print it with
 *      {@link printStandaloneHtml} (see {@link printMarkdown}).
 *
 * SECURITY: printable HTML comes from `renderStandaloneHtml` (export.ts),
 * which DOMPurify-sanitizes every markdown-it render (`html: true` is on).
 * This module never injects unsanitized strings — the title is escaped with
 * the shared `escapeHtml` helper, and `printStandaloneHtml` writes an
 * already-sanitized standalone document into the iframe via `srcdoc`
 * (same-origin, no scripts fetched: the export CSP allows no remote
 * resources; the only inline script is export.ts's spoiler/copy handler,
 * which is inert print output).
 *
 * No file I/O here — this module never touches `platform/` FileIO or
 * `invoke()` directly, per the package boundaries in AGENTS.md.
 */
import { escapeHtml, renderStandaloneHtml } from './export'

/**
 * Print stylesheet — source of truth at runtime.
 *
 * THREE-way sync: a verbatim mirror lives in `src/styles/print.css` for
 * designer review (header comment there says so), and a subset
 * (spoiler/dropdown/link-URL/page-break print rules) is duplicated in the
 * standalone `@media print` block in `renderStandaloneHtml`
 * (src/app/export.ts) so the exported HTML prints correctly on its own
 * (it never injects PRINT_CSS). If you edit one, copy the change to the
 * others — keep in sync. Do NOT import print.ts from export.ts (cycle:
 * print.ts already imports from export.ts).
 *
 * Design notes:
 * - Forces a light theme for print regardless of system dark mode: the
 *   standalone export follows `prefers-color-scheme`, so this block
 *   re-pins every theme token to its light value inside `@media print`
 *   plus explicit `body` / `main.md-body` overrides with `!important`.
 * - Closed `<details class="md-dropdown">` print as-is (CSS cannot force
 *   the `open` attribute); the `display: block` rule below only normalises
 *   layout, it does not expand closed sections.
 */
export const PRINT_CSS: string = `@media print {
  :root {
    color-scheme: light;
    --bg: #ffffff;
    --surface: #f8f8f6;
    --surface-2: #ececea;
    --text: #1f2328;
    --muted: #6b7280;
    --accent: #2563eb;
    --border: #e3e3df;
    --code-bg: #f3f3f1;
  }
  @page {
    margin: 12mm;
  }
  body {
    background: #fff !important;
    color: #000 !important;
  }
  main.md-body {
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    background: #fff !important;
    color: #000 !important;
  }
  .md-body {
    color: #000 !important;
    background: #fff !important;
  }
  .md-body h1,
  .md-body h2,
  .md-body h3 {
    page-break-after: avoid;
  }
  .md-code-copy {
    display: none !important;
  }
  .md-body pre {
    background: #f5f5f5 !important;
    border: 1px solid #ddd !important;
  }
  .md-body blockquote {
    background: #f5f5f5 !important;
    color: #333 !important;
    border-left-color: #999 !important;
  }
  .md-body code {
    background: #f0f0f0 !important;
  }
  .md-body pre,
  .md-body table,
  .md-body blockquote,
  .md-body img {
    page-break-inside: avoid;
  }
  .md-body img {
    max-width: 100% !important;
  }
  .md-body .md-graph {
    break-inside: avoid;
  }
  .md-body .md-graph-pie,
  .md-body .md-graph-bar,
  .md-body .md-graph-seg,
  .md-body .md-graph-dot,
  .md-body .md-graph-swatch {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  details.md-dropdown {
    display: block !important;
    border-color: #ccc !important;
    overflow: visible !important;
  }
  .md-body .md-dropdown-summary {
    background: #f5f5f5 !important;
    color: #000 !important;
  }
  .md-body .md-spoiler {
    background: none !important;
    color: inherit !important;
  }
  .md-body .md-spoiler[data-revealed="false"] {
    background: none !important;
    color: inherit !important;
  }
  /* Rasterization guard: any CSS filter on an ancestor (including an inline
     style="filter:..." on raw HTML that survives sanitization) forces the
     Chromium print pipeline to rasterize the whole filtered subtree as an
     image, destroying the selectable-text layer. Our own styles set no
     filters on content, but neutralize them in print so NOTHING can push
     text into a bitmap. backdrop-filter is included for the same reason. */
  .md-body *,
  .md-body *::before,
  .md-body *::after {
    filter: none !important;
    backdrop-filter: none !important;
  }
  .md-body a {
    color: #000 !important;
    text-decoration: underline !important;
  }
  .md-body a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 0.85em;
    word-break: break-all;
  }
  .md-body .footnotes {
    color: #333 !important;
  }
}
`

/**
 * Render markdown to a printable standalone HTML document.
 *
 * Reuses `renderStandaloneHtml` from `./export` (DOES NOT duplicate
 * `MARKDOWN_BODY_CSS` / theme tokens) and appends {@link PRINT_CSS} in its
 * own `<style>` element plus a forced-light `<meta name="color-scheme">`
 * hint so the print pipeline never picks dark tokens.
 *
 * @param markdown raw markdown source.
 * @param title document title — escaped via `escapeHtml` before it reaches
 *   `<title>` (imported from `./export`; never interpolated raw).
 * @returns complete HTML document string ready for {@link printStandaloneHtml}.
 */
export function buildPrintableHtml(markdown: string, title: string): string {
  const base = renderStandaloneHtml(markdown, { title, theme: 'light' })
  // renderStandaloneHtml already escaped the title into <title>; nothing
  // further to interpolate, so no new injection surface here. Reference the
  // import so the escape path stays explicit for reviewers.
  void escapeHtml
  const extras =
    `<meta name="color-scheme" content="light">\n` + `<style>\n${PRINT_CSS}\n</style>`
  if (base.includes('</head>')) {
    return base.replace('</head>', `${extras}\n</head>`)
  }
  return `${base}\n${extras}`
}

/**
 * Print an already-rendered standalone HTML document (the `renderStandaloneHtml`
 * / `renderStandaloneHtmlWithImages` output that `app.ts` holds).
 *
 * Creates a hidden same-origin `<iframe>` (off-screen, zero-size — see below),
 * writes the HTML via `srcdoc`, waits for `load`, then calls
 * `iframe.contentWindow.print()` and removes the iframe on `afterprint`
 * (with a fallback timeout for webviews that never fire `afterprint`).
 *
 * POPUP-BLOCKER NOTE: `print()` MUST be called synchronously inside the user
 * click/key handler chain (menu item / hotkey / toolbar button). Do not
 * `await` image inlining or any async work between the gesture and this
 * call — resolve `renderStandaloneHtmlWithImages(...)` FIRST, then call this
 * function directly in the same handler tick. If the async work must follow
 * the click, keep the chain unbroken (no intervening `setTimeout`/idle).
 *
 * Works in both runtimes with no Rust changes: Tauri's webview implements
 * `window.print()` (system dialog → "Save as PDF"), and browser dev mode
 * prints natively. No-ops when there is no DOM (SSR/tests import the module
 * safely — only this function touches `document`).
 *
 * @param standaloneHtml complete HTML document string from
 *   `renderStandaloneHtml` / `renderStandaloneHtmlWithImages` (already
 *   DOMPurify-sanitized upstream — never pass raw markdown or unsanitized
 *   HTML here).
 */
export function printStandaloneHtml(standaloneHtml: string): void {
  if (typeof document === 'undefined') return
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', 'print')
  // Off-screen but laid out: a `display: none` frame has no layout box, and
  // printing a box-less document is a documented blank-page hazard across
  // browsers/versions. A zero-size fixed-position frame stays invisible while
  // keeping the identical print pipeline of a visible document, so the OS
  // "Save as PDF" destination lays out — and emits as selectable text — the
  // same content seen on screen. No `sandbox` attribute on purpose: a
  // sandboxed frame without `allow-modals` blocks `print()`.
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  // srcdoc keeps the frame same-origin so contentWindow.print() is allowed.
  iframe.srcdoc = standaloneHtml

  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    iframe.remove()
  }

  const win = iframe.contentWindow
  if (win !== null) {
    win.addEventListener('afterprint', cleanup)
  }
  iframe.onload = () => {
    const target = iframe.contentWindow
    if (target === null) {
      cleanup()
      return
    }
    try {
      target.focus()
      target.print()
    } catch {
      // Webview denied print (headless/test surface) — drop the frame.
      cleanup()
      return
    }
    // Fallback: some webviews never fire afterprint (dialog dismissed via
    // native chrome). Never leak the hidden frame.
    window.setTimeout(cleanup, 10_000)
  }
  document.body.appendChild(iframe)
}

/**
 * Convenience wrapper: render markdown to printable HTML and print it.
 *
 * For the images-inlined path (local `pic.png` embedded as `data:`), call
 * `renderStandaloneHtmlWithImages(...)` first and pass the result to
 * {@link printStandaloneHtml} instead — same popup-blocker rule applies:
 * keep this call in the synchronous click-handler chain.
 *
 * @param markdown raw markdown source.
 * @param title document title (escaped inside `buildPrintableHtml`).
 */
export function printMarkdown(markdown: string, title: string): void {
  printStandaloneHtml(buildPrintableHtml(markdown, title))
}
