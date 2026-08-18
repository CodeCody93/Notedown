import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

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
    // The plugin's theme sets `.cm-line { line-height: 1.75 }` explicitly, which
    // would beat the inherited value from `.cm-content`; `editor.ts` defines
    // `--cm-line-height` on BOTH `view.dom` and `view.contentDOM`, so resolving
    // the var directly on `.cm-line` (later stylesheet, equal specificity) makes
    // the user's line-height setting win over the plugin's hard-coded 1.75.
    '.cm-line': {
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
      color: 'var(--text)',
    },
    '.cm-header-2': {
      fontSize: '1.5em',
      fontWeight: '600',
      lineHeight: '1.4',
      color: 'var(--text)',
    },
    '.cm-header-3': {
      fontSize: '1.25em',
      fontWeight: '600',
      lineHeight: '1.5',
      color: 'var(--text)',
    },
    '.cm-header-4, .cm-header-5, .cm-header-6': {
      fontWeight: '600',
      color: 'var(--muted)',
    },
    '.cm-strong': {
      fontWeight: '700',
      color: 'var(--text)',
    },
    '.cm-emphasis': {
      fontStyle: 'italic',
      color: 'var(--text)',
    },
    '.cm-strikethrough': {
      textDecoration: 'line-through',
      color: 'var(--muted)',
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
      display: 'inline-block',
      maxWidth: '100%',
      verticalAlign: 'middle',
      margin: '2px 0',
    },
    '.cm-image-widget-img': {
      maxWidth: '100%',
      maxHeight: '160px',
      display: 'block',
      borderRadius: '4px',
    },
    '.cm-image-loading': {
      opacity: '0.5',
    },
    '.cm-image-unresolved': {
      color: 'var(--muted)',
      fontStyle: 'italic',
    },
  })
}
