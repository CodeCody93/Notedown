/**
 * Ambient type declarations for markdown-it plugins that ship no bundled
 * types. All of them are plain plugin functions with a default export
 * (their `.mjs` entries do `export default`). The plugin function signatures
 * reuse the plugin types from `@types/markdown-it`.
 *
 * NOTE: `markdown-it-attrs` is intentionally NOT declared here — it bundles
 * its own `index.d.ts` (`export = markdownItAttrs`).
 *
 * IMPORTANT: this file MUST stay a global script (no top-level import/export
 * statements). With a top-level import it would become a module, turning the
 * `declare module` blocks into module *augmentations* — which do not apply to
 * untyped resolved modules (the plugins) and leave TS7016 standing. Inline
 * `import('markdown-it')` type queries keep the file a script while still
 * referencing the markdown-it types.
 */
declare module 'markdown-it-task-lists' {
  interface TaskListsOptions {
    enabled?: boolean
    label?: boolean
    labelAfter?: boolean
  }
  const plugin: import('markdown-it').PluginWithOptions<TaskListsOptions>
  export default plugin
}

declare module 'markdown-it-footnote' {
  const plugin: import('markdown-it').PluginSimple
  export default plugin
}

declare module 'markdown-it-deflist' {
  const plugin: import('markdown-it').PluginSimple
  export default plugin
}

declare module 'markdown-it-mark' {
  const plugin: import('markdown-it').PluginSimple
  export default plugin
}

declare module 'markdown-it-sub' {
  const plugin: import('markdown-it').PluginSimple
  export default plugin
}

declare module 'markdown-it-sup' {
  const plugin: import('markdown-it').PluginSimple
  export default plugin
}

declare module 'markdown-it-emoji' {
  const full: import('markdown-it').PluginSimple
  const light: import('markdown-it').PluginSimple
  const bare: import('markdown-it').PluginSimple
}