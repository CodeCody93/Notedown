import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Tests run in Node/jsdom where the standard pdfjs build crashes (it
    // evaluates `new DOMMatrix()` plus other browser-only APIs at module
    // scope — hence the `legacy` recommendation pdfjs itself prints). Redirect
    // bare 'pdfjs-dist' imports to the Node-safe legacy build. Production is
    // unaffected (vite.config.ts, a separate file, has no such alias).
    alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // DOMMatrix/Path2D shims for the pdfjs-dist main-thread build (it
    // evaluates `new DOMMatrix()` at module scope; Node/jsdom lack it).
    setupFiles: ['tests/setup-dom-shim.ts'],
  },
})
