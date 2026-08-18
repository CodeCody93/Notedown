import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // M5 perf: split vendor code into independent chunks so the app shell loads
  // first and chunks can be cached separately. The editor module is dynamically
  // imported from `src/app/app.ts`, so the `cm-editor` chunk loads lazily off
  // the app-shell critical path (all CM6 value imports now live inside
  // `src/editor/*`).
  // chunkSizeWarningLimit: the `cm-editor` chunk still exceeds 500 kB by size,
  // but it is an ASYNC chunk (only fetched via the dynamic import above) — Vite
  // warns on async chunks too, so the limit is raised purely to silence that
  // informational warning. Re-lower it if the chunk ever becomes eager again.
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes("node_modules")) {
            if (/@codemirror|@lezer|codemirror-live-markdown/.test(id)) return "cm-editor";
            if (/markdown-it|highlight\.js|dompurify/.test(id)) return "markdown-render";
            if (/@tauri-apps/.test(id)) return "tauri";
          }
          return undefined;
        },
      },
    },
  },
}));
