# MarkItDown — User Test Checklist (Round 2)

Manual QA checklist for human testers — **post-feedback regression suite**. Every round-1 failure (see `docs/user-results.md` → "Changes from feedback round") plus every item that was never tested is covered here. Run through every section on each release candidate and record the outcome (Pass / Fail / Notes). Automated unit tests (`npm test`) cover the pure logic; this list covers what only a human can verify: dialogs, native file I/O, rendering, and cross-platform behavior.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open the printed URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. |
| Tauri desktop (dev) | `npm run tauri dev` | Requires Rust toolchain + VS Build Tools. |
| Tauri desktop (built) | `npm run tauri build` | Produces `MarkItDown_0.1.0_x64-setup.exe` (NSIS) / `.msi` on Windows. |

## Tester info (fill in)

- Date:
- Platform (Windows 11 / macOS / Linux / Android / iOS):
- Build/version:
- Mode tested (browser dev / Tauri dev / built installer):
- Hotkey convention used (Ctrl on Windows/Linux, Cmd on macOS): `Ctrl`/`Cmd`

## Test conventions

- `Mod` in this document means **Ctrl on Windows/Linux, Cmd on macOS**.
- Every test: perform the steps, compare against "Expected", then mark the checkbox `[ ]` and add a note if anything deviates. Deviations are bugs — report them with steps to reproduce in a subtext right below the step.
- The app data directory (settings/recents/drafts) on Windows is `%APPDATA%\com.markitdown.app`, on macOS `~/Library/Application Support/com.markitdown.app`.

---

## A. First launch

- [ ] **A1 — Fresh start.** With no previous app data (delete the app data dir if needed), start the app. Expected: empty `untitled.md` document, editor focused, placeholder text "Start typing your markdown here" visible, status bar shows `untitled.md · Live · Ln 1 · Col 1 · 0 words · 0 chars`, no dirty dot.
- [ ] **A2 — Menubar + hotkey hints.** File menu, toolbar (Undo/Redo/Copy/Cut/Paste, Bold/Italic/Underline/Strikethrough, Header, List), and the Extra (⋯) dropdown are visible. **Every Extra item now shows a hotkey hint** (regression A2) and every hint matches this document: Table `Mod-Alt-T`, Horizontal rule `Mod-Shift-H`, Footnote `Mod-Shift-F`, Task list `Mod-Alt-L`, Emoji picker `Mod-Alt-E`, Heading ID `Mod-Shift-2`, Definition list `Mod-Alt-D`, Subscript `Mod-Alt-S`, Superscript `Mod-Alt-U`, Highlight `Mod-Alt-M`. List dropdown: Unordered `Mod-Shift-L`, Ordered `Mod-Alt-O`, Task `Mod-Alt-L`. Toolbar/Format menu: Image `Mod-Alt-I`.
- [ ] **A3 — Window title (Tauri).** Title reads `untitled.md — MarkItDown`; a `• ` prefix appears when the doc is dirty and clears when saved. After Open / Save As / New the title follows the document name (regression A3: title previously never changed).

## B. Editor basics

- [ ] **B1 — Typing + status.** Type a few words. Expected: words/chars counters update live, Ln/Col follow the caret.
- [ ] **B2 — Placeholder disappears** once you start typing and returns after deleting everything.
- [ ] **B3 — Undo/redo.** Type, then `Mod+Z` then `Mod+Shift+Z` (Windows/Linux also `Mod+Y`). Toolbar Undo/Redo buttons do the same. Each formatting action below must undo/redo as a single step.
- [ ] **B4 — Copy/cut/paste buttons.** Select text → Copy → paste elsewhere; Cut removes and copies; Paste inserts clipboard text at the caret. (Buttons must work even when the editor is not focused.)
- [ ] **B5 — List continuation.** Type `- item` and press Enter: new line starts with `- `. Ordered: `1. item` → `2. `. Task lists keep their exact marker form: `- [ ] item` → `- [ ] `, `-[] item` → `-[] ` (regression Other #4). Press Enter on an empty item: the marker is removed (second Enter exits the list).
- [ ] **B6 — Live vs source mode.** Status-bar mode label toggles between "Live" and "Source" when clicked; `Mod+/` does the same. In Live mode formatting marks (`**`, `#`, `- `, `> `) are hidden and rendered as rich text; in Source mode all marks are visible as raw text.
- [ ] **B7 — Live-mode reveal.** In Live mode, put the caret anywhere inside `**bold text**` (also with an active selection). Expected: the `**` markers reappear faded while the caret is inside the formatting region, and hide again when the caret leaves it. Same for `*italic*`, `~~strike~~`, `` `code` ``, headings, lists, and blockquotes on the caret's line.
- [ ] **B8 — List markers in Live mode.** With the caret on another line: `- item` shows a `•` bullet; `1. item` shows `1.`; task lines show `☐` for **all four spellings** `- [ ]`, `-[]`, `- [ ]`, `-[ ]` and `☑` when checked (`[x]`/`[X]`) (regression Other #4). In Source mode the raw markers return.
- [ ] **B9 — Clickable task checkbox (regression Other #7).** In Live mode with the caret on another line, click the `☐` of a task item. Expected: the bracket toggles in the document (`[ ]` → `[x]`, `☐` → `☑`), the caret does NOT move into that line, and `Mod+Z` undoes the toggle. Clicking `☑` un-checks it.
- [ ] **B10 — Images in Live mode.** With a saved document containing `![alt](img.png)` where `img.png` sits next to the document: the image renders inline in Live mode (Tauri only). In browser dev mode or with an unsaved doc it falls back to raw markdown text.
- [ ] **B11 — Fenced code + images are not collapsed.** Inside a ``` fence the text stays raw; an image's alt text does not get emphasis decoration.
- [ ] **B12 — Blockquote live rendering (regression E8).** `> quote` with the caret on another line: the line renders with quote styling (the `>` is not raw text). Caret on the quote line: raw `> ` visible and editable.
- [ ] **B13 — Table live rendering (regression E13).** A GFM table with the caret on another line: renders as a styled grid. Click inside the rendered table: the raw markdown source reappears with the caret placed inside. Caret inside the table: raw source is shown for editing.
- [ ] **B14 — Horizontal rule live rendering (regression E14).** A lone `---` with the caret elsewhere: renders as a horizontal divider. Caret on the line: raw `---` shown.
- [ ] **B15 — Heading IDs hidden (regression E16).** `## Head {#custom-id}` with the caret on another line: `{#custom-id}` is invisible. Caret on the heading line: visible and editable.
- [ ] **B16 — Underline live rendering (regression E3).** `__und__` with the caret elsewhere: text renders **underlined, not bold**, marks hidden. Caret on the line: raw `__und__`.
- [ ] **B17 — Highlight + sub/sup live rendering (regressions E18/E19/E20).** `==hi==` with the caret elsewhere renders highlighted with `==` hidden; `<sub>x</sub>` renders as subscript with tags hidden; `<sup>y</sup>` as superscript. Caret on the line: raw text.
- [ ] **B18 — Subtext `-#` (new, Other #5).** A line `-# note` with the caret elsewhere: renders muted/italic without the `-# ` prefix. Caret on the line: raw `-# note`. In exported HTML the paragraph is muted-styled (see G5).
- [ ] **B19 — Find & replace (new, Other #8).** `Mod+F` opens the search panel overlaid on the editor; typing highlights matches; Enter jumps to the next match; `Mod+Shift+F` opens the replace panel and replaces (or replaces-all); Escape closes. `Mod+H` opens replace directly. Panel styling matches the theme. No app shortcut conflicts.
- [ ] **B20 — Emoji hotkey (new).** `Mod+Alt+E` opens the emoji picker without touching the toolbar; picking an emoji inserts it at the caret and returns focus to the editor.

## C. File operations

- [ ] **C1 — New + undo history reset (regression C1).** `Mod+N` or File → New with a clean doc: nothing happens beyond a fresh untitled doc. With unsaved changes: a Yes/No confirm "Discard unsaved changes to <name>?" appears; **No** keeps the document, **Yes** starts a new empty `untitled.md`. **Immediately after New, press `Mod+Z`: nothing happens** (the previous document must NOT come back).
- [ ] **C2 — Open.** `Mod+O` or File → Open: native file dialog with Markdown (`md`, `markdown`) and All files filters. Open a `.md` file → content loads, status bar shows the filename, dirty dot absent. Cancel → nothing changes.
- [ ] **C3 — Open with unsaved changes** shows the discard confirm (see C1).
- [ ] **C4 — Save.** `Mod+S` or File → Save: untitled doc → Save As dialog appears. Named doc → saves silently, dirty dot clears, title `•` disappears (Tauri).
- [ ] **C5 — Save As.** `Mod+Shift+S`: picker always appears; the saved file becomes the current document (status bar shows the new name).
- [ ] **C6 — CRLF + BOM handling (first real test).** Create a file with CRLF line endings and a UTF-8 BOM, open it, type, save. Expected: content round-trips correctly (line endings preserved as-is). Note: a BOM present on open is stripped and not re-added on save — verify the file still reads correctly in another editor.
- [ ] **C7 — Dirty state via undo.** Type, save, then type more (dirty dot on) and press `Mod+Z` back to the saved content. Expected: dirty dot clears (document is "clean" again).
- [ ] **C8 — Close guard (regression C8, Tauri).** Make the doc dirty and close the window (X button or `Alt+F4`). Expected: confirm dialog appears; **No** keeps the app open with the document intact; **Yes** closes — the process must actually exit (check Task Manager / the dev terminal returns). With a clean doc, closing must exit immediately with **no** prompt.
- [ ] **C9 — Open failure (regression C9).** File → Open Recent on a deleted file (see D3), or in browser dev mode revoke permission. Expected: a **native** error alert (Tauri: OS-styled dialog titled MarkItDown; browser: `window.alert`), a friendly message, and the entry is removed from the recent list.

## D. Recents

- [ ] **D1 — Recents list.** Open several files (up to 10). File → Open Recent (`Mod+Shift+O`) lists them newest-first with name + full path, deduplicated (re-opening the same file moves it to the top, no duplicate).
- [ ] **D2 — Open recent.** Click an entry → file opens without a picker. Persists across restarts.
- [ ] **D3 — Missing file (regression D3).** Delete a file on disk, then open File → Open Recent: its entry is greyed/italic but **still clickable**. Clicking it → native error alert and the entry is removed. (Before the fix it was disabled and un-removable.)
- [ ] **D4 — Clear recent.** Open Recent → Clear recent empties the list (shows "No recent files" afterwards) and persists across restarts.

## E. Formatting (toolbar + hotkeys)

For each command: test with (a) empty caret, (b) a text selection, (c) a selection already formatted (toggle off). All must be single undo steps.

- [ ] **E1 — Bold** `Mod+B`: `**text**` / caret between `****`. **Unwraps with an empty caret anywhere inside `**…**`** (regression E1/E4). Must NOT touch `__…__` (that is underline's territory).
- [ ] **E2 — Italic** `Mod+I`: `*text*` / `**` with caret between. **Unwraps with an empty caret inside** (regression E1/E4).
- [ ] **E3 — Underline** `Mod+U`: writes `__text__` — **no more `<u>` tags in the source** (regression E3). **Unwraps with an empty caret inside `__…__`**; must NOT touch `**…**`.
- [ ] **E4 — Strikethrough** `Mod+Shift+X`: `~~text~~`. Unwraps with an empty caret inside.
- [ ] **E5 — Headings.** Header dropdown (H button) with Paragraph/H1–H6; hotkeys `Mod+0`…`Mod+6`; `Mod+Alt+H` cycles paragraph → H1 → … → H6 → paragraph. Multi-line selection applies to every selected line.
- [ ] **E6 — Lists.** List dropdown: Unordered/Ordered/Task. Multi-line selection: markers added to every unmarked line (ordered gets sequential 1., 2., …); if every line already has the marker, all markers are removed. Hotkeys: unordered `Mod+Shift+L` (regression E6: ordered `Mod+Alt+O`, task `Mod+Alt+L`).
- [ ] **E7 — Unordered toggle on a task line (regression E7).** On a line `- [ ] task`, apply Unordered. Expected: the **entire** marker including the checkbox is removed → `task` (before the fix it left `[ ]` behind). Same for `-[] `, `-[ ] `, `- [ ] `.
- [ ] **E8 — Task list.** Task toggle inserts the default `-[] ` form (regression Other #4). Toggle-off removes the whole marker on all four spellings. (Continuation behavior in B5.)
- [ ] **E9 — Blockquote** `Mod+Shift+B`: prefixes `> ` per line; toggles off when all selected lines are quoted.
- [ ] **E10 — Inline code** `Mod+E`: backticks around selection; double backticks when the selection contains a backtick; unwraps existing; **empty caret inside a code span unwraps it** (regression E9).
- [ ] **E11 — Code block** `Mod+Shift+K`: wraps selection in a fence; empty caret inserts a two-line fence template with the caret on the middle line; toggles off when the selection already spans a fenced block; **empty caret inside an existing fenced block removes the whole block** (regression E10).
- [ ] **E12 — Link** `Mod+K`: with selection → `[selected](url)` with `url` selected; empty → `[text](url)` with `text` selected. **Pressing the shortcut again on an untouched template deletes it** (regression E11). **Caret inside an existing `[link](url)` replaces it with its text**.
- [ ] **E13 — Image** `Mod+Alt+I` (**regression E12: no longer `Mod+Shift+I`**): `![selected](image.png)`; empty → `![alt](image.png)` with `alt` selected. Re-invoking on the untouched template deletes it; caret inside an existing image replaces it with the alt text. (The old `Mod+Shift+I` must NOT open devtools in Chromium.)
- [ ] **E14 — Table** `Mod+Alt+T` (Extra → Table): inserts a 3×3 GFM table template on its own block; caret lands in the first body cell; **focus stays in the editor** (regression E13).
- [ ] **E15 — Horizontal rule** `Mod+Shift+H` (Extra → Horizontal rule): inserts `---` with blank lines before/after as needed.
- [ ] **E16 — Footnote** `Mod+Shift+F` (Extra → Footnote): inserts `[^N]` at the caret (N increments beyond existing markers) and appends `[^N]: ` at the end of the document.
- [ ] **E17 — Heading ID** `Mod+Shift+2` (Extra → Heading ID): on a heading line appends ` {#custom-id}` (replaces an existing `{#…}`); does nothing on a non-heading line.
- [ ] **E18 — Definition list** `Mod+Alt+D` (Extra → Definition list, first real test): inserts `Term\n: Definition` with `Term` selected.
- [ ] **E19 — Subscript** `Mod+Alt+S` and **Superscript** `Mod+Alt+U`: wrap `<sub>text</sub>` / `<sup>text</sup>`; **an empty caret inside the tags unwraps them** (regression E18/E19 — previously they could only add).
- [ ] **E20 — Highlight** `Mod+Alt+M`: wraps `==text==`; **unwraps with an empty caret inside the pair** (regression E20).
- [ ] **E21 — Emoji picker** (Extra → Emoji picker or `Mod+Alt+E`): popover opens near the button; typing in the search box filters by name (e.g. "heart"); clicking an emoji inserts it at the caret; Escape or click-outside closes it. Only one picker can be open at a time.

## F. Live rendering (replaces the removed preview mode)

- [ ] **F1 — No preview mode (regression F1/F2, Other #9).** There is NO eye icon in the status bar, no `Mod+Shift+P`, no "Preview" option anywhere in the UI or settings; only Live and Source exist. Toggling `Mod+/` never shows a second pane.
- [ ] **F2 — Rendering correctness.** Create a doc exercising every feature, keep the caret on a line far away, and verify Live mode renders: headings, bold/italic/strikethrough/underline (`__`), `==highlight==`, sub/sup, blockquote, unordered/ordered/task lists (all task spellings), inline code, fenced code blocks with `js`, `ts`, `python`, `bash`, `json`, `yaml`, `html`, `css`, `rust`, `sql` (syntax-colored), tables (grid), `---` (divider), footnotes, definition lists, `:emoji:` shortcodes, `{#custom-id}` (hidden), `-#` subtext. Move the caret onto each line: the raw markdown appears for editing and returns to rendered when you leave.
- [ ] **F3 — Export-image resolution.** Save a doc containing `![alt](pic.png)` with `pic.png` next to it, export HTML, open the file: the image is embedded (works offline). In browser dev mode the src stays relative.

## G. Export HTML

- [ ] **G1 — Export.** `Mod+Shift+E` or File → Export HTML…: Save dialog pre-fills `<docname>.html` with HTML filters. Open the saved file in a browser: fully styled standalone page (same typography + hljs colors as the app), correct `<title>`, scrollable.
- [ ] **G2 — Export theme (regression G2).** The exported page now follows the **system/browser** theme, not the app setting: with the OS in light mode the page is light; switch the OS to dark mode and re-export → dark. No theme option is baked into the file. (App theme setting Light/Dark/System must not affect the export.)
- [ ] **G3 — Export safety (first real test).** A doc containing `<script>alert(1)</script>` or `<img onerror="…">`: the exported file contains no executable script (open the file — no alert) and has a strict CSP meta tag (`default-src 'none'`). Safe raw HTML (`<u>`, `<sub>`, `<kbd>`) still renders.
- [ ] **G4 — Export cancel.** Cancel the dialog → no error, doc unchanged.
- [ ] **G5 — Underline + subtext export (regression E3, Other #5).** `__x__` in the doc exports as `<u>x</u>` (underlined in the browser); `-# note` exports as a muted-styled paragraph without the `-# ` prefix.
- [ ] **G6 — Task markers export (regression Other #4).** `-[] task`, `- [ ] task`, `-[x] done`, `- [ ] open` all export as task-list items with rendered checkboxes (checked for `[x]`/`[X]`).

## H. Settings

Open with File → Settings or `Mod+,`. Every control applies immediately and persists across restart. Escape, backdrop click, or × closes; focus returns to the previously focused element; Tab/Shift+Tab wrap inside the dialog.

- [ ] **H1 — Theme.** Light / Dark / System. System follows the OS setting live (change OS theme while running).
- [ ] **H2 — Font size** (10–32 px) restyles the editor live; values clamp to range.
- [ ] **H3 — Line height (regression H3 / Other #1 — previously had NO effect).** Change the value 1.0 → 1.4 → 2.2 while typing: line spacing must visibly change live and match the value; clamp to 1.0–2.5.
- [ ] **H4 — Line wrapping.** Off → long lines scroll horizontally; On → wrap.
- [ ] **H5 — Autosave drafts.** Toggle off/on — see section I.
- [ ] **H6 — Extra menu always visible.** On → the Extra (⋯) items render as a permanent second toolbar row (no dropdown); Off → back to dropdown.
- [ ] **H7 — Default editing mode (first real test).** Live vs Source — the mode applied on the next launch.
- [ ] **H8 — Persistence (first real test).** Change several settings, restart the app: all kept. (Tauri: `settings.json` in the app data dir; browser: localStorage.)
- [ ] **H9 — Spell check (new, Other #6).** Editing fieldset has a "Spell check" checkbox, default ON. Type a misspelled word (e.g. "helo") in Live mode: red squiggle under it (Chromium spellcheck). Toggle OFF: squiggle disappears; toggle ON: returns. Applies immediately and persists.

## I. Drafts & recovery (autosave)

- [ ] **I1 — Draft autosave + cursor restore (regression I1/I2).** With "Autosave drafts" ON: edit an **unsaved** doc, move the caret to a distinctive line (e.g. line 12, column 5), stop typing ~3 seconds, then close the app (or browser tab). Relaunch. Expected: confirm dialog "Recover unsaved changes to untitled.md?" → Yes restores your text (dirty) **and the caret is back at the saved line/column**.
- [ ] **I2 — Draft for saved files.** Same flow with a previously saved file: edits made after the last save are offered for recovery, cursor restored.
- [ ] **I3 — No prompt when clean.** Close with no changes → no recovery prompt.
- [ ] **I4 — Decline recovery.** Answer No → prompt never appears again for that content; document opens from disk.
- [ ] **I5 — Draft cleared on save.** Recover a draft, then save: the draft is gone (restart → no prompt).
- [ ] **I6 — Draft cleared on undo-to-clean.** Type after saving (dirty), then `Mod+Z` back to saved content, wait 3s, restart → no recovery prompt.
- [ ] **I7 — Autosave off.** With the setting OFF, kill the app mid-edit → restart → no recovery prompt (content lost).

## J. Paste image (Tauri desktop only)

- [ ] **J1 — Paste image into a saved doc.** Copy an image (screenshot) and paste (`Mod+V`) into a saved document. Expected: an image file `docname-<timestamp>.png` (or `.jpg`) is written next to the document and `![docname](docname-<timestamp>.png)` is inserted at the caret. Undo removes the reference (the file on disk stays).
- [ ] **J2 — Paste image into an unsaved doc.** Folder picker appears; picking a folder saves the image there and inserts the reference; cancelling inserts nothing.
- [ ] **J3 — Browser dev mode (first real test).** Paste an image: nothing inserted (console warning) — expected, dev surface limitation.
- [ ] **J4 — No image on clipboard** → paste behaves as normal text paste.

## K. Security (regression surface — always test)

- [ ] **K1 — XSS sanitized in export.** Doc contains `<script>alert('x')</script>`, `<img src=x onerror=alert(1)>`, `<iframe>`, `<svg onload=…>`: the exported file shows nothing scriptable — no alert, no iframe/svg. Raw safe HTML (e.g. `<u>`, `<sub>`, `<kbd>`) still renders.
- [ ] **K2 — Link schemes.** A doc containing `[click](javascript:alert(1))`: clicking in the exported page does nothing (blocked). `data:`/`vbscript:` links likewise blocked. `https://…`, `mailto:…` open normally.
- [ ] **K3 — SVG images rejected.** `![svg](pic.svg)` next to a saved doc: export never embeds the SVG (expose_image refuses it) — the export shows raw/empty instead of an embedded image.

## L. Window & responsive behavior

- [ ] **L1 — Focus.** Click outside the app window and back: the editor regains focus (edit view, settings closed).
- [ ] **L2 — Narrow window.** Resize below ~600 px: settings dialog becomes a bottom sheet; toolbar/menus still usable. Window minimum is 360×400.
- [ ] **L3 — Multiple dropdowns.** Only one dropdown/emoji picker open at a time; Escape closes any open dropdown/picker; alt-tabbing away closes them. The search panel (`Mod+F`) does not open a dropdown.

## M. Platform-specific

- [ ] **M1 — Windows built installer (first real test).** Run the NSIS installer, launch the installed app: full test pass on the installed binary (not just dev mode). Uninstaller removes it.
- [ ] **M2 — macOS (if available).** Re-run the suite with Cmd shortcuts (Cmd+Shift+Z redo; `Mod+Y` must NOT fire redo on mac). Window close button shows the discard confirm (C8).
- [ ] **M3 — Browser dev mode gaps (first real test, expected not bugs):** no paste-image, no local image rendering in live view, Open Recent requires re-granting file permissions.

## N. Mobile (Android/iOS — deferred)

- [ ] **N1 — Android save bug (REQUIRED before mobile release).** Upstream issue #3356: `dialog.save()` can write a 0-byte file on Android. Manually verify Save / Save As on a device: the file on disk is non-empty and matches the document. The `content://` URI flow (open/save via mobile_fs) is not implemented yet — those paths must error gracefully, never hang.
- [ ] **N2 — Paste image on mobile** is a graceful no-op (nothing inserted, no crash).

---

## Known limitations / notes

- Browser dev mode (`npm run dev`) is a **Chromium-only dev/test surface** — never a production path (no real paths, no local images, no paste-image).
- Preview mode was removed after round 1; **Live mode is the only render surface** — tables/HR/blockquotes/highlight/sub/sup/subtext/heading-ids render there when the caret is elsewhere.
- Task-list checkboxes are toggled by **clicking the ☐/☑ in the editor** (Live mode) — this edits the markdown.
- Save does not re-add a UTF-8 BOM that was stripped on open.
- `{#anchor}` heading IDs render/hide in Live mode but in-page anchor jumps are no-ops (links open externally only).
- The find/replace panel is an in-editor overlay (`.cm-search`), not a dialog.
- Code-block languages supported: markdown, javascript, typescript, python, bash, json, yaml, html, css, rust, sql, plaintext (others fall back to uncolored code).
- Rust backend: `cargo check` verified with MSVC toolchain; Tauri-specific items (A3, C8, C9, J1/J2) still need a real `tauri dev` / built-app run.