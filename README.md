# Notedown

Notedown is a local-first Markdown editor with live preview, built with Tauri v2, TypeScript, Vite, and CodeMirror 6. It runs as a native desktop app on Windows, macOS, and Linux, with mobile targets in progress. Documents, drafts, recents, and settings stay on the local machine.

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

## Tech stack

- Frontend: TypeScript, Vite, CodeMirror 6
- Rendering: markdown-it with plugins, highlight.js, DOMPurify
- Desktop shell: Tauri v2 (Rust)
- Tests: Vitest

## Prerequisites

- Node.js 20 LTS or newer
- npm 10 or newer
- Rust 1.97.1 or newer installed with rustup
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

Run the browser dev surface:

```powershell
npm run dev
```

Browser mode uses the File System Access API and is Chromium-only. It is a development and test surface, not a production target.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the browser dev server |
| `npm run build` | Typecheck and build the frontend |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm test` | Run the Vitest suite |
| `npm run tauri dev` | Start the desktop app in development |
| `npm run tauri build` | Build platform bundles |
| `npm run verify` | Typecheck, test, and build the desktop bundle |
| `cargo check` | Check the Rust backend from `src-tauri/` |

## Project layout

- `src/app/` - application state, menus, shortcuts, formatting, drafts, import/export
- `src/editor/` - CodeMirror 6 wiring and live preview
- `src/platform/` - file I/O abstraction with browser and Tauri implementations
- `src/styles/` - application styles and themes
- `src-tauri/` - Tauri v2 Rust backend, capabilities, and icons
- `tests/` - Vitest suites
- `docs/` - QA checklists, samples, and project notes

All file I/O goes through `src/platform/`. UI code must not call browser file pickers or Tauri `invoke()` directly.

## Multi-machine workflow

On each machine:

1. Install the prerequisites above.
2. Clone the repository.
3. Run `npm ci`.
4. Authenticate Git with GitHub, for example `gh auth login`.
5. Run `npm run tauri dev` or `npm test` to verify the checkout.

Keep local secrets and signing material out of the repository. `.env` files, Android keystores, `key.properties`, and certificate files are ignored. Commit `package-lock.json` and `src-tauri/Cargo.lock` so every machine resolves the same dependency versions.

## License

Proprietary. All rights reserved. See `LICENSE`.
