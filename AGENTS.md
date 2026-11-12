# AGENTS.md

## Repo state

- **This file is the single source of truth** for conventions and locked decisions. Notedown 0.7.0 is the first public release: a Tauri desktop app, a static web app on GitHub Pages, and an embeddable `@codecody93/notedown-editor` package, all MIT-licensed. Milestones M0–M3 are implemented (editor, live preview, menus, platform I/O), the post-feedback fix batches are in, and the navigator outline side panel (collapsible heading tree, settings/toolbar/hotkey toggle) is implemented — see `docs/user-results.md` for what was fixed and `docs/user-tests.md` for the manual QA checklist.
- Stack: Vite + TS frontend, Tauri v2 `src-tauri/` backend. Verified green: `npm run dev`, `npm run typecheck`, `npm run build`, `npm test` (706 Vitest tests). Rust toolchain 1.99.1 (rustup, MSVC) is installed; `cargo check` in `src-tauri/` is clean.
- Git: initialized on `main` with save-point commits (M0–M3 batch, feedback-fix batch, round-2 test checklist).
- **Public release artifacts:** desktop installers on the GitHub Release, web app at <https://codecody93.github.io/Notedown/>, CDN copy of the embed bundle at `/Notedown/embed/`, and `@codecody93/notedown-editor` on GitHub Packages. LICENSE/`Cargo.toml` are MIT; the root `package.json` metadata is updated by the release commit. GitHub Sponsors: <https://github.com/sponsors/CodeCody93> (`.github/FUNDING.yml`).
- **Rebranding:** Application renamed from "MarkItDown" to "Notedown" for beta/release. All references updated across codebase.
- **App icon:** purple note-and-pen mark, master at `src-tauri/icons/app-icon.png`, browser favicon at `public/favicon.png`. Regenerate platform icons with `npm run tauri icon src-tauri/icons/app-icon.png`; `src-tauri/build.rs` tracks the icon files so rebuilt bundles pick up changes.
- **OS file-open:** `bundle.fileAssociations` registers md/markdown/mdown/mkd/mkdn/mdwn on install. `src-tauri/src/open.rs` buffers OS-opened paths (Windows/Linux argv, macOS `RunEvent::Opened`), and `tauri-plugin-single-instance` forwards a second launch's argv to the running window. The frontend drains the queue via the optional `FileIO.takePendingOpenPaths()` / `onOpenFileRequested()` members and the payload-less `notedown:open-file` wake-up event.
- **CI (GitHub Actions):** `.github/workflows/build.yml` runs a test/version-check job and then builds the Windows `.msi`, Ubuntu 22.04 `.deb`/`.AppImage`, and a universal macOS `.dmg` on pushes to `main`, pull requests, and `v*` tags. A separate `web` job deploys `dist/` to GitHub Pages on pushes to `main` and `v*` tags (skipped on PRs), and `publish-embed` publishes the `notedown-editor-package` artifact to GitHub Packages on `v*` tags. Tag pushes create a **draft** GitHub Release with the installers attached; branch/PR runs upload workflow artifacts instead. A release tag must be `v<package version>`; `npm run version:check` enforces tag/app-version consistency across all version files. Use `npm run version:bump -- X.Y.Z` to update every version file before tagging. Builds are unsigned (Windows SmartScreen and macOS Gatekeeper will warn; macOS is not notarized). See `docs/releasing.md`.

## Multi-agent workflow

- **Orchestrator (primary/default agent):** takes the user's request, asks clarifying questions via the `question` tool when needed, then splits it into independent work packets — separated by system (e.g. editor vs platform vs styles) and by implementation vs investigation. Spawn as many coder subagents in parallel as possible. **The orchestrator owns test execution**: after coders report back, it runs the tests itself, then runs `npm run tauri build` (or `npm run verify` for the full chain) as the post-test full-build check, plus cross-packet integration checks.
- **Packet rule (critical):** packets must never overlap files. Assign disjoint file sets up front.
- **Coder (subagent):** implements exactly one packet. Write tests only when truly necessary (tests are slow — avoid by default). **Never run tests or builds** — other coder agents work in parallel in the same workspace; a build can interfere.
- Both agents are fully unrestricted (`permission: allow`, no prompts). Speed is the top priority: `subagent_depth: 1`, model `opencode-go/deepseek-v4.1-flash` at variant `max`.
- Orchestrator should act as the verifier: it owns test runs and cross-packet integration checks (e.g. platform/tauri.ts ↔ src-tauri Rust commands), since no single coder sees the whole picture.

## Stack & architecture

- **Stack:** Vite + TypeScript frontend; **Tauri v2** (Rust) backend in `src-tauri/`. Editor = CodeMirror 6 + `codemirror-live-markdown`; renderer = markdown-it + plugins + highlight.js + DOMPurify.
- **Three surfaces, one editor core:** Tauri desktop (Windows/macOS/Linux/Android/iOS), the static web app on GitHub Pages, and the `src/embed/` library build (`@codecody93/notedown-editor`). Desktop and web share `src/app/` + `src/platform/`; the embed build exposes only the editor core and must never import `src/app/app.ts`, `src/main.ts`, or Tauri/platform code.
- **Package boundaries:** `src/app/` (state, menus, shortcuts, formatting, draft, export), `src/editor/` (CM6 wiring, live preview), `src/embed/` (public embeddable API; demo in `examples/embed-demo/`), `src/platform/` (FileIO interface + `browser.ts` / `tauri.ts` / `detect.ts`), `src/styles/`. All file I/O goes through `platform/` — UI code never touches `window.showOpenFilePicker` or `invoke()` directly. `vite.config.embed.ts`, `tsconfig.embed.json`, and `scripts/build-embed.mjs` produce the publishable `dist-embed/` package.
- **No UI framework, no state library.** Hand-rolled observable store in `src/app/state.ts`; data-driven menus in `src/app/menu.ts`.
- **Locked decisions are not open to debate** — they are captured in the architecture and Gotchas sections of this file.

## Gotchas (would guess wrong otherwise)

- `codemirror-live-markdown` is new/alpha (single maintainer). It must be **pinned, forked into `src/editor/livePreview.ts`, and wrapped behind a thin interface** so the base can be swapped — not used as a direct dependency.
- **Security is non-negotiable:** markdown-it runs with `html:true`, so every markdown-it HTML output (export) must pass through DOMPurify. Keep Tauri capabilities minimal (no broad `$HOME` fs scope); Rust commands do file I/O.
- **Android save bug:** `dialog.save()` on Android can write a 0-byte file (upstream issue #3356) — use `tauri-plugin-android-fs` or a ContentResolver copy workaround. This is a required manual QA test, not an optional nice-to-have.
- **Unsigned release builds:** Windows SmartScreen warns, and macOS Gatekeeper blocks the unsigned/not-notarized build until the user right-clicks **Open** or allows it in System Settings. If macOS reports the app is damaged, `xattr -cr /Applications/Notedown.app` clears the quarantine flag. Add signing/notarization secrets before treating macOS as a polished public download.
- **Web is a production target with fallbacks.** Chromium uses the File System Access API for in-place saves; Firefox/Safari use a hidden `<input type="file">` + download-a-copy fallback, and iOS always takes the fallback. Do not assume a persistent file handle — `browser.ts` keeps IndexedDB handles but must degrade cleanly when `showOpenFilePicker`/`showSaveFilePicker` are missing.
- **Web paste images are inline `data:` URLs capped at ~2 MB** (`maxInlineImageBytes` in the embed API). There is no document folder on the web, so `saveInlineImage` replaces desktop's `saveImage`; oversized images are rejected with a user-facing alert. Desktop still writes image files next to the document.
- **GitHub Packages auth caveat:** `@codecody93/notedown-editor` is public but npm consumers still need a GitHub token with `read:packages` in `.npmrc` (`https://npm.pkg.github.com`). The unauthenticated CDN copy under the Pages `/embed/` path is the alternative; document both and never commit tokens.
- **Embed CSS/CSP:** the embed bundle ships `notedown-editor.css`. Shell and toolbar rules are scoped under `.notedown-editor-root`, but the shared editor rules target CodeMirror's `.cm-*` classes — load the stylesheet once per page. CodeMirror injects `<style>` tags at runtime, so hosts need `style-src 'unsafe-inline'` (or a nonce equivalent) in their CSP. The host must give the mount element an explicit height; the root defaults to `height: 100%` with a 220 px minimum.
- Hotkeys: `Ctrl` on Windows/Linux, `Cmd` on macOS. Menu/toolbar hotkey hints must come from the single `src/app/shortcuts.ts` map so they always match.
- OS file-open contract: `notedown:open-file` is a wake-up only (no payload) - always drain `take_pending_open_paths`, which is atomic. Keep the Rust `OPEN_FILE_EVENT` and `src/platform/tauri.ts` constant in sync, register the single-instance plugin first, and keep it on the `~2.4` line while Tauri is 2.11.x (2.5+ requires Tauri 2.12).

## Commands

- `npm run dev` → web app dev server (the Vitest/Playwright test surface).
- `npm run build` → static web app into `dist/`; `npm run build:web` → web app + embed bundle copied to `dist/embed/` (set `VITE_BASE=/Notedown/` for the Pages path).
- `npm run build:embed` → publishable embed package in `dist-embed/`; `npm run demo:embed` → local embed demo.
- `npm test` → Vitest unit tests (formatting/recent/draft/settings/shortcuts/markdown-it/editor) — 706 passing.
- `npm run version:check` → verify every version file matches and, on CI tags, that the tag is `v<package version>`.
- `npm run version:bump -- X.Y.Z` → update all version files atomically for a release.
- `npm run typecheck` → `tsc --noEmit`.
- `npm run tauri dev` → desktop dev; `npm run tauri build` → platform bundles; `cargo check` (in `src-tauri/`) for the Rust side.
- `npm run verify` → version check + typecheck + `npm test` + `npm run build:web` + `npm run tauri build` (full pipeline: green tests, web/embed production build, plus a runnable desktop bundle for manual QA).
- iOS builds require macOS + Xcode + signing — do last, on a Mac; Android builds work on Windows.
