# MarkItDown — User Test Checklist

Manual QA checklist for human testers. Run through every section on each release candidate and record the outcome (Pass / Fail / Notes). Automated unit tests (`npm test`) cover the pure logic; this list covers what only a human can verify: dialogs, native file I/O, rendering, and cross-platform behavior.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open the printed URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. |
| Tauri desktop (dev) | `npm run tauri dev` | Requires Rust toolchain + VS Build Tools (see handoff). |
| Tauri desktop (built) | `npm run tauri build` | Produces `MarkItDown_0.1.0_x64-setup.exe` (NSIS) / `.msi` on Windows. |

## Tester info (fill in)

- Date: 
- Platform (Windows 11 / macOS / Linux / Android / iOS): 
- Build/version: 
- Mode tested (browser dev / Tauri dev / built installer): 
- Hotkey convention used (Ctrl on Windows/Linux, Cmd on macOS): `Ctrl`/`Cmd`

## Test conventions

- `Mod` in this document means **Ctrl on Windows/Linux, Cmd on macOS**.
- Every test: perform the steps, compare against "Expected", then mark the checkbox `[ ]` and add a note if anything deviates. Deviations are bugs — report them with steps to reproduce buy putting a subtext right below the step.
- The app data directory (settings/recents/drafts) on Windows is `%APPDATA%\com.markitdown.app`, on macOS `~/Library/Application Support/com.markitdown.app`.

---

## A. First launch

- [ ] **A1 — Fresh start.** With no previous app data (delete the app data dir if needed), start the app. Expected: empty `untitled.md` document, editor focused, placeholder text "Start typing your markdown here" visible, status bar shows `untitled.md · Live · Ln 1 · Col 1 · 0 words · 0 chars`, no dirty dot.
- [ ] **A2 — Menubar renders.** File menu, toolbar (Undo/Redo/Copy/Cut/Paste, Bold/Italic/Underline/Strikethrough, Header, List), and the Extra (⋯) dropdown are visible. Hotkey hints shown on menu items match the real shortcuts in this document (they come from the same map, so they always should).
- [ ] **A3 — Window title.** Title reads `untitled.md — MarkItDown` (adds `• ` prefix when the doc is dirty).

## B. Editor basics

- [ ] **B1 — Typing + status.** Type a few words. Expected: words/chars counters update live, Ln/Col follow the caret.
- [ ] **B2 — Placeholder disappears** once you start typing and returns after deleting everything.
- [ ] **B3 — Undo/redo.** Type, then `Mod+Z` then `Mod+Shift+Z` (Windows/Linux also `Mod+Y`). Toolbar Undo/Redo buttons do the same. Each formatting action below must undo/redo as a single step.
- [ ] **B4 — Copy/cut/paste buttons.** Select text → Copy → paste elsewhere; Cut removes and copies; Paste inserts clipboard text at the caret. (Buttons must work even when the editor is not focused.)
- [ ] **B5 — List continuation.** Type `- item` and press Enter. Expected: new line starts with `- `. Press Enter on an empty item: the marker is removed (second Enter exits the list). Same for ordered lists (`1. item` → `2. `) and task lists (`- [ ] item` → `- [ ] `).
- [ ] **B6 — Live vs source mode.** Status-bar mode label toggles between "Live" and "Source" when clicked; `Mod+/` does the same. In Live mode formatting marks (`**`, `#`, `- `, `> `) are hidden and rendered as rich text; in Source mode all marks are visible as raw text.
- [ ] **B7 — Live-mode reveal.** In Live mode, put the caret anywhere inside `**bold text**` (also with an active selection). Expected: the `**` markers reappear faded while the caret is inside the formatting region, and hide again when the caret leaves it. Same for `*italic*`, `~~strike~~`, `` `code` ``, headings, lists, and blockquotes on the caret's line.
- [ ] **B8 — List markers in Live mode.** With the caret on another line, a line containing `- item` shows a `•` bullet; `1. item` shows `1.`; `- [ ] task` shows `☐` and `- [ ] task` shows `☑` (in Source mode the raw markers return).
- [ ] **B9 — Images in Live mode.** With a saved document containing `![alt](img.png)` where `img.png` sits next to the document: the image renders inline in Live mode (Tauri only). In browser dev mode or with an unsaved doc it falls back to raw markdown text.
- [ ] **B10 — Fenced code + images are not collapsed.** Inside a ``` fence the text stays raw; an image's alt text does not get emphasis decoration.

## C. File operations

- [ ] **C1 — New.** `Mod+N` or File → New with a clean doc: nothing happens beyond a fresh untitled doc. With unsaved changes: a Yes/No confirm "Discard unsaved changes to <name>?" appears; **No** keeps the document and stops the action, **Yes** starts a new empty `untitled.md`.
- [ ] **C2 — Open.** `Mod+O` or File → Open: native file dialog with Markdown (`md`, `markdown`) and All files filters. Open a `.md` file → content loads, status bar shows the filename, dirty dot absent. Cancel → nothing changes.
- [ ] **C3 — Open with unsaved changes** shows the discard confirm (see C1).
- [ ] **C4 — Save.** `Mod+S` or File → Save: untitled doc → Save As dialog appears. Named doc → saves silently, dirty dot clears, title `•` disappears.
- [ ] **C5 — Save As.** `Mod+Shift+S`: picker always appears; the saved file becomes the current document (status bar shows the new name).
- [ ] **C6 — CRLF + BOM handling.** Create a file with CRLF line endings and a UTF-8 BOM, open it, type, save. Expected: content round-trips correctly (line endings preserved as-is). Note: a BOM present on open is stripped and not re-added on save — verify the file still reads correctly in another editor.
- [ ] **C7 — Dirty state via undo.** Type, save, then type more (dirty dot on) and press `Mod+Z` back to the saved content. Expected: dirty dot clears (document is "clean" again).
- [ ] **C8 — Close guard.** Make the doc dirty and close the window (Tauri). Expected: confirm dialog appears; **No** keeps the app open with the document intact; **Yes** closes.
- [ ] **C9 — Open failure.** Try File → Open Recent on an entry whose file was deleted (see M-section) or, in browser dev mode, revoke permission. Expected: an error alert, and the entry is removed from the recent list.

## D. Recents

- [ ] **D1 — Recents list.** Open several files (up to 10). File → Open Recent (`Mod+Shift+O`) lists them newest-first with name + full path, deduplicated (re-opening the same file moves it to the top, no duplicate).
- [ ] **D2 — Open recent.** Click an entry → file opens without a picker. Persists across restarts.
- [ ] **D3 — Missing file.** Delete a file on disk, then open File → Open Recent: its entry is disabled (greyed). Clicking it → error alert and the entry is removed.
- [ ] **D4 — Clear recent.** Open Recent → Clear recent empties the list (shows "No recent files" afterwards) and persists across restarts.

## E. Formatting (toolbar + hotkeys)

For each command: test with (a) empty caret, (b) a text selection, (c) a selection already formatted (toggle off). All must be single undo steps.

- [ ] **E1 — Bold** `Mod+B`: `**text**` / caret between `****`. Unwraps when inside `**…**`.
- [ ] **E2 — Italic** `Mod+I`: `*text*` / `**` with caret between. Unwraps when inside `*…*`.
- [ ] **E3 — Underline** `Mod+U`: `<u>text</u>`.
- [ ] **E4 — Strikethrough** `Mod+Shift+X`: `~~text~~`. Unwraps when inside `~~…~~`.
- [ ] **E5 — Headings.** Header dropdown (H button) with Paragraph/H1–H6; hotkeys `Mod+0`…`Mod+6`; `Mod+Alt+H` cycles paragraph → H1 → … → H6 → paragraph. Multi-line selection applies to every selected line.
- [ ] **E6 — Lists.** List dropdown: Unordered/Ordered/Task. Multi-line selection: markers added to every unmarked line (ordered gets sequential 1., 2., …); if every line already has the marker, all markers are removed. `Mod+Shift+L` = unordered.
- [ ] **E7 — Task list.** List → Task or Extra → Task list: `- [ ] ` on each line; toggles off when all lines already have it.
- [ ] **E8 — Blockquote** `Mod+Shift+B`: prefixes `> ` per line; toggles off when all selected lines are quoted.
- [ ] **E9 — Inline code** `Mod+E`: backticks around selection; double backticks when the selection contains a backtick; unwraps existing; empty caret inserts ` `` ` with caret between.
- [ ] **E10 — Code block** `Mod+Shift+K`: wraps selection in a fence; empty caret inserts a two-line fence template with the caret on the middle line; toggles off when the selection already spans a fenced block.
- [ ] **E11 — Link** `Mod+K`: with selection → `[selected](url)` with `url` selected; empty → `[text](url)` with `text` selected.
- [ ] **E12 — Image** `Mod+Shift+I`: `![selected](image.png)`; empty → `![alt](image.png)` with `alt` selected.
- [ ] **E13 — Table** (Extra → Table): inserts a 3×3 GFM table template on its own block; caret lands in the first body cell.
- [ ] **E14 — Horizontal rule** (Extra → Horizontal rule): inserts `---` with blank lines before/after as needed.
- [ ] **E15 — Footnote** (Extra → Footnote): inserts `[^N]` at the caret (N increments beyond existing markers) and appends `[^N]: ` at the end of the document.
- [ ] **E16 — Heading ID** (Extra → Heading ID): on a heading line appends ` {#custom-id}` (replaces an existing `{#…}`); does nothing on a non-heading line.
- [ ] **E17 — Definition list** (Extra → Definition list): inserts `Term\n: Definition` with `Term` selected.
- [ ] **E18 — Subscript** (Extra): `<sub>text</sub>`; **E19 — Superscript**: `<sup>text</sup>`; **E20 — Highlight**: `==text==`.
- [ ] **E21 — Emoji picker** (Extra → Emoji picker): popover opens near the button; typing in the search box filters by name (e.g. "heart"); clicking an emoji inserts it at the caret; Escape or click-outside closes it. Only one picker can be open at a time.

## F. View / preview mode

- [ ] **F1 — Toggle preview.** Eye icon in the status bar, status-mode click, or `Mod+Shift+P`. Edit pane hidden, preview pane shown; toggling back restores the editor (cursor position kept).
- [ ] **F2 — Live re-render.** While in preview, keep typing in the editor? (Editor is hidden in preview — instead switch back and forth.) Edit → toggle preview: content re-renders, "Rendering…" stale indicator flashes briefly while a re-render is pending on rapid changes.
- [ ] **F3 — Rendering correctness.** Create a doc exercising every plugin: headings, bold/italic/strikethrough/underline, `==highlight==`, sub/sup, blockquote, unordered/ordered/task lists, inline code, fenced code blocks with `js`, `ts`, `python`, `bash`, `json`, `yaml`, `html`, `css`, `rust`, `sql` languages (syntax-colored), tables, `---`, footnotes (`[^1]` → `[^1]: text` renders a footnote section with backref), definition lists, `:emoji:` shortcodes, `{#custom-id}` heading anchors, task list checkboxes. Preview must match the exported HTML visually.
- [ ] **F4 — Links.** Click a link in the preview. Expected: opens in the default browser (Tauri) / new tab (browser dev mode), never inside the app. `#anchor` links do nothing (no error). Relative links resolve against the document's directory.
- [ ] **F5 — Images.** A saved doc with `![alt](pic.png)` renders the picture in preview (Tauri). Unsaved docs and browser dev mode leave the src as-is (broken image). `.svg` images are rejected and do not render.
- [ ] **F6 — Theme sync.** Switch light/dark theme while preview is open: preview restyles immediately (code blocks included).

## G. Export HTML

- [ ] **G1 — Export.** `Mod+Shift+E` or File → Export HTML…: Save dialog pre-fills `<docname>.html` with HTML filters. Open the saved file in a browser: fully styled standalone page (same typography + hljs colors as preview), correct `<title>`, scrollable.
- [ ] **G2 — Export theme.** Export in dark theme → dark tokens; light theme → light tokens.
- [ ] **G3 — Export safety.** A doc containing `<script>alert(1)</script>` or `<img onerror="…">`: the exported file contains no executable script (check the file and open it — no alert). The export has a strict CSP meta tag (`default-src 'none'`).
- [ ] **G4 — Export cancel.** Cancel the dialog → no error, doc unchanged.

## H. Settings

Open with File → Settings or `Mod+,`. Every control applies immediately and persists across restart. Escape, backdrop click, or × closes; focus returns to the previously focused element; Tab/Shift+Tab wrap inside the dialog.

- [ ] **H1 — Theme.** Light / Dark / System. System follows the OS setting live (change OS theme while running).
- [ ] **H2 — Font size** (10–32 px) and **H3 — Line height** (1.0–2.5) restyle the editor live; values clamp to range.
- [ ] **H4 — Line wrapping.** Off → long lines scroll horizontally; On → wrap.
- [ ] **H5 — Autosave drafts.** Toggle off/on — see section I.
- [ ] **H6 — Extra menu always visible.** On → the Extra (⋯) items render as a permanent second toolbar row (no dropdown); Off → back to dropdown.
- [ ] **H7 — Default editing mode.** Live vs Source — the mode applied on the next launch.
- [ ] **H8 — Persistence.** Change several settings, restart the app: all kept. (Tauri: `settings.json` in the app data dir; browser: localStorage.)

## I. Drafts & recovery (autosave)

- [ ] **I1 — Draft autosave.** With "Autosave drafts" ON: edit an **unsaved** doc and wait ~3 seconds after stopping typing, then close the app (or browser tab). Relaunch. Expected: confirm dialog "Recover unsaved changes to untitled.md?" → Yes restores your text (dirty).
- [ ] **I2 — Draft for saved files.** Same flow with a previously saved file: edits made after the last save are offered for recovery.
- [ ] **I3 — No prompt when clean.** Close with no changes → no recovery prompt.
- [ ] **I4 — Decline recovery.** Answer No → prompt never appears again for that content; document opens from disk.
- [ ] **I5 — Draft cleared on save.** Recover a draft, then save: the draft is gone (restart → no prompt).
- [ ] **I6 — Draft cleared on undo-to-clean.** Type after saving (dirty), then `Mod+Z` back to saved content, wait 3s, restart → no recovery prompt.
- [ ] **I7 — Autosave off.** With the setting OFF, kill the app mid-edit → restart → no recovery prompt (content lost).

## J. Paste image (Tauri desktop only)

- [ ] **J1 — Paste image into a saved doc.** Copy an image (screenshot) and paste (`Mod+V`) into a saved document. Expected: an image file `docname-<timestamp>.png` (or `.jpg`) is written next to the document and `![docname](docname-<timestamp>.png)` is inserted at the caret. Undo removes the reference (the file on disk stays).
- [ ] **J2 — Paste image into an unsaved doc.** Folder picker appears; picking a folder saves the image there and inserts the reference; cancelling inserts nothing.
- [ ] **J3 — Browser dev mode.** Paste an image: nothing inserted (console warning) — expected, dev surface limitation.
- [ ] **J4 — No image on clipboard** → paste behaves as normal text paste.

## K. Security (regression surface — always test)

- [ ] **K1 — XSS sanitized in preview.** Doc contains `<script>alert('x')</script>`, `<img src=x onerror=alert(1)>`, `<iframe>`, `<svg onload=…>`: preview shows nothing scriptable — no alert, no iframe/svg. Raw safe HTML (e.g. `<u>`, `<sub>`, `<kbd>`) still renders.
- [ ] **K2 — Link schemes.** A doc containing `[click](javascript:alert(1))`: clicking in preview does nothing (blocked, console warning). `data:`/`vbscript:` links likewise blocked. `https://…`, `mailto:…` open normally.
- [ ] **K3 — SVG images rejected.** `![svg](pic.svg)` never renders as an image in preview (expose_image refuses SVG).

## L. Window & responsive behavior

- [ ] **L1 — Focus.** Click outside the app window and back: the editor regains focus (edit view, settings closed).
- [ ] **L2 — Narrow window.** Resize below ~600 px: settings dialog becomes a bottom sheet; toolbar/menus still usable. Window minimum is 360×400.
- [ ] **L3 — Multiple dropdowns.** Only one dropdown/emoji picker open at a time; Escape closes any open dropdown/picker; alt-tabbing away closes them.

## M. Platform-specific

- [ ] **M1 — Windows built installer.** Run the NSIS installer, launch the installed app: full test pass on the installed binary (not just dev mode). Uninstaller removes it.
- [ ] **M2 — macOS (if available).** Re-run the suite with Cmd shortcuts (Cmd+Shift+Z redo; `Mod+Y` must NOT fire redo on mac). Window close button shows the discard confirm.
- [ ] **M3 — Browser dev mode gaps** (expected, not bugs): no paste-image, no local image rendering in preview/live view, Open Recent requires re-granting file permissions.

## N. Mobile (Android/iOS — M5, deferred)

- [ ] **N1 — Android save bug (REQUIRED before mobile release).** Upstream issue #3356: `dialog.save()` can write a 0-byte file on Android. Manually verify Save / Save As on a device: the file on disk is non-empty and matches the document. The `content://` URI flow (open/save via mobile_fs) is not implemented yet — those paths must error gracefully, never hang.
- [ ] **N2 — Paste image on mobile** is a graceful no-op (nothing inserted, no crash).

---

## Known limitations / notes

- Browser dev mode (`npm run dev`) is a **Chromium-only dev/test surface** — never a production path (no real paths, no local images, no paste-image).
- Save does not re-add a UTF-8 BOM that was stripped on open.
- Preview task-list checkboxes are read-only (disabled) — checking them off is editing the markdown, not clicking in preview.
- `{ #anchor}` heading IDs render in preview/export but in-page anchor jumps in preview are no-ops (links open externally only).
- Code-block languages supported: markdown, javascript, typescript, python, bash, json, yaml, html, css, rust, sql, plaintext (others fall back to uncolored code).
