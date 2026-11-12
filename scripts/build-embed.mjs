#!/usr/bin/env node
/**
 * Assemble the publishable embeddable-editor package in `dist-embed/`.
 *
 * Run after the Vite library build and the declaration emit:
 *   vite build --config vite.config.embed.ts
 *   tsc -p tsconfig.embed.json
 *   node scripts/build-embed.mjs
 * (`npm run build:embed` runs all three.)
 */
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist-embed");

const PACKAGE_NAME = "@codecody93/notedown-editor";
const JS_FILE = "notedown-editor.js";
const CSS_FILE = "notedown-editor.css";
const TYPES_FILE = "types/embed/index.d.ts";

function fail(message) {
  console.error(`Embed package build failed: ${message}`);
  process.exit(1);
}

function repoFile(relativePath) {
  return resolve(root, relativePath);
}

function repoFileExists(relativePath) {
  return existsSync(repoFile(relativePath));
}

function readRootVersion() {
  const packagePath = repoFile("package.json");
  if (!existsSync(packagePath)) {
    fail("package.json was not found at the repository root.");
  }
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (error) {
    fail(`could not parse package.json: ${error.message}`);
  }
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    fail("package.json does not declare a version.");
  }
  return packageJson.version;
}

const version = readRootVersion();

// Fail loudly rather than publishing an empty or half-built package.
for (const [label, relativePath] of [
  ["JavaScript bundle", JS_FILE],
  ["CSS bundle", CSS_FILE],
  ["type declarations", TYPES_FILE],
]) {
  if (!existsSync(resolve(outDir, relativePath))) {
    fail(
      `${label} is missing at dist-embed/${relativePath}. Run ` +
        "`vite build --config vite.config.embed.ts && tsc -p tsconfig.embed.json` first " +
        "(or use `npm run build:embed`).",
    );
  }
}

// `tsc` preserves side-effect stylesheet imports in declaration output (the
// embed entry imports its CSS). The package ships that CSS as a standalone
// file, not under `types/`, and those imports carry no type information — strip
// them so consumers without a `*.css` module shim can resolve the declarations.
function stripCssSideEffectImports(directory) {
  let changed = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      changed += stripCssSideEffectImports(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".d.ts")) continue;
    const source = readFileSync(path, "utf8");
    const next = source.replace(
      /^[ \t]*import\s+(['"])[^'"\r\n]+\.css\1[ \t]*;?[ \t]*\r?\n?/gm,
      "",
    );
    if (next !== source) {
      writeFileSync(path, next);
      changed += 1;
    }
  }
  return changed;
}

const strippedDeclarations = stripCssSideEffectImports(resolve(outDir, "types"));
if (strippedDeclarations > 0) {
  console.log(
    `Stripped side-effect CSS imports from ${strippedDeclarations} declaration file(s).`,
  );
}

// The embed package is framework-agnostic: a Tauri import in the bundle means
// the entry accidentally pulled in the app shell or the platform layer.
const bundleSource = readFileSync(resolve(outDir, JS_FILE), "utf8");
const tauriReferences = [...new Set(bundleSource.match(/@tauri-apps\/[a-z0-9-]+/g) ?? [])];
if (tauriReferences.length > 0) {
  fail(
    `the bundle references Tauri (${tauriReferences.join(", ")}). ` +
      "The embed entry must not import src/app/app.ts, src/main.ts, or src/platform/tauri.ts.",
  );
}

// README.md in the published package is the embedding guide when it exists;
// fall back to the repository README until docs/embedding.md lands.
const embeddingDocs = "docs/embedding.md";
const readmeSource = repoFileExists(embeddingDocs) ? embeddingDocs : "README.md";
if (!repoFileExists(readmeSource)) {
  fail(`neither ${embeddingDocs} nor README.md was found.`);
}
if (!repoFileExists("LICENSE")) {
  fail("LICENSE was not found at the repository root.");
}
const hasNotices = repoFileExists("THIRD_PARTY_NOTICES.md");

const files = [
  JS_FILE,
  CSS_FILE,
  "types",
  "README.md",
  "LICENSE",
];
if (hasNotices) files.push("THIRD_PARTY_NOTICES.md");

// Library mode emits extra chunks only when the entry still has dynamic
// imports. Keep them in the published package (or catch the regression here).
const assetsDir = resolve(outDir, "assets");
const hasExtraAssets = existsSync(assetsDir) && readdirSync(assetsDir).length > 0;
if (hasExtraAssets) {
  files.push("assets");
  console.warn(
    "Warning: the build emitted files under dist-embed/assets (dynamic imports?). " +
      "They are included in the package `files` list; inspect them before publishing.",
  );
}

const embedPackage = {
  name: PACKAGE_NAME,
  version,
  description: "Embeddable Notedown Markdown editor with live preview, built on CodeMirror 6.",
  type: "module",
  main: `./${JS_FILE}`,
  module: `./${JS_FILE}`,
  types: `./${TYPES_FILE}`,
  style: `./${CSS_FILE}`,
  exports: {
    ".": {
      types: `./${TYPES_FILE}`,
      import: `./${JS_FILE}`,
      default: `./${JS_FILE}`,
    },
    "./style.css": {
      types: "./types/style.d.ts",
      default: `./${CSS_FILE}`,
    },
  },
  files,
  sideEffects: ["*.css"],
  license: "MIT",
  // The runtime bundle includes CodeMirror, but the emitted declarations expose
  // EditorController/KeyBinding types, so consumers need the CM type packages.
  peerDependencies: {
    "@codemirror/state": "^6.7.1",
    "@codemirror/view": "^6.43.8",
  },
  keywords: ["markdown", "editor", "codemirror", "live-preview", "notedown"],
  repository: {
    type: "git",
    url: "https://github.com/CodeCody93/Notedown.git",
  },
  homepage: "https://codecody93.github.io/Notedown/",
  publishConfig: {
    registry: "https://npm.pkg.github.com",
  },
};

writeFileSync(resolve(outDir, "package.json"), `${JSON.stringify(embedPackage, null, 2)}\n`);

// Side-effect CSS imports need a declaration when the consumer does not include
// the bundler's client types (e.g. a non-Vite TypeScript setup). The module has
// no exports; declaring an empty module is enough for `import '.../style.css'`.
writeFileSync(
  resolve(outDir, "types/style.d.ts"),
  "// Side-effect import of the packaged stylesheet. The CSS file is emitted\n" +
    "// next to this declaration and exposed through the `./style.css` export.\n" +
    "export {}\n",
);

cpSync(repoFile("LICENSE"), resolve(outDir, "LICENSE"));
cpSync(repoFile(readmeSource), resolve(outDir, "README.md"));
if (hasNotices) {
  cpSync(repoFile("THIRD_PARTY_NOTICES.md"), resolve(outDir, "THIRD_PARTY_NOTICES.md"));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function listFiles(directory, results = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      listFiles(path, results);
    } else if (entry.isFile()) {
      results.push(path);
    }
  }
  return results;
}

const entries = listFiles(outDir).sort();
let totalBytes = 0;
console.log(`\nEmbed package: ${PACKAGE_NAME}@${version}`);
console.log(`Output: ${relative(root, outDir)}/`);
for (const entry of entries) {
  const size = statSync(entry).size;
  totalBytes += size;
  console.log(`  ${relative(outDir, entry).padEnd(38)} ${formatBytes(size)}`);
}
console.log(`  ${"total".padEnd(38)} ${formatBytes(totalBytes)}`);
console.log(`\nReady to publish ${PACKAGE_NAME}@${version}.`);
