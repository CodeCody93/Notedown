import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Standalone demo for the embeddable editor. Run with:
//   npm run demo:embed
// The demo imports `../../src/embed/index.ts` directly, so the dev server's
// root is this folder while Vite is still allowed to read the repo sources.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    port: 1430,
    strictPort: false,
  },
});
