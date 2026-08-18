# AGENTS.md

## Repo state

- **This file is the single source of truth** for conventions and locked decisions. Milestones M0–M3 are implemented (editor, live preview, menus, platform I/O) plus the post-feedback fix batch — see `docs/user-results.md` for what was fixed and `docs/user-tests.md` for the manual QA checklist.
- Stack: Vite + TS frontend, Tauri v2 `src-tauri/` backend. Verified green: `npm run dev`, `npm run typecheck`, `npm run build`, `npm test` (269 Vitest tests). Rust toolchain 1.97.1 (rustup, MSVC) is installed; `cargo check` in `src-tauri/` is clean.
- Git: initialized on `main` with save-point commits (M0–M3 batch, feedback-fix batch, round-2 test checklist).

## Multi-agent workflow

- **Orchestrator (primary/default agent):** takes the user's request, asks clarifying questions via the `question` tool when needed, then splits it into independent work packets — separated by system (e.g. editor vs platform vs styles) and by implementation vs investigation. Spawn as many coder subagents in parallel as possible. **The orchestrator owns test execution**: after coders report back, it runs the tests itself.
- **Packet rule (critical):** packets must never overlap files. Assign disjoint file sets up front.
- **Coder (subagent):** implements exactly one packet. Write tests only when truly necessary (tests are slow — avoid by default). **Never run tests or builds** — other coder agents work in parallel in the same workspace; a build can interfere.
- Both agents are fully unrestricted (`permission: allow`, no prompts). Speed is the top priority: `subagent_depth: 1`, model `opencode-go/deepseek-v4-flash` at variant `max`.
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

## Commands

- `npm run dev` → browser dev mode (the Vitest/Playwright test surface).
- `npm test` → Vitest unit tests (formatting/recent/draft/settings/shortcuts/markdown-it/editor) — 269 passing.
- `npm run typecheck` → `tsc --noEmit`; `npm run build` → `tsc && vite build`.
- `npm run tauri dev` → desktop dev; `npm run tauri build` → platform bundles; `cargo check` (in `src-tauri/`) for the Rust side.
- iOS builds require macOS + Xcode + signing — do last, on a Mac; Android builds work on Windows.
