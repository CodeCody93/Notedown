#!/usr/bin/env node
/**
 * Copy the published embed package into the web build so the public site can
 * serve it from `/embed/` (e.g. `<script src="/embed/notedown-editor.js">`).
 *
 * The Node-only SSR renderer (`notedown-render.js`) and source maps stay out of
 * the Pages CDN copy; the npm package still ships the render bundle.
 *
 * Run after both builds:
 *   npm run build          # web app -> dist/
 *   npm run build:embed    # libraries -> dist-embed/
 *   node scripts/copy-embed-to-web.mjs
 * (`npm run build:web` runs the whole chain.)
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const embedDir = resolve(root, "dist-embed");
const webDir = resolve(root, "dist");
const targetDir = resolve(webDir, "embed");
// Node-only bundle (jsdom-based); browsers use `notedown-editor.js` instead.
const NODE_ONLY_FILES = new Set(["notedown-render.js"]);

for (const [label, directory] of [
  ["dist-embed (library build)", embedDir],
  ["dist (web build)", webDir],
]) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    console.error(
      `copy-embed-to-web failed: ${label} directory was not found at ${relative(root, directory)}.`,
    );
    console.error(
      "Run `npm run build` and `npm run build:embed` first, or use `npm run build:web`.",
    );
    process.exit(1);
  }
}

// Replace any stale copy from a previous build instead of merging into it.
// Source maps stay in dist-embed for local debugging but are not published to
// the Pages CDN (they are not part of the npm package `files` list either).
// The render bundle is Node-only and likewise skipped for the browser CDN.
rmSync(targetDir, { recursive: true, force: true });
cpSync(embedDir, targetDir, {
  recursive: true,
  filter: (source) =>
    !source.endsWith(".map") && !NODE_ONLY_FILES.has(basename(source)),
});

function countFiles(directory) {
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(path);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

console.log(
  `Copied ${relative(root, embedDir)} -> ${relative(root, targetDir)} (${countFiles(targetDir)} files).`,
);
