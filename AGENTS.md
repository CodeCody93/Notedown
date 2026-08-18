# AGENTS.md

## Repo state

- **M0 (Scaffold) done, M1+ unimplemented.** The single source of truth is `PLAN.md` (locked decisions, architecture, milestone order M0–M5) plus `docs/handoff.md` (verified state, environment facts, next steps, M2 research). Read both before any implementation.
- M0 = Vite+TS app (browser dev mode verified: `npm run dev`, typecheck, build all green) + Tauri v2 `src-tauri/` skeleton (NOT built — **Rust/VS Build Tools not installed on this machine**; install first, see handoff §2/§3) + empty chrome (`index.html`, `src/styles/*.css`, `src/main.ts` bootstrap, `src/app/state.ts` observable store, `src/app/settings.ts`, `src/platform/types.ts` FileIO contract, `src/platform/detect.ts`).
- No git repo initialized.

## Multi-agent workflow

- **Orchestrator (primary/default agent):** takes the user's request, asks clarifying questions via the `question` tool when needed, then splits it into independent work packets — separated by system (e.g. editor vs platform vs styles) and by implementation vs investigation. Spawn as many coder subagents in parallel as possible. **The orchestrator owns test execution**: after coders report back, it runs the tests itself.
- **Packet rule (critical):** packets must never overlap files. Assign disjoint file sets up front.
- **Coder (subagent):** implements exactly one packet. Write tests only when truly necessary (tests are slow — avoid by default). **Never run tests or builds** — other coder agents work in parallel in the same workspace; a build can interfere.
- Both agents are fully unrestricted (`permission: allow`, no prompts). Speed is the top priority: `subagent_depth: 1`, model `opencode-go/deepseek-v4-flash` at variant `max`.
- Orchestrator should act as the verifier: it owns test runs and cross-packet integration checks (e.g. platform/tauri.ts ↔ src-tauri Rust commands), since no single coder sees the whole picture.

## Stack & architecture (from PLAN.md)

- **Stack:** Vite + TypeScript frontend; **Tauri v2** (Rust) backend in `src-tauri/`. Editor = CodeMirror 6 + `codemirror-live-markdown`; renderer = markdown-it + plugins + highlight.js + DOMPurify.
- **Two runtime modes, one codebase:** browser dev mode (File System Access API, Chromium-only — a dev/test surface, **not** production) and Tauri (production: Windows/macOS/Linux/Android/iOS).
- **Package boundaries:** `src/app/` (state, menus, shortcuts, formatting, draft, export, preview), `src/editor/` (CM6 wiring, live preview), `src/platform/` (FileIO interface + `browser.ts` / `tauri.ts` / `detect.ts`), `src/styles/`. All file I/O goes through `platform/` — UI code never touches `window.showOpenFilePicker` or `invoke()` directly.
- **No UI framework, no state library.** Hand-rolled observable store in `src/app/state.ts`; data-driven menus in `src/app/menu.ts`.
- **Implement in milestone order (§20 of PLAN.md).** Locked decisions (§2) are not open to debate.

## Gotchas (would guess wrong otherwise)

- `codemirror-live-markdown` is new/alpha (single maintainer). Per PLAN.md it must be **pinned, forked into `src/editor/livePreview.ts`, and wrapped behind a thin interface** so the base can be swapped — not used as a direct dependency.
- **Security is non-negotiable:** markdown-it runs with `html:true`, so every render (preview + export) must pass through DOMPurify. Keep Tauri capabilities minimal (no broad `$HOME` fs scope); Rust commands do file I/O.
- **Android save bug:** `dialog.save()` on Android can write a 0-byte file (upstream issue #3356) — use `tauri-plugin-android-fs` or a ContentResolver copy workaround. This is a required manual QA test, not an optional nice-to-have.
- Browser-mode FS Access API is Chromium-only by design; document it as a dev/test surface, never as a production path.
- Hotkeys: `Ctrl` on Windows/Linux, `Cmd` on macOS. Menu/toolbar hotkey hints must come from the single `src/app/shortcuts.ts` map so they always match.

## Commands (planned, no code exists yet)

- `npm run dev` → browser dev mode (the test surface for Vitest unit + Playwright e2e).
- `npm run tauri dev` → desktop dev; `npm run tauri build` → platform bundles.
- Tests: Vitest unit (formatting/recent/draft/settings/shortcuts/markdown-it) + Playwright e2e in browser mode. No test scaffolding exists yet.
- iOS builds require macOS + Xcode + signing — do last, on a Mac; Android builds work on Windows.
