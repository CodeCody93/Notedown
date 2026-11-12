# Notedown

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/badge/sponsor-GitHub%20Sponsors-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CodeCody93)

Notedown is a local-first Markdown editor with live preview, built with Tauri v2, TypeScript, Vite, and CodeMirror 6. It runs as a native desktop app on Windows, macOS, and Linux, as a static web app, and as an embeddable editor component. Documents, drafts, recents, and settings stay on your machine; the web build keeps its data in browser storage (localStorage/IndexedDB) unless you open or save a file.

## Get Notedown

| I want to… | Start here |
| --- | --- |
| Install the desktop app | [Download the latest release](https://github.com/CodeCody93/Notedown/releases/latest) — Windows `.msi`, Linux `.deb`/`.AppImage`, macOS universal `.dmg` |
| Try it without installing | [Open the web app](https://codecody93.github.io/Notedown/) in a browser |
| Embed the editor in another app | [Install `@codecody93/notedown-editor`](#embeddable-editor) from GitHub Packages or load the CDN bundle |
| Read the Markdown dialect | [The Notedown Standard](docs/notedown-standard.md) |

## Features

- CodeMirror 6 editor with Markdown syntax support and live preview
- Outline navigator panel for jumping between headings
- Formatting toolbar, keyboard shortcuts, and configurable menus
- Export to TXT, HTML, PDF, DOCX, and RTF
- Import from Markdown, HTML, DOCX, and PDF
- Tables, task lists, footnotes, definition lists, highlights, sub/superscript, and CSS-based charts
- Local draft recovery, recent files, and session restore
- OS file associations for `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, and `.mdwn`
- Single-instance forwarding so opening a second document reuses the running window
- Browser build with a save fallback for Firefox and Safari
- Embeddable editor package for other web apps

## Notedown Standard

Notedown's Markdown dialect is documented as **The Notedown Standard**: CommonMark plus selected GitHub Flavored Markdown features and a small set of extensions for richer documents. Extensions include underline, highlight, spoilers, collapsible dropdowns, and CSS-based graphs. See [The Notedown Standard](docs/notedown-standard.md) for the full specification.

## Tech stack

- Frontend: TypeScript, Vite, CodeMirror 6
- Rendering: markdown-it with plugins, highlight.js, DOMPurify
- Desktop shell: Tauri v2 (Rust)
- Tests: Vitest

## Prerequisites

- Node.js 20 LTS or newer
- npm 10 or newer
- Rust 1.99.1 or newer installed with rustup
- Tauri v2 platform prerequisites:
  - Windows: Visual Studio Build Tools with the C++ desktop workload, plus WebView2
  - macOS: Xcode Command Line Tools
  - Linux: WebKitGTK, libappindicator, librsvg, and patchelf (see the Tauri v2 prerequisites)
- Android builds: Android Studio, Android SDK/NDK, and a JDK
- iOS builds: macOS with Xcode and code signing

## Getting started

Install dependencies:

```powershell
npm ci
```

Run the desktop app:

```powershell
npm run tauri dev
```

Run the web app locally:

```powershell
npm run dev
```

## Desktop application

Download the latest installer from the [GitHub Releases page](https://github.com/CodeCody93/Notedown/releases/latest):

| Platform | Asset | Install |
| --- | --- | --- |
| Windows 10/11 (x64) | `.msi` | Run the installer. SmartScreen warns because the build is unsigned: **More info → Run anyway**. |
| Ubuntu / Debian (x64) | `.deb` | `sudo apt install ./Notedown_<version>_amd64.deb` |
| Linux (x64) | `.AppImage` | `chmod +x Notedown_<version>_amd64.AppImage` then run it |
| macOS (Universal) | `.dmg` | Open the DMG and drag Notedown into Applications. The build is unsigned/not notarized; right-click → **Open** on first launch. |

The desktop app is the recommended path for local file work: native open/save,
file associations, recent files, and images saved next to the document.

Full platform notes, Gatekeeper/SmartScreen details, update/uninstall steps, and
system requirements are in [`docs/install.md`](docs/install.md).

## Web app

Live demo: <https://codecody93.github.io/Notedown/>

The web target is the same Vite frontend built as a static site and deployed to GitHub Pages by `.github/workflows/build.yml`. Everything runs in the browser: rendering, conversion, and file access. Chromium browsers use the File System Access API for in-place saves; Firefox and Safari fall back to a hidden file picker and download a new copy on save. Browser limitations:

- In-place save is Chromium-only. Firefox and Safari download a new `.md` copy on every save.
- Relative/local images cannot be resolved. Remote `https:` images and inline `data:` images render; keep documents with sibling images on the desktop app.
- Pasted images are embedded as inline `data:` URLs, capped at about 2 MB each.
- Browser storage (settings, recents, drafts, file handles) can be evicted. Treat it as a convenience, not a backup.
- There is no OS integration (file associations, native recents, native dialogs).

See [`docs/web.md`](docs/web.md) for the deployment details and the browser QA checklist. The desktop app remains the recommended path for heavy local file work.

## Embeddable editor

`@codecody93/notedown-editor` packages the editor core as a framework-agnostic ES module plus CSS and TypeScript declarations. It is published to GitHub Packages and is also served from the Pages site. The package is editor-only: it does not include Notedown's desktop menus, native file dialogs, import/export pipeline, recents, or drafts. The host page supplies the initial value, listens for changes, and decides where to save.

```ts
import { createNotedownEditor } from '@codecody93/notedown-editor'
import '@codecody93/notedown-editor/style.css'

const editor = createNotedownEditor({
  mount: '#editor',
  value: '# Notes\n\nHello **world**.',
  toolbar: true,
  onChange: (value) => console.log(value),
  onSave: (value) => saveToYourBackend(value),
})

// On unmount:
editor.destroy()
```

Authentication is required even though the package is public. Configure
`.npmrc` first:

```ini
@codecody93:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`GITHUB_TOKEN` needs at least `read:packages`. Then install:

```sh
npm install @codecody93/notedown-editor
```

See [`docs/embedding.md`](docs/embedding.md) for the full `.npmrc` setup, API reference, and CSP notes.

Load the same bundle directly from the CDN (no authentication):

- JavaScript: <https://codecody93.github.io/Notedown/embed/notedown-editor.js>
- CSS: <https://codecody93.github.io/Notedown/embed/notedown-editor.css>
- Package docs: [`docs/embedding.md`](docs/embedding.md)

## Sponsor

Notedown is MIT-licensed and free to use. If it saves you time, you can support development through GitHub Sponsors: <https://github.com/sponsors/CodeCody93>.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the web app dev server |
| `npm run build` | Typecheck and build the web app into `dist/` |
| `npm run build:web` | Build the web app, the embed bundle, and copy the embed package into `dist/embed/` |
| `npm run build:embed` | Build the publishable embed package into `dist-embed/` |
| `npm run demo:embed` | Run the embed demo locally |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm test` | Run the Vitest suite |
| `npm run tauri dev` | Start the desktop app in development |
| `npm run tauri build` | Build platform bundles |
| `npm run verify` | Version check, typecheck, tests, web/embed production build, and desktop bundle |
| `cargo check` | Check the Rust backend from `src-tauri/` |

## Releases

Pushes to `main` deploy the web app to GitHub Pages. Pushing a `v<version>` tag triggers GitHub Actions to build the Windows `.msi`, Linux `.deb`/`.AppImage`, and a universal macOS `.dmg`, and publish `@codecody93/notedown-editor` to GitHub Packages. Desktop installers are attached to a draft GitHub Release for review. See [`docs/releasing.md`](docs/releasing.md) for the full checklist.

## Project layout

- `src/app/` - application state, menus, shortcuts, formatting, drafts, import/export
- `src/editor/` - CodeMirror 6 wiring and live preview
- `src/embed/` - embeddable editor entry point and public API
- `examples/embed-demo/` - local demo for the embeddable editor (`npm run demo:embed`)
- `src/platform/` - file I/O abstraction with browser and Tauri implementations
- `src/styles/` - application and embed styles
- `src-tauri/` - Tauri v2 Rust backend, capabilities, and icons
- `scripts/` - release/version and embed build helper scripts
- `tests/` - Vitest suites
- `docs/` - install guide, the Notedown Standard, embedding guide, web notes, QA checklists, samples, and project notes

All file I/O goes through `src/platform/`. UI code must not call browser file pickers or Tauri `invoke()` directly. The embed entry must stay free of Tauri and `src/platform/` imports so the published package works in any browser app.

## Multi-machine workflow

On each machine:

1. Install the prerequisites above.
2. Clone the repository.
3. Run `npm ci`.
4. Authenticate Git with GitHub, for example `gh auth login`.
5. Run `npm run tauri dev` or `npm test` to verify the checkout.

Keep local secrets and signing material out of the repository. `.env` files, Android keystores, `key.properties`, certificate files, and npm auth tokens are ignored. Commit `package-lock.json` and `src-tauri/Cargo.lock` so every machine resolves the same dependency versions.

## License

MIT. See [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
