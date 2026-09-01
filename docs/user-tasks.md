# Notedown — User Test Checklist (Round 5)

Focused regression + coverage for the 5th round. **Only items that were fixed in Round 4 (marked with notes in `docs/user-results.md`) and items that were never tested** are listed here. Everything else was already verified in Rounds 2–4 — no need to re-run the full suite.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. |
| Tauri desktop (dev) | `npm run tauri dev` | Requires Rust toolchain + VS Build Tools. |
| Tauri desktop (built) | `npm run tauri build` | Produces `Notedown_0.1.0_x64-setup.exe` / `.msi`. |

## Tester info

- Date:
- Platform (Windows 11 / macOS / Linux / Android / iOS):
- Build/version:
- Mode tested (browser dev / Tauri dev / built installer):
- Hotkey convention (Ctrl on Windows/Linux, Cmd on macOS):

## Test conventions

- `Mod` = **Ctrl** on Windows/Linux, **Cmd** on macOS.
- Check `[ ]` after verifying Expected. Add a subtext `-#` below the item if anything deviates.

---

## A. Editor basics (re-fixed B5, B17, B19)

- [ ] **B5 — Task list continuation (all spellings).** Type each on its own line then press Enter:
  - `- [ ] item` → next line `- [ ] `
  - `-[] item` → next line `-[] `
  - `- [] item` → next line `- [] ` (previously fell back to unordered `- `)
  - `-[ ] item` → next line `-[ ] `
  - `1. item` → next line `2. `
  Empty item (`- [ ] ` with no text) + Enter removes marker. All must show checkbox in Live mode when caret elsewhere.

- [ ] **B17 — Subscript / superscript via `~` and `^` (hotkey change to `Mod+Alt+J`).** Type `~sub~` and `^sup^` on an inactive line (caret elsewhere): `~`/`^` hidden, text rendered as sub/sup (Live). Caret on the line: raw `~sub~`/`^sup^` visible. `Mod+Alt+J` wraps selection as `~text~` (was `Mod+Alt+Shift+S`), `Mod+Alt+U` as `^text^`, empty caret inside unwraps. Verify menu Extra → Subscript tooltip shows `Ctrl+Alt+J` (Win/Linux) / `Cmd+Alt+J` (mac). Legacy `<sub>x</sub>`/`<sup>x</sup>` still unwraps and still exports as `<sub>`/`<sup>`, but new docs should use `~`/`^`. Exported HTML contains `<sub>`/`<sup>`. Rendering must be immediate when caret leaves the line (previously required moving two lines away).

- [ ] **B19 — Find & replace panel (position — rebuilt).** `Mod+F` opens a **floating card at top-right** (desktop) / **full-width at top** (mobile), themed, not clipped. Now uses built-in `search({top:true})` so panel lives in `.cm-panels-top` and is styled as a floating card (8px from top, 8px from right, max-width 420px). Typing highlights matches, Enter jumps. `Mod+Shift+F` and `Mod+H` both open **replace** panel (replace field focused, no footnote insertion). `Escape` closes panel. Test at narrow width (<600px): panel should stretch full width at top (left 8px, right 8px). 1 line for find, 2 lines for replace (replace row breaks via `<br>`).

## B. Formatting (re-fixed E19/E20 — hotkey)

All must be single undo steps (`Mod+Z` undoes the whole action).

- [ ] **E19/E20 — Sub/Sup/Highlight empty unwrap (hotkey updated).** `~|~` (`~~` with caret between `~` `~`) → `Mod+Alt+J` removes `~~`; `^|^` (`^^`) → `Mod+Alt+U` removes; `==|==` (`====`) → `Mod+Alt+M` removes. Non-empty `~sub~` / `^sup^` / `==hi==` with caret inside → same hotkey unwraps to plain text. Must be single undo. Verify `Mod+Alt+J` is responsive (previously `Mod+Alt+Shift+S` collided and was unresponsive).

## C. Export / Security (re-fixed K3, H)

Use `docs/security-test.md` + `docs/highlight-sample.md`.

- [ ] **K3 — SVG images rejected, PNG embedded.** Create `pic.svg` (from instructions in `security-test.md`) next to doc, and `pic.png` (any PNG). Reference both via `![svg](pic.svg)` and `![png](pic.png)` → Export HTML → open file → `pic.svg` must **not** be embedded (raw/empty, `expose_image` rejects `.svg`), `pic.png` **is** embedded as `data:image/png;base64,…` and visible offline. Verify View Source: no `data:image/svg`, but `data:image/png` exists.

- [ ] **H — Highlight.js all languages in Live mode.** Open `docs/highlight-sample.md` (covers markdown, javascript, typescript, python, bash, json, yaml, html, css, rust, sql, plaintext, plus unknown `foobar` fallback). In **Live mode**, each fence should be syntax-colored (not plain grey) via new `MarkdownCodeWidget` with hljs — highlight shown when caret is elsewhere, raw source when caret inside the fence. Export HTML and verify same in browser (both light/dark via `prefers-color-scheme`). `foobar` should fallback without error. Previously Live/Source showed plain grey; export was already correct.

## D. File operations (still untested / deferred)

- [ ] **C6 — CRLF + BOM round-trip (use `docs/bom-crlf.md`).** That file contains UTF-8 BOM (`EF BB BF`) + CRLF `hello\r\nworld\r\n` (verify via `Format-Hex`). Open it in Notedown, type a new line, Save, reopen in VS Code/Notepad. Expected: content reads correctly, BOM is stripped on open and **not re-added** on save (file still valid UTF-8, now without BOM, `Format-Hex` shows no leading `EF BB BF`), line endings not corrupted (hello/world intact).

- [ ] **C8 — Close guard actually closes (deferred to specialist).** Dirty doc → click X / `Alt+F4` → confirm “Discard…?” → **Yes** must **exit the process** (window closes, Task Manager/dev terminal shows exit). **No** keeps doc intact. Clean doc → X closes immediately with **no prompt**, process exits. *Note: `desktop.json` now grants `core:window:allow-set-title`/`allow-close`/`allow-destroy`/`allow-on-close-requested` and `detect.ts` uses `isTauri()` at call-time; full lifecycle still requires manual QA on built installer.*

## E. Platform / Mobile (still untested, if hardware available)

- [ ] **M2 — macOS (if available).** Re-run suite with **Cmd** shortcuts (`Cmd+Shift+Z` redo, `Cmd+Y` must NOT redo). Window close button shows discard confirm (C8). Verify Subscript hotkey is `Cmd+Alt+J`.

- [ ] **M3 — Browser dev mode gaps (expected, not bugs).** Verify: paste-image does nothing (console warning), local image rendering falls back to raw markdown, Open Recent requires re-granting file permission after reload.

- [ ] **N1 — Android save bug (REQUIRED before mobile release).** On Android device, Save / Save As via `dialog.save()` must write **non-empty** file matching doc content (no 0-byte file). `content://` URIs must error gracefully, never hang.

- [ ] **N2 — Paste image on mobile is graceful no-op** (nothing inserted, no crash).

---

## Notes

- Browser dev mode is Chromium-only, not production.
- Preview mode was removed; only Live/Source exist.
- Task checkboxes toggled by clicking `☐/☑` in Live mode; all four spellings (`-[]`, `- []`, `-[ ]`, `- [ ]`) now render and continue correctly.
- Find panel is `.cm-search` in `.cm-panels-top`, floating card at top-right (desktop) / full-width top (mobile); `Mod+Shift+F` and `Mod+H` both open replace (no footnote insertion).
- Subscript hotkey is now `Ctrl+Alt+J` on Win/Linux (`Cmd+Alt+J` on mac) — was `Ctrl+Alt+Shift+S` which was unresponsive/collided with Snipping Tool. Menu Extra → Subscript tooltip shows new chord.
- Images preserve aspect ratio (`width:100%; height:auto; object-fit:contain`); live code blocks are now highlighted via hljs when caret is outside.
- Export inlines local `png/jpg/gif/webp/bmp` as `data:` URLs via `expose_image` (async in `renderStandaloneHtmlWithImages`); `svg` is rejected (empty) per Rust `io::expose_image`.
- `docs/bom-crlf.md` is the verified BOM+CRLF fixture; `docs/highlight-sample.md` and `docs/security-test.md` are the verification docs for export/security/highlight.
