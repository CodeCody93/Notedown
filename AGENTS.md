# AGENTS.md

## Repo state

- **This file is the single source of truth** for conventions and locked decisions. Milestones M0–M3 are implemented (editor, live preview, menus, platform I/O), the post-feedback fix batches are in, and the navigator outline side panel (collapsible heading tree, settings/toolbar/hotkey toggle) is implemented — see `docs/user-results.md` for what was fixed and `docs/user-tests.md` for the manual QA checklist.
- Stack: Vite + TS frontend, Tauri v2 `src-tauri/` backend. Verified green: `npm run dev`, `npm run typecheck`, `npm run build`, `npm test` (672 Vitest tests). Rust toolchain 1.97.1 (rustup, MSVC) is installed; `cargo check` in `src-tauri/` is clean.
- Git: initialized on `main` with save-point commits (M0–M3 batch, feedback-fix batch, round-2 test checklist).
- **Rebranding:** Application renamed from "MarkItDown" to "Notedown" for beta/release. All references updated across codebase.
- **App icon:** purple note-and-pen mark, master at `src-tauri/icons/app-icon.png`, browser favicon at `public/favicon.png`. Regenerate platform icons with `npm run tauri icon src-tauri/icons/app-icon.png`; `src-tauri/build.rs` tracks the icon files so rebuilt bundles pick up changes.
- **OS file-open:** `bundle.fileAssociations` registers md/markdown/mdown/mkd/mkdn/mdwn on install. `src-tauri/src/open.rs` buffers OS-opened paths (Windows/Linux argv, macOS `RunEvent::Opened`), and `tauri-plugin-single-instance` forwards a second launch's argv to the running window. The frontend drains the queue via the optional `FileIO.takePendingOpenPaths()` / `onOpenFileRequested()` members and the payload-less `notedown:open-file` wake-up event.
- **CI (GitHub Actions):** `.github/workflows/build.yml` builds the Windows `.msi` and Ubuntu 22.04 `.deb`/`.AppImage` on pushes to `main`, pull requests, and `v*` tags. Tag pushes create a **draft** GitHub Release with the installers attached; branch/PR runs upload workflow artifacts instead. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` before pushing a release tag. Builds are unsigned (Windows SmartScreen will warn).

## Multi-agent workflow

- **Orchestrator (primary/default agent):** takes the user's request, asks clarifying questions via the `question` tool when needed, then splits it into independent work packets — separated by system (e.g. editor vs platform vs styles) and by implementation vs investigation. Spawn as many coder subagents in parallel as possible. **The orchestrator owns test execution**: after coders report back, it runs the tests itself, then runs `npm run tauri build` (or `npm run verify` for the full chain) as the post-test full-build check, plus cross-packet integration checks.
- **Packet rule (critical):** packets must never overlap files. Assign disjoint file sets up front.
- **Coder (subagent):** implements exactly one packet. Write tests only when truly necessary (tests are slow — avoid by default). **Never run tests or builds** — other coder agents work in parallel in the same workspace; a build can interfere.
- Both agents are fully unrestricted (`permission: allow`, no prompts). Speed is the top priority: `subagent_depth: 1`, model `opencode/muse-spark-1.3-contributor-free` at variant `xhigh`.
- Orchestrator should act as the verifier: it owns test runs and cross-packet integration checks (e.g. platform/tauri.ts ↔ src-tauri Rust commands), since no single coder sees the whole picture.

## Stack & architecture

- **Stack:** Vite + TypeScript frontend; **Tauri v2** (Rust) backend in `src-tauri/`. Editor = CodeMirror 6 + `codemirror-live-markdown`; renderer = markdown-it + plugins + highlight.js + DOMPurify.
- **Two runtime modes, one codebase:** browser dev mode (File System Access API, Chromium-only — a dev/test surface, **not** production) and Tauri (production: Windows/macOS/Linux/Android/iOS).
- **Package boundaries:** `src/app/` (state, menus, shortcuts, formatting, draft, export), `src/editor/` (CM6 wiring, live preview), `src/platform/` (FileIO interface + `browser.ts` / `tauri.ts` / `detect.ts`), `src/styles/`. All file I/O goes through `platform/` — UI code never touches `window.showOpenFilePicker` or `invoke()` directly.
- **No UI framework, no state library.** Hand-rolled observable store in `src/app/state.ts`; data-driven menus in `src/app/menu.ts`.
- **Locked decisions are not open to debate** — they are captured in the architecture and Gotchas sections of this file.

## Gotchas (would guess wrong otherwise)

- `codemirror-live-markdown` is new/alpha (single maintainer). It must be **pinned, forked into `src/editor/livePreview.ts`, and wrapped behind a thin interface** so the base can be swapped — not used as a direct dependency.
- **Security is non-negotiable:** markdown-it runs with `html:true`, so every markdown-it HTML output (export) must pass through DOMPurify. Keep Tauri capabilities minimal (no broad `$HOME` fs scope); Rust commands do file I/O.
- **Android save bug:** `dialog.save()` on Android can write a 0-byte file (upstream issue #3356) — use `tauri-plugin-android-fs` or a ContentResolver copy workaround. This is a required manual QA test, not an optional nice-to-have.
- Browser-mode FS Access API is Chromium-only by design; document it as a dev/test surface, never as a production path.
- Hotkeys: `Ctrl` on Windows/Linux, `Cmd` on macOS. Menu/toolbar hotkey hints must come from the single `src/app/shortcuts.ts` map so they always match.
- OS file-open contract: `notedown:open-file` is a wake-up only (no payload) - always drain `take_pending_open_paths`, which is atomic. Keep the Rust `OPEN_FILE_EVENT` and `src/platform/tauri.ts` constant in sync, register the single-instance plugin first, and keep it on the `~2.4` line while Tauri is 2.11.x (2.5+ requires Tauri 2.12).

## Commands

- `npm run dev` → browser dev mode (the Vitest/Playwright test surface).
- `npm test` → Vitest unit tests (formatting/recent/draft/settings/shortcuts/markdown-it/editor) — 269 passing.
- `npm run typecheck` → `tsc --noEmit`; `npm run build` → `tsc && vite build`.
- `npm run tauri dev` → desktop dev; `npm run tauri build` → platform bundles; `cargo check` (in `src-tauri/`) for the Rust side.
- `npm run verify` → typecheck + `npm test` + `npm run tauri build` (full pipeline: green tests plus runnable bundle for manual QA).
- iOS builds require macOS + Xcode + signing — do last, on a Mac; Android builds work on Windows.
