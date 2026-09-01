# Notedown — User Test Checklist (Round 5)

Focused regression + coverage for the 5th round. **Only items that were fixed in Round 4 (marked with notes in `docs/user-results.md`) and items that were never tested** are listed here. Everything else was already verified in Rounds 2–4 — no need to re-run the full suite.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. |
| Tauri desktop (dev) | `npm run tauri dev` | Requires Rust toolchain + VS Build Tools. |
| Tauri desktop (built) | `npm run tauri build` | Produces `Notedown_0.1.0_x64-setup.exe` / `.msi`. |

## Tester info

- Date: 8/24/2026
- Platform (Windows 11 / macOS / Linux / Android / iOS): Windows 11
- Build/version: 0.1.0 dev
- Mode tested (browser dev / Tauri dev / built installer): Built Installer
- Hotkey convention (Ctrl on Windows/Linux, Cmd on macOS): Ctrl

## Test conventions

- `Mod` = **Ctrl** on Windows/Linux, **Cmd** on macOS.
- Check `[ ]` after verifying Expected. Add a subtext `-#` below the item if anything deviates.
- b
- b
- b
- b

1. b
2. b
3. b

-[] b
-[] b
-[] b


---
  
## C. Export / Security (re-fixed K3, H)

Use `docs/security-test.md` + `docs/highlight-sample.md`.

- [ ] **K3 — SVG images rejected, PNG embedded.** Create `pic.svg` (from instructions in `security-test.md`) next to doc, and `pic.png` (any PNG). Reference both via `![svg](pic.svg)` and `![png](pic.png)` → Export HTML → open file → `pic.svg` must **not** be embedded (raw/empty, `expose_image` rejects `.svg`), `pic.png` **is** embedded as `data:image/png;base64,…` and visible offline. Verify View Source: no `data:image/svg`, but `data:image/png` exists.


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
