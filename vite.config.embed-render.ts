import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Standalone, Node-only library build for the server-side Markdown renderer.
// It runs after `vite.config.embed.ts` and writes into the same `dist-embed/`
// directory, so the editor config owns emptying it (`emptyOutDir: false` here)
// and the published package ships both `notedown-editor.js` and
// `notedown-render.js`.
//
// The entry (`src/render/index.ts`) renders markdown-it output through
// DOMPurify backed by jsdom. CSS is exported as strings rather than imported,
// so this build emits no stylesheet. `jsdom` and `node:module` stay external:
// consumers provide jsdom (optional peer dependency) and Node built-ins must
// never be bundled. The Node resolve conditions keep Vite from picking a
// browser DOMPurify build.
export default defineConfig({
  resolve: {
    conditions: ["node", "import", "module", "default"],
  },
  build: {
    outDir: "dist-embed",
    emptyOutDir: false,
    copyPublicDir: false,
    target: "node20",
    minify: true,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL("./src/render/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: "notedown-render",
    },
    rollupOptions: {
      external: ["jsdom", "node:module"],
    },
  },
});
