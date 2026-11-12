import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Standalone library build for the embeddable editor. Kept separate from the
// app's `vite.config.ts` so the published bundle never inherits the Tauri dev
// server settings or the app's manual chunking.
//
// Everything the entry imports (CodeMirror, markdown-it, DOMPurify, …) is
// bundled into the output — there are no externals. `src/embed/index.ts` must
// stay free of Tauri imports (see `scripts/build-embed.mjs`, which fails the
// package step if `@tauri-apps/*` leaks into the bundle).
export default defineConfig({
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    copyPublicDir: false,
    target: "es2020",
    minify: true,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL("./src/embed/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: "notedown-editor",
      cssFileName: "notedown-editor",
    },
  },
});
