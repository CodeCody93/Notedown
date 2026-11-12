/**
 * Standalone HTML document assembly — shared by the app export pipeline
 * (`src/app/export.ts`, File → Export HTML) and the Node-only rendering entry
 * (`@codecody93/notedown-editor/render`).
 *
 * Moving this out of `src/app/export.ts` gives server-side consumers the EXACT
 * same document wrapper (theme tokens, body CSS, highlight.js themes, print
 * CSS, CSP and the spoiler/copy-code script) without pulling in the editor,
 * the platform layer or Tauri. The wrapper is pure string assembly: callers
 * pass already-rendered (and sanitized) markdown HTML as `body`.
 *
 * SECURITY: this module never renders markdown — the caller is responsible
 * for passing sanitized body HTML (see `renderMarkdownWithSanitizer` in
 * `../app/markdown`).
 */
import { escapeHtml, MARKDOWN_BODY_CSS } from '../app/markdown'
import { HLJS_CSS_DARK, HLJS_CSS_LIGHT } from '../styles/hljs-themes'

/**
 * Theme tokens for the standalone export document. The export has no
 * <link rel="stylesheet"> to the app's theme.css, so its :root must define
 * the tokens itself. Mirror of src/styles/theme.css — keep in sync when
 * tokens change. `--mono` is included in both blocks because the dark block
 * in theme.css inherits it from the light/:root block.
 *
 * G2 — the export no longer bakes one theme: the light block is the default
 * `:root` and the dark block rides inside a `prefers-color-scheme: dark`
 * media query so the document follows the system/browser setting.
 */
const THEME_TOKENS: Record<'dark' | 'light', string> = {
  light: `:root {
  color-scheme: light;
  --bg: #ffffff;
  --surface: #f8f8f6;
  --surface-2: #ececea;
  --text: #1f2328;
  --muted: #6b7280;
  --accent: #2563eb;
  --border: #e3e3df;
  --code-bg: #f3f3f1;
  --ghost: rgba(0, 0, 0, 0.55);
  --selection: rgba(37, 99, 235, 0.22);
  --shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  --menu-radius: 8px;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
`,
  dark: `:root {
  color-scheme: dark;
  --bg: #1e1e1e;
  --surface: #252526;
  --surface-2: #2d2d31;
  --text: #e8e8e8;
  --muted: #b0b0b0;
  --accent: #4f8cff;
  --border: #3c3c3c;
  --code-bg: #2a2a2d;
  --ghost: rgba(255, 255, 255, 0.55);
  --selection: rgba(79, 140, 255, 0.32);
  --shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  --menu-radius: 8px;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
`,
}

/**
 * Complete theme stylesheet for a standalone document: the light tokens as the
 * default `:root`, with the dark tokens inside one
 * `@media (prefers-color-scheme: dark)` block. Exported so the Node renderer
 * can expose it to consumers alongside the body and highlight stylesheets.
 */
export const NOTEDOWN_THEME_CSS: string =
  THEME_TOKENS.light + '@media (prefers-color-scheme: dark) {\n' + THEME_TOKENS.dark + '}\n'

/**
 * The standalone document's default Content-Security-Policy: no remote
 * resources (`default-src 'none'`), inline styles for the theme, `data:`/`blob:`
 * images only, and `script-src 'unsafe-inline'` for the single trusted inline
 * script below (spoiler reveal + copy-code button).
 */
export const DEFAULT_EXPORT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:"

/**
 * Options shared by every standalone-document renderer.
 *
 * The document ALWAYS follows `prefers-color-scheme` (light default, dark via
 * the media query), exactly like File → Export HTML — there is deliberately no
 * theme option.
 */
export interface RenderMarkdownDocumentOptions {
  /** Document title — HTML-escaped into `<title>`. Defaults to "Notedown document". */
  title?: string
  /** Value of `<html lang>`. Defaults to "en". */
  lang?: string
  /**
   * Content-Security-Policy meta content. Defaults to {@link DEFAULT_EXPORT_CSP};
   * `false` omits the meta tag entirely (for hosts that set CSP via headers).
   */
  csp?: string | false
}

/**
 * Options for {@link wrapStandaloneHtml}. App call sites have always passed
 * `{ title, theme }`; `theme` is accepted for compatibility and ignored (the
 * document ships BOTH token sets and follows the system/browser preference via
 * `prefers-color-scheme`).
 */
export interface StandaloneHtmlOptions extends RenderMarkdownDocumentOptions {
  /** Document title — HTML-escaped into `<title>`; may be a filename. */
  title: string
  /** Kept for call-site compatibility; ignored (see above). */
  theme?: 'dark' | 'light'
}

/**
 * Wrap already-rendered (and sanitized) markdown HTML in a complete standalone
 * HTML document.
 *
 * The document is self-contained: light theme tokens (:root) with dark
 * overrides via `@media (prefers-color-scheme: dark)` (G2 — no baked app
 * theme; the export follows the system/browser setting), the shared
 * `.md-body` stylesheet, BOTH hljs theme stylesheets (light default, dark
 * switched in by the same media query), and a CSP meta that permits no
 * remote resources (`default-src 'none'`; inline styles for the theme,
 * `data:`/`blob:` images only) with `script-src 'unsafe-inline'` for the
 * single trusted inline script below (spoiler reveal + copy-code button) —
 * rendered output is sanitized by DOMPurify before it reaches `body`, and the
 * CSP is the second layer of defense.
 */
export function wrapStandaloneHtml(body: string, opts: StandaloneHtmlOptions): string {
  const themeCss = NOTEDOWN_THEME_CSS
  const hljsCss =
    HLJS_CSS_LIGHT +
    '@media (prefers-color-scheme: dark) {\n' +
    HLJS_CSS_DARK +
    '}\n'
  const lang = opts.lang ?? 'en'
  // The default policy is emitted verbatim so the app's File → Export HTML
  // output stays byte-identical (it contains no double quotes); a CUSTOM string
  // is escaped for the attribute.
  const cspMeta =
    opts.csp === false
      ? null
      : opts.csp === undefined
        ? `<meta http-equiv="Content-Security-Policy" content="${DEFAULT_EXPORT_CSP}">`
        : `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(opts.csp)}">`
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${escapeHtml(opts.title)}</title>`,
    ...(cspMeta === null ? [] : [cspMeta]),
    `<style>${themeCss}${MARKDOWN_BODY_CSS}${hljsCss}` +
      'body { margin: 0; background: var(--bg); color: var(--text); }\n' +
      'main.md-body { padding: 32px 40px; max-width: 860px; margin: 0 auto; }\n' +
      '/* Keep in sync with PRINT_CSS in src/app/print.ts (spoiler/dropdown/link print rules) — the standalone export must print correctly on its own. */\n' +
      '@media print {\n' +
      '  body, main.md-body { background: #fff; color: #000; }\n' +
      '  .md-body { background: #fff; color: #000; }\n' +
      '  .md-code-copy { display: none; }\n' +
      '  .md-body pre,\n' +
      '  .md-body table,\n' +
      '  .md-body blockquote,\n' +
      '  .md-body img { page-break-inside: avoid; }\n' +
      '  .md-body img { max-width: 100% !important; }\n' +
      '  details.md-dropdown { display: block !important; border-color: #ccc !important; overflow: visible !important; }\n' +
      '  .md-body *, .md-body *::before, .md-body *::after { filter: none !important; backdrop-filter: none !important; }\n' +
      '  .md-body .md-dropdown-summary { background: #f5f5f5 !important; color: #000 !important; }\n' +
  '  .md-body .md-spoiler { background: none !important; color: inherit !important; }\n' +
  '  .md-body .md-spoiler[data-revealed="false"] { background: none !important; color: inherit !important; }\n' +
  '  .md-body .md-graph { break-inside: avoid; page-break-inside: avoid; }\n' +
  '  .md-body .md-graph-pie,\n' +
  '  .md-body .md-graph-bar,\n' +
  '  .md-body .md-graph-seg,\n' +
  '  .md-body .md-graph-dot,\n' +
  '  .md-body .md-graph-swatch { print-color-adjust: exact; -webkit-print-color-adjust: exact; }\n' +
      '  .md-body a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.85em; word-break: break-all; }\n' +
      '}\n' +
      '</style>',
    '</head>',
    `<body><main class="md-body">${body}</main>`,
    `<script>`,
    `(function(){function fallbackCopy(text){var el=document.createElement('textarea');el.value=text;el.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(el);el.select();try{document.execCommand('copy')}catch(e){}document.body.removeChild(el)}document.addEventListener('click',function(e){var s=e.target.closest('.md-spoiler');if(s){s.setAttribute('data-revealed',s.getAttribute('data-revealed')==='true'?'false':'true');return}var btn=e.target.closest('.md-code-copy');if(!btn)return;e.stopPropagation();var code=btn.getAttribute('data-code');if(code===null)return;var done=function(){var svg=btn.innerHTML;btn.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>';setTimeout(function(){btn.innerHTML=svg},2000)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(code).then(done,function(){fallbackCopy(code);done()})}else{fallbackCopy(code);done()}})})();`,
    `</script>`,
    `</body>`,
    '</html>',
  ].join('\n')
}
