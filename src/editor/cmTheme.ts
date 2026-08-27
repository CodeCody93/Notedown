import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HLJS_CSS_DARK, HLJS_CSS_LIGHT } from '../styles/hljs-themes'

let hljsStylesInjected = false
function ensureHljsStyles(): void {
  if (hljsStylesInjected) return
  if (typeof document === 'undefined') return
  hljsStylesInjected = true
  const style = document.createElement('style')
  style.id = 'cm-hljs-theme'
  style.textContent = `
  .cm-code-widget { display: block; margin: 4px 0; position: relative; }
  .cm-code-widget pre { background: var(--code-bg); padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; margin: 0; }
  .cm-code-widget code.hljs { background: transparent !important; padding: 0; display: block; overflow-x: auto; }
  .cm-code-widget .hljs { background: transparent !important; }
  .cm-code-copy {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: var(--surface-2, #ececea);
    color: var(--muted, #6b7280);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
    z-index: 1;
  }
  .cm-code-widget:hover .cm-code-copy { opacity: 1; }
  .cm-code-copy:hover { background: var(--border, #e3e3df); color: var(--text, #1f2328); }
  .cm-code-copy:active { transform: scale(0.95); }
  ${HLJS_CSS_LIGHT}
  @media (prefers-color-scheme: dark) {
    ${HLJS_CSS_DARK}
  }
  /* Explicit [data-theme="dark"] support so editor follows app setting even when OS is light */
  [data-theme="dark"] .cm-code-widget .hljs,
  [data-theme="dark"] .hljs { color: #c9d1d9; }
  [data-theme="dark"] .cm-code-widget .hljs-doctag,
  [data-theme="dark"] .cm-code-widget .hljs-keyword,
  [data-theme="dark"] .cm-code-widget .hljs-meta .hljs-keyword,
  [data-theme="dark"] .cm-code-widget .hljs-template-tag,
  [data-theme="dark"] .cm-code-widget .hljs-template-variable,
  [data-theme="dark"] .cm-code-widget .hljs-type,
  [data-theme="dark"] .cm-code-widget .hljs-variable.language_ { color: #ff7b72; }
  [data-theme="dark"] .cm-code-widget .hljs-title,
  [data-theme="dark"] .cm-code-widget .hljs-title.class_,
  [data-theme="dark"] .cm-code-widget .hljs-title.class_.inherited__,
  [data-theme="dark"] .cm-code-widget .hljs-title.function_ { color: #d2a8ff; }
  [data-theme="dark"] .cm-code-widget .hljs-attr,
  [data-theme="dark"] .cm-code-widget .hljs-attribute,
  [data-theme="dark"] .cm-code-widget .hljs-literal,
  [data-theme="dark"] .cm-code-widget .hljs-meta,
  [data-theme="dark"] .cm-code-widget .hljs-number,
  [data-theme="dark"] .cm-code-widget .hljs-operator,
  [data-theme="dark"] .cm-code-widget .hljs-variable,
  [data-theme="dark"] .cm-code-widget .hljs-selector-attr,
  [data-theme="dark"] .cm-code-widget .hljs-selector-class,
  [data-theme="dark"] .cm-code-widget .hljs-selector-id { color: #79c0ff; }
  [data-theme="dark"] .cm-code-widget .hljs-regexp,
  [data-theme="dark"] .cm-code-widget .hljs-string,
  [data-theme="dark"] .cm-code-widget .hljs-meta .hljs-string { color: #a5d6ff; }
  [data-theme="dark"] .cm-code-widget .hljs-built_in,
  [data-theme="dark"] .cm-code-widget .hljs-symbol { color: #ffa657; }
  [data-theme="dark"] .cm-code-widget .hljs-comment,
  [data-theme="dark"] .cm-code-widget .hljs-code,
  [data-theme="dark"] .cm-code-widget .hljs-formula { color: #8b949e; }
  [data-theme="dark"] .cm-code-widget .hljs-name,
  [data-theme="dark"] .cm-code-widget .hljs-quote,
  [data-theme="dark"] .cm-code-widget .hljs-selector-tag,
  [data-theme="dark"] .cm-code-widget .hljs-selector-pseudo { color: #7ee787; }
  [data-theme="dark"] .cm-code-widget .hljs-section { color: #1f6feb; }
  [data-theme="dark"] .cm-code-widget .hljs-bullet { color: #f2cc60; }
  [data-theme="dark"] .cm-code-copy { background: #2d2d31; color: #b0b0b0; }
  [data-theme="dark"] .cm-code-copy:hover { background: #3c3c3c; color: #e8e8e8; }
`
  document.head.appendChild(style)
}

/**
 * CM6 theme mapping our design tokens (theme.css) onto `.cm-*` classes.
 *
 * ORDERING CONTRACT: `editor.ts` includes codemirror-live-markdown's
 * `editorTheme` extension FIRST and appends this extension AFTER it. Each
 * `EditorView.theme(...)` compiles to a stylesheet whose rules are mounted in
 * extension order (later modules win for equal-specificity selectors), so our
 * selectors — which deliberately mirror the plugin's — override it. We only
 * override COLOR/text styling; the plugin's opacity/scale transitions (the fade
 * animation) are left untouched.
 *
 * We intentionally do NOT set the plugin's `--md-*` hsl-triplet variables
 * (`--md-heading`, `--md-bold`, ...): they expect `hsl()` triplet syntax and
 * would duplicate our tokens. Direct class overrides with `var(--...)` are the
 * cleaner approach and let a single theme serve BOTH dark and light with zero
 * rebuild on a `[data-theme]` switch (the vars resolve from theme.css).
 */
export function editorThemeExtension(): Extension {
  ensureHljsStyles()
  return EditorView.theme({
    // ---- Editor chrome -------------------------------------------------
    // Our `--bg` shows through from `.editor-pane`.
    '.cm-editor': {
      background: 'transparent',
      color: 'var(--text)',
    },

    // ---- Text metrics --------------------------------------------------
    // `editor.ts` sets `--cm-font-size` / `--cm-line-height` inline on
    // `view.dom`; fall back to the defaults here.
    '.cm-content': {
      fontSize: 'var(--cm-font-size, 15px)',
      lineHeight: 'var(--cm-line-height, 1.6)',
      caretColor: 'var(--accent)',
    },
    // The plugin's theme sets `.cm-line { line-height: 1.75 }` explicitly. Each
    // `EditorView.theme()` prefixes its selectors with a generated class, so the
    // plugin's rule compiles to `.ͼX .cm-line` (0,2,0) and — because style-mod
    // mounts its modules in reverse extension order — lands AFTER ours in the
    // same `<style>` tag, beating an equal-specificity override (verified
    // empirically: the H3 line-height setting appeared to do nothing).
    // `.cm-content .cm-line` compiles to `.ͼY .cm-content .cm-line` (0,3,0),
    // which wins regardless of stylesheet order. `editor.ts` defines
    // `--cm-line-height` on BOTH `view.dom` and `view.contentDOM`, so the var
    // resolves on every `.cm-line`.
    '.cm-content .cm-line': {
      lineHeight: 'var(--cm-line-height, 1.6)',
    },

    // ---- Caret & selection ---------------------------------------------
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
    },
    // The plugin's theme sets selection backgrounds with `!important`, so we
    // must match it to win (equal specificity, later stylesheet). `::selection`
    // is scoped by CM6 to the editor's theme class, so it only affects the
    // editor content.
    '.cm-selectionBackground, .cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--selection) !important',
    },

    // ---- Faded grey reveal (the core M2 visual) ------------------------
    // Hidden syntax chars: faint muted token.
    '.cm-formatting-inline, .cm-formatting-block': {
      color: 'var(--muted)',
    },
    // Revealed (caret in region) syntax chars: faded but readable grey
    // (WCAG-AA readable per PLAN §13). Only COLOR is overridden here — the
    // plugin's opacity/scale transitions drive the fade and stay as-is.
    '.cm-formatting-inline-visible': {
      color: 'var(--ghost)',
    },
    '.cm-formatting-block-visible': {
      color: 'var(--ghost)',
    },

    // ---- Markdown styles overridden to our tokens ------------------------
    // Keep the plugin's relative heading sizes; color h1–h3 as text and
    // h4–h6 as muted for a tasteful hierarchy.
    '.cm-header-1': {
      fontSize: '2em',
      fontWeight: '700',
      lineHeight: '1.3',
      color: 'var(--text) !important',
    },
    '.cm-header-2': {
      fontSize: '1.5em',
      fontWeight: '600',
      lineHeight: '1.4',
      color: 'var(--text) !important',
    },
    '.cm-header-3': {
      fontSize: '1.25em',
      fontWeight: '600',
      lineHeight: '1.5',
      color: 'var(--text) !important',
    },
    '.cm-header-4, .cm-header-5, .cm-header-6': {
      fontWeight: '600',
      color: 'var(--muted) !important',
    },
    '.cm-strong': {
      fontWeight: '700',
      color: 'var(--text) !important',
    },
    '.cm-emphasis': {
      fontStyle: 'italic',
      color: 'var(--text) !important',
    },
    '.cm-strikethrough': {
      textDecoration: 'line-through',
      color: 'var(--muted) !important',
    },
    '.cm-code': {
      backgroundColor: 'var(--code-bg)',
      color: 'var(--text)',
      padding: '2px 4px',
      borderRadius: '3px',
      fontFamily: 'var(--mono)',
    },
    '.cm-link, .cm-wikilink': {
      color: 'var(--accent)',
      textDecoration: 'underline',
    },

    // ---- Live-preview widgets (list markers + rendered images) ------------
    // Rendered from livePreview.ts in collapsed mode. These classes are only
    // produced by our fork (the package's own image widget is opt-in and NOT
    // part of our extension set), but they mount in the same later stylesheet
    // as the overrides above, after the plugin's editorTheme.
    '.cm-list-marker': {
      color: 'var(--text)',
      userSelect: 'none',
    },
    '.cm-image-widget': {
      display: 'block',
      width: '100%',
      maxWidth: '100%',
      height: 'auto',
      margin: '2px 0',
    },
    '.cm-image-widget-img': {
      width: '100%',
      height: 'auto',
      maxWidth: '100%',
      maxHeight: 'none',
      display: 'block',
      borderRadius: '4px',
      objectFit: 'contain',
      aspectRatio: 'auto',
    },
    '.cm-image-loading': {
      opacity: '0.5',
    },
    '.cm-image-unresolved': {
      color: 'var(--muted)',
      fontStyle: 'italic',
    },
    '.cm-link-widget': {
      color: 'var(--accent)',
      textDecoration: 'underline',
      cursor: 'pointer',
    },
    '.cm-link-widget:hover': {
      textDecoration: 'underline',
    },

    // ---- Code block widget (H) -------------------------------------------
    '.cm-code-widget': {
      display: 'block',
      margin: '4px 0',
      position: 'relative',
    },
    '.cm-code-widget pre': {
      backgroundColor: 'var(--code-bg)',
      padding: '0.8em 1em',
      borderRadius: '6px',
      overflowX: 'auto',
      margin: '0',
    },
    '.cm-code-widget code.hljs': {
      backgroundColor: 'transparent',
      padding: '0',
      display: 'block',
      overflowX: 'auto',
    },
    '.cm-code-copy': {
      position: 'absolute',
      top: '6px',
      right: '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      padding: '0',
      border: 'none',
      borderRadius: '4px',
      background: 'var(--surface-2)',
      color: 'var(--muted)',
      cursor: 'pointer',
      opacity: '0',
      transition: 'opacity 0.15s ease, background 0.15s ease, color 0.15s ease',
      zIndex: '1',
    },
    '.cm-code-widget:hover .cm-code-copy': {
      opacity: '1',
    },
    '.cm-code-copy:hover': {
      background: 'var(--border)',
      color: 'var(--text)',
    },
    '.cm-code-copy:active': {
      transform: 'scale(0.95)',
    },
  })
}
