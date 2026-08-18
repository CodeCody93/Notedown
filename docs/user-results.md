# MarkItDown — User Test Checklist

Manual QA checklist for human testers. Run through every section on each release candidate and record the outcome (Pass / Fail / Notes). Automated unit tests (`npm test`) cover the pure logic; this list covers what only a human can verify: dialogs, native file I/O, rendering, and cross-platform behavior.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open the printed URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. |
| Tauri desktop (dev) | `npm run tauri dev` | Requires Rust toolchain + VS Build Tools (see handoff). |
| Tauri desktop (built) | `npm run tauri build` | Produces `MarkItDown_0.1.0_x64-setup.exe` (NSIS) / `.msi` on Windows. |

## Tester info (fill in)

- Date: 8/18/2026
- Platform (Windows 11 / macOS / Linux / Android / iOS): Windows 10
- Build/version: 0.1.0 dev
- Mode tested (browser dev / Tauri dev / built installer): Turi dev
- Hotkey convention used (Ctrl on Windows/Linux, Cmd on macOS): `Ctrl`

## Test conventions

- `Mod` in this document means **Ctrl on Windows/Linux, Cmd on macOS**.
- Every test: perform the steps, compare against "Expected", then mark the checkbox `[x]` and add a note if anything deviates. Deviations are bugs — report them with steps to reproduce buy putting a subtext right below the step.
- The app data directory (settings/recents/drafts) on Windows is `%APPDATA%\com.markitdown.app`, on macOS `~/Library/Application Support/com.markitdown.app`.

---

## A. First launch

- [x] **A1 — Fresh start.** With no previous app data (delete the app data dir if needed), start the app. Expected: empty `untitled.md` document, editor focused, placeholder text "Start typing your markdown here" visible, status bar shows `untitled.md · Live · Ln 1 · Col 1 · 0 words · 0 chars`, no dirty dot.
- [x] **A2 — Menubar renders.** File menu, toolbar (Undo/Redo/Copy/Cut/Paste, Bold/Italic/Underline/Strikethrough, Header, List), and the Extra (⋯) dropdown are visible. Hotkey hints shown on menu items match the real shortcuts in this document (they come from the same map, so they always should).
-# Not all extended menu options have keybindings shown. The following are missing:
- Table
- Horizontal Rule
- Footnote
- Tasklist
- Emoji Picker
- Heading ID
- Definition List
- Subscript
- Superscript
- Highlight
- [x] **A3 — Window title.** Title reads `untitled.md — MarkItDown` (adds `• ` prefix when the doc is dirty).
-# Document name not shown in window title bar.

## B. Editor basics

- [x] **B1 — Typing + status.** Type a few words. Expected: words/chars counters update live, Ln/Col follow the caret.
- [x] **B2 — Placeholder disappears** once you start typing and returns after deleting everything.
- [x] **B3 — Undo/redo.** Type, then `Mod+Z` then `Mod+Shift+Z` (Windows/Linux also `Mod+Y`). Toolbar Undo/Redo buttons do the same. Each formatting action below must undo/redo as a single step.
- [x] **B4 — Copy/cut/paste buttons.** Select text → Copy → paste elsewhere; Cut removes and copies; Paste inserts clipboard text at the caret. (Buttons must work even when the editor is not focused.)
- [x] **B5 — List continuation.** Type `- item` and press Enter. Expected: new line starts with `- `. Press Enter on an empty item: the marker is removed (second Enter exits the list). Same for ordered lists (`1. item` → `2. `) and task lists (`- [ ] item` → `- [ ] `).
- [x] **B6 — Live vs source mode.** Status-bar mode label toggles between "Live" and "Source" when clicked; `Mod+/` does the same. In Live mode formatting marks (`**`, `#`, `- `, `> `) are hidden and rendered as rich text; in Source mode all marks are visible as raw text.
- [x] **B7 — Live-mode reveal.** In Live mode, put the caret anywhere inside `**bold text**` (also with an active selection). Expected: the `**` markers reappear faded while the caret is inside the formatting region, and hide again when the caret leaves it. Same for `*italic*`, `~~strike~~`, `` `code` ``, headings, lists, and blockquotes on the caret's line.
- [x] **B8 — List markers in Live mode.** With the caret on another line, a line containing `- item` shows a `•` bullet; `1. item` shows `1.`; `- [ ] task` shows `☐` and `- [x] task` shows `☑` (in Source mode the raw markers return).
- [x] **B9 — Images in Live mode.** With a saved document containing `![alt](img.png)` where `img.png` sits next to the document: the image renders inline in Live mode (Tauri only). In browser dev mode or with an unsaved doc it falls back to raw markdown text.
- [x] **B10 — Fenced code + images are not collapsed.** Inside a ``` fence the text stays raw; an image's alt text does not get emphasis decoration.

## C. File operations

- [x] **C1 — New.** `Mod+N` or File → New with a clean doc: nothing happens beyond a fresh untitled doc. With unsaved changes: a Yes/No confirm "Discard unsaved changes to <name>?" appears; **No** keeps the document and stops the action, **Yes** starts a new empty `untitled.md`.
-# When changing to a new document with Ctrl+N, undo history persists from old document resulting in strange behavior.
- [x] **C2 — Open.** `Mod+O` or File → Open: native file dialog with Markdown (`md`, `markdown`) and All files filters. Open a `.md` file → content loads, status bar shows the filename, dirty dot absent. Cancel → nothing changes.
- [x] **C3 — Open with unsaved changes** shows the discard confirm (see C1).
- [x] **C4 — Save.** `Mod+S` or File → Save: untitled doc → Save As dialog appears. Named doc → saves silently, dirty dot clears, title `•` disappears.
- [x] **C5 — Save As.** `Mod+Shift+S`: picker always appears; the saved file becomes the current document (status bar shows the new name).
- [ ] **C6 — CRLF + BOM handling.** Create a file with CRLF line endings and a UTF-8 BOM, open it, type, save. Expected: content round-trips correctly (line endings preserved as-is). Note: a BOM present on open is stripped and not re-added on save — verify the file still reads correctly in another editor.
-# Untested.
- [x] **C7 — Dirty state via undo.** Type, save, then type more (dirty dot on) and press `Mod+Z` back to the saved content. Expected: dirty dot clears (document is "clean" again).
- [x] **C8 — Close guard.** Make the doc dirty and close the window (Tauri). Expected: confirm dialog appears; **No** keeps the app open with the document intact; **Yes** closes.
-# See Other noted issues #3
- [x] **C9 — Open failure.** Try File → Open Recent on an entry whose file was deleted (see M-section) or, in browser dev mode, revoke permission. Expected: an error alert, and the entry is removed from the recent list.
-# No error alert is shown when attempting to open a deleted file from Open Recent and the item is not removed from the list.

## D. Recents

- [x] **D1 — Recents list.** Open several files (up to 10). File → Open Recent (`Mod+Shift+O`) lists them newest-first with name + full path, deduplicated (re-opening the same file moves it to the top, no duplicate).
- [x] **D2 — Open recent.** Click an entry → file opens without a picker. Persists across restarts.
- [x] **D3 — Missing file.** Delete a file on disk, then open File → Open Recent: its entry is disabled (greyed). Clicking it → error alert and the entry is removed.
- [x] **D4 — Clear recent.** Open Recent → Clear recent empties the list (shows "No recent files" afterwards) and persists across restarts.

## E. Formatting (toolbar + hotkeys)

For each command: test with (a) empty caret, (b) a text selection, (c) a selection already formatted (toggle off). All must be single undo steps.

- [x] **E1 — Bold** `Mod+B`: `**text**` / caret between `****`. Unwraps when inside `**…**`.
-# When caret is empty it does not remove and only adds more. 
- [x] **E2 — Italic** `Mod+I`: `*text*` / `**` with caret between. Unwraps when inside `*…*`.
-# Same issue as E1.
- [x] **E3 — Underline** `Mod+U`: `<u>text</u>`.
-# Incorrect implementation. Please see Other Noted Issues #2. Also has simular issues as E1.
- [x] **E4 — Strikethrough** `Mod+Shift+X`: `~~text~~`. Unwraps when inside `~~…~~`.
-# Same issue as E1.
- [x] **E5 — Headings.** Header dropdown (H button) with Paragraph/H1–H6; hotkeys `Mod+0`…`Mod+6`; `Mod+Alt+H` cycles paragraph → H1 → … → H6 → paragraph. Multi-line selection applies to every selected line.
- [x] **E6 — Lists.** List dropdown: Unordered/Ordered/Task. Multi-line selection: markers added to every unmarked line (ordered gets sequential 1., 2., …); if every line already has the marker, all markers are removed. `Mod+Shift+L` = unordered.
-# Currently no hotkey options for any list type other than unsorted. Also, see Other Noted Issues #4.
- [x] **E7 — Task list.** List → Task or Extra → Task list: `- [ ] ` on each line; toggles off when all lines already have it.
-# Hotkey Ctrl+Shift+L leaves '[ ]' behind when removing a task list item. Also, see Other Noted Issues #4.
- [x] **E8 — Blockquote** `Mod+Shift+B`: prefixes `> ` per line; toggles off when all selected lines are quoted.
-# Blockquote not displayed while in edit (Live) mode when caret leaves it.
- [x] **E9 — Inline code** `Mod+E`: backticks around selection; double backticks when the selection contains a backtick; unwraps existing; empty caret inserts ` `` ` with caret between.
-# Only adds ` `` ` marks. Never removes them. 
- [x] **E10 — Code block** `Mod+Shift+K`: wraps selection in a fence; empty caret inserts a two-line fence template with the caret on the middle line; toggles off when the selection already spans a fenced block.
-# Same issue as E9.
- [x] **E11 — Link** `Mod+K`: with selection → `[selected](url)` with `url` selected; empty → `[text](url)` with `text` selected.
-# Repeated presses of Ctrl+K result in more "`[text](url)`" being added. Perhaps add a check to see if nothing else was pressed then remove the "`[text](url)`" instead.
- [x] **E12 — Image** `Mod+Shift+I`: `![selected](image.png)`; empty → `![alt](image.png)` with `alt` selected.
-# Ctrl+Shift+I opens dev tools. Perhaps change the keybinding or remove the opening of dev tools. Whatever is more familiar for users. Also has the same issue as E11.
- [x] **E13 — Table** (Extra → Table): inserts a 3×3 GFM table template on its own block; caret lands in the first body cell.
-# Caret is not placed when table is made. Perhaps due to the user clicking the button in the dropdown? Also, table does not render when the caret is outside it while in edit (Live) mode.
- [x] **E14 — Horizontal rule** (Extra → Horizontal rule): inserts `---` with blank lines before/after as needed.
-# Does not render when the caret is outside it while in edit (Live) mode.
- [x] **E15 — Footnote** (Extra → Footnote): inserts `[^N]` at the caret (N increments beyond existing markers) and appends `[^N]: ` at the end of the document.
-# Seems to start at footnote #2. But this may be user error.
- [x] **E16 — Heading ID** (Extra → Heading ID): on a heading line appends ` {#custom-id}` (replaces an existing `{#…}`); does nothing on a non-heading line.
-# The text "`{#custom-id}`" is visable in edit (Live) mode even when the caret is not editing that line.
- [ ] **E17 — Definition list** (Extra → Definition list): inserts `Term\n: Definition` with `Term` selected.
-# Untested as I am unsure what intended behavior should be.
- [x] **E18 — Subscript** (Extra): `<sub>text</sub>`;
-# Continues to add and not remove surrounding "`<sub></sub>`" when used  multiplue times. Also does not render in edit (Live) mode when caret is outside it.
- [x] **E19 — Superscript**: `<sup>text</sup>`;
-# Same issues as E18.
- [x] **E20 — Highlight**: `==text==`.
-# Not rendered while in edit (Live) mode while caret is outside.
- [x] **E21 — Emoji picker** (Extra → Emoji picker): popover opens near the button; typing in the search box filters by name (e.g. "heart"); clicking an emoji inserts it at the caret; Escape or click-outside closes it. Only one picker can be open at a time.

## F. View / preview mode

- [x] **F1 — Toggle preview.** Eye icon in the status bar, status-mode click, or `Mod+Shift+P`. Edit pane hidden, preview pane shown; toggling back restores the editor (cursor position kept).
- [ ] -# Cursor/caret position is not kept.
- [x] **F2 — Live re-render.** While in preview, keep typing in the editor? (Editor is hidden in preview — instead switch back and forth.) Edit → toggle preview: content re-renders, "Rendering…" stale indicator flashes briefly while a re-render is pending on rapid changes.
-# See Other Noted Issues #9.
- [ ] **F3 — Rendering correctness.** Create a doc exercising every plugin: headings, bold/italic/strikethrough/underline, `==highlight==`, sub/sup, blockquote, unordered/ordered/task lists, inline code, fenced code blocks with `js`, `ts`, `python`, `bash`, `json`, `yaml`, `html`, `css`, `rust`, `sql` languages (syntax-colored), tables, `---`, footnotes (`[^1]` → `[^1]: text` renders a footnote section with backref), definition lists, `:emoji:` shortcodes, `{#custom-id}` heading anchors, task list checkboxes. Preview must match the exported HTML visually.
-# Untested due to other issues to be fixed first.
- [x] **F4 — Links.** Click a link in the preview. Expected: opens in the default browser (Tauri) / new tab (browser dev mode), never inside the app. `#anchor` links do nothing (no error). Relative links resolve against the document's directory.
-# See Other Noted Issues #9.
- [ ] **F5 — Images.** A saved doc with `![alt](pic.png)` renders the picture in preview (Tauri). Unsaved docs and browser dev mode leave the src as-is (broken image). `.svg` images are rejected and do not render.
- [ ] -# Untested.
- [x] **F6 — Theme sync.** Switch light/dark theme while preview is open: preview restyles immediately (code blocks included).

## G. Export HTML

- [x] **G1 — Export.** `Mod+Shift+E` or File → Export HTML…: Save dialog pre-fills `<docname>.html` with HTML filters. Open the saved file in a browser: fully styled standalone page (same typography + hljs colors as preview), correct `<title>`, scrollable.
- [x] **G2 — Export theme.** Export in dark theme → dark tokens; light theme → light tokens.
-# Instead of exporting set themes exported HTML pages should just use the system/browser settings so they are still dynamic when exported.
- [ ] **G3 — Export safety.** A doc containing `<script>alert(1)</script>` or `<img onerror="…">`: the exported file contains no executable script (check the file and open it — no alert). The export has a strict CSP meta tag (`default-src 'none'`).
-# Untested.
- [x] **G4 — Export cancel.** Cancel the dialog → no error, doc unchanged.

## H. Settings

Open with File → Settings or `Mod+,`. Every control applies immediately and persists across restart. Escape, backdrop click, or × closes; focus returns to the previously focused element; Tab/Shift+Tab wrap inside the dialog.

- [x] **H1 — Theme.** Light / Dark / System. System follows the OS setting live (change OS theme while running).
-# "System" untested.
- [x] **H2 — Font size** (10–32 px) and **H3 — Line height** (1.0–2.5) restyle the editor live; values clamp to range.
-# Font size works. But Line height does not seem to do anything visually.
- [x] **H4 — Line wrapping.** Off → long lines scroll horizontally; On → wrap.
- [x] **H5 — Autosave drafts.** Toggle off/on — see section I.
- [x] **H6 — Extra menu always visible.** On → the Extra (⋯) items render as a permanent second toolbar row (no dropdown); Off → back to dropdown.
- [ ] **H7 — Default editing mode.** Live vs Source — the mode applied on the next launch.
-# Untested.
- [ ] **H8 — Persistence.** Change several settings, restart the app: all kept. (Tauri: `settings.json` in the app data dir; browser: localStorage.)
-# Untested.

## I. Drafts & recovery (autosave)

- [x] **I1 — Draft autosave.** With "Autosave drafts" ON: edit an **unsaved** doc and wait ~3 seconds after stopping typing, then close the app (or browser tab). Relaunch. Expected: confirm dialog "Recover unsaved changes to untitled.md?" → Yes restores your text (dirty).
-# Works. However caret/cursor position is not saved.
- [x] **I2 — Draft for saved files.** Same flow with a previously saved file: edits made after the last save are offered for recovery.
-# Same note as I1.
- [x] **I3 — No prompt when clean.** Close with no changes → no recovery prompt.
- [x] **I4 — Decline recovery.** Answer No → prompt never appears again for that content; document opens from disk.
- [x] **I5 — Draft cleared on save.** Recover a draft, then save: the draft is gone (restart → no prompt).
- [x] **I6 — Draft cleared on undo-to-clean.** Type after saving (dirty), then `Mod+Z` back to saved content, wait 3s, restart → no recovery prompt.
- [x] **I7 — Autosave off.** With the setting OFF, kill the app mid-edit → restart → no recovery prompt (content lost).

## J. Paste image (Tauri desktop only)

- [x] **J1 — Paste image into a saved doc.** Copy an image (screenshot) and paste (`Mod+V`) into a saved document. Expected: an image file `docname-<timestamp>.png` (or `.jpg`) is written next to the document and `![docname](docname-<timestamp>.png)` is inserted at the caret. Undo removes the reference (the file on disk stays).
- [x] **J2 — Paste image into an unsaved doc.** Folder picker appears; picking a folder saves the image there and inserts the reference; cancelling inserts nothing.
- [ ] **J3 — Browser dev mode.** Paste an image: nothing inserted (console warning) — expected, dev surface limitation.
-# Untested.
- [x] **J4 — No image on clipboard** → paste behaves as normal text paste.

## K. Security (regression surface — always test)

- [x] **K1 — XSS sanitized in preview.** Doc contains `<script>alert('x')</script>`, `<img src=x onerror=alert(1)>`, `<iframe>`, `<svg onload=…>`: preview shows nothing scriptable — no alert, no iframe/svg. Raw safe HTML (e.g. `<u>`, `<sub>`, `<kbd>`) still renders.
- [x] **K2 — Link schemes.** A doc containing `[click](javascript:alert(1))`: clicking in preview does nothing (blocked, console warning). `data:`/`vbscript:` links likewise blocked. `https://…`, `mailto:…` open normally.
- [ ] **K3 — SVG images rejected.** `![svg](pic.svg)` never renders as an image in preview (expose_image refuses SVG).
-# Untested.

## L. Window & responsive behavior

- [x] **L1 — Focus.** Click outside the app window and back: the editor regains focus (edit view, settings closed).
- [x] **L2 — Narrow window.** Resize below ~600 px: settings dialog becomes a bottom sheet; toolbar/menus still usable. Window minimum is 360×400.
- [x] **L3 — Multiple dropdowns.** Only one dropdown/emoji picker open at a time; Escape closes any open dropdown/picker; alt-tabbing away closes them.

## M. Platform-specific

- [ ] **M1 — Windows built installer.** Run the NSIS installer, launch the installed app: full test pass on the installed binary (not just dev mode). Uninstaller removes it.
-# Untested.
- [ ] **M2 — macOS (if available).** Re-run the suite with Cmd shortcuts (Cmd+Shift+Z redo; `Mod+Y` must NOT fire redo on mac). Window close button shows the discard confirm.
-# Untested.
- [ ] **M3 — Browser dev mode gaps** (expected, not bugs): no paste-image, no local image rendering in preview/live view, Open Recent requires re-granting file permissions.
-# Untested.

## N. Mobile (Android/iOS — M5, deferred)

- [ ] **N1 — Android save bug (REQUIRED before mobile release).** Upstream issue #3356: `dialog.save()` can write a 0-byte file on Android. Manually verify Save / Save As on a device: the file on disk is non-empty and matches the document. The `content://` URI flow (open/save via mobile_fs) is not implemented yet — those paths must error gracefully, never hang.
-# Untested.
- [ ] **N2 — Paste image on mobile** is a graceful no-op (nothing inserted, no crash).
-# Untested.

---

## Known limitations / notes

- Browser dev mode (`npm run dev`) is a **Chromium-only dev/test surface** — never a production path (no real paths, no local images, no paste-image).
- Save does not re-add a UTF-8 BOM that was stripped on open.
- Preview task-list checkboxes are read-only (disabled) — checking them off is editing the markdown, not clicking in preview.
- `{ #anchor}` heading IDs render in preview/export but in-page anchor jumps in preview are no-ops (links open externally only).
- Code-block languages supported: markdown, javascript, typescript, python, bash, json, yaml, html, css, rust, sql, plaintext (others fall back to uncolored code).

---

# Other Noted Issues:
1. Adjusting line height in settings produces no visable changes.
2. Ctlr+U produces: "<u></u>" around selected text. Although this is to standard I would like to use double _ for underline instead and have it apply as underlining the text.
3. Unable to close the application from the "X" close button or with Alt+F4.
4. Having to add extra white space to make task lists feels unintuitive. Please add support for -[], - [] and -[ ]. Making -[] the default.
5. Subtext '-# ' seems to be unsupported please implement '-# '.
6. Currently no spell check. I think this would make a nice additional toggable feature.
7. Task lists are not toggable via mouse click. Should they be?
8. Currently no support for find and replace with Ctrl+H. I think this would make a nice additional feature.
9. The "Preview" mode I think is largely unnecessary and it would be better to only have "Live" and "Source" modes. Live mode rendering the markdown while the cursor/caret is outside it. Source mode always displaying the source text.

---

## Changes from feedback round (implemented)

This batch implements fixes for every feedback item recorded in this report. The changes follow the file layout of PLAN.md's milestone order (platform, state, editor/formatting, styles).

- A2 — Hotkey hints missing on Extra menu items (Table, Horizontal Rule, Footnote, Task List, Emoji Picker, Heading ID, Definition List, Subscript, Superscript, Highlight) → chords assigned to all ten items in `src/app/shortcuts.ts`; hints render on the menu items via `labelFor`.
- A3 — Document name not shown in the window title → `getCurrentWindow().setTitle()` called on every doc name change; title reads `<name> — MarkItDown` with a `• ` prefix while dirty.
- C1 — Undo history persisted from the old document after New → `EditorController.resetHistory()` installs a fresh `history()` on full-document replace.
- C6 — CRLF/BOM round-trip untested → no change; still untested.
- C8 — Window could not be closed via the X button or Alt+F4 → Tauri `close-requested` handler calls `preventDefault()` and then `getCurrentWindow().destroy()` after the discard confirm; `beforeunload` guards browser dev mode.
- C9 — No error alert on failed open; stale recent entry kept → `FileIO.alert` added (Rust `alert_dialog` command in Tauri, `window.alert` fallback in browser mode); a failed open removes the entry from the recent list.
- D3 — Missing files in Open Recent → entries for missing files render grey-but-clickable (`.missing` class) instead of disabled; clicking still raises the alert and removes the entry.
- E1 — Bold with an empty caret only added marks, never removed → tree-unwrap loosened to fire when the caret is inside the node's bounds (not only on the node); `**` vs `__` distinguished via a source-text predicate.
- E2 — Italic, same issue as E1 → same unwrap fix as E1.
- E3 — Underline used `<u>...</u>`; `__` requested (Other #2) → underline now inserts `__text__`; markdown-it strong rule with `markup: '__'` emits `<u>`; live preview styles `__` runs with `cm-underline`.
- E4 — Strikethrough, same issue as E1 → same unwrap fix as E1/E2.
- E6 — No hotkeys for ordered/task lists → `Mod-Alt-o` (ordered) and `Mod-Alt-l` (task) added; unordered keeps `Mod-Shift-L`.
- E7 — Toggle-off left `[ ]` behind → full task marker removed on toggle-off.
- E8 — Blockquote not rendered in Live mode when the caret leaves the line → `cm-blockquote` decoration applied to inactive quote lines.
- E9 — Inline code only added marks, never removed them → `InlineCode` tree-unwrap with delimiter removal.
- E10 — Code block, same issue as E9 → `FencedCode` ancestor removal when the caret is inside the fence.
- E11 — Repeated `Mod+K` stacked more `[text](url)` templates → template-removal (deletes the exact template when the caret is before it) plus tree-based toggle-off (Link → plain text).
- E12 — `Mod-Shift-I` opened devtools and stacked image templates → image chord moved to `Mod-Alt-i`; toggle-off via tree (Image → alt text).
- E13 — Table: caret not placed; no render when caret outside → whole-Table widget when no table line is active; `editor.focus()` after menu-driven formatting.
- E14 — HR not rendered when caret outside → `HorizontalRule` widget renders `---` lines outside the caret line.
- E15 — Footnote seemed to start at #2 → verified correct: N is max existing footnote + 1 (the tester note concedes this may be user error); no change.
- E16 — `{#custom-id}` visible in Live mode when not editing that line → trailing `{#...}` hidden on inactive heading lines.
- E17 — Definition list untested → chord assigned (see A2); insert behavior unchanged.
- E18 — Subscript: kept adding `<sub>` tags, never removed; not rendered in Live mode → text-based region unwrap (toggle on/off); tags hidden and content styled (`cm-sub-content`) in Live mode; chord `Mod-Alt-s`.
- E19 — Superscript, same issues as E18 → same fix as E18 (`cm-sup-content`, chord `Mod-Alt-u`).
- E20 — Highlight not rendered in Live mode → `==` pair wrap/unwrap; live rendering with `cm-highlight-content`; chord `Mod-Alt-m`.
- F1/F2 — Preview toggle lost caret position; preview judged unnecessary (Other #9) → preview mode removed entirely; only Live and Source remain (preview pane, eye button, toggle-preview shortcut, and `preview.ts`/`preview.css`/`preview.test.ts` deleted).
- F3 — Preview rendering correctness untested → moot: preview mode removed (see F1/F2).
- F5 — Preview images untested → moot: preview mode removed; live-mode image behavior unchanged.
- G2 — Exported HTML baked the active theme → standalone export no longer bakes a theme; `:root` light defaults plus `@media (prefers-color-scheme: dark)` overrides; both hljs variants sit under the media query.
- G3 — Export safety untested → no change; still untested (CSP meta + sanitized export unchanged).
- H3 — Line height setting had no visible effect → root cause: package `editorTheme`'s `.cm-line` rule (`line-height: 1.75`) mounted after ours; our rule now uses `.cm-content .cm-line` for higher specificity.
- H7/H8 — Default mode and persistence untested → no change; still untested.
- I1 — Draft autosave worked but caret position was not saved → Session gains `cursor {line, col}`; saved on draft write, restored on recover; old sessions parse with a null cursor.
- I2 — Same note as I1 → same fix as I1.
- J3 — Browser paste-image untested → no change; still untested (expected dev-surface gap).
- K3 — SVG images rejected, untested → SVG rejection enforced in `expose_image` (MIME/extension check).
- M1–M3 — Untested → no change; still untested.
- N1/N2 — Mobile untested → no change; deferred to M5.
- Other #1 — Line height produces no visible changes → same root cause and fix as H3 (`.cm-content .cm-line` specificity).
- Other #2 — Prefer `__` for underline → covered by E3 (`__` → `<u>`).
- Other #3 — Cannot close via X or Alt+F4 → covered by C8.
- Other #4 — Task lists require extra whitespace; wants `-[]` support → accepts `-[]`, `- []`, `-[ ]` and `- [ ]`; default insert form is `-[] `; live preview marker and markdown-it export extended; list continuation preserves the entered form.
- Other #5 — `-# ` subtext unsupported → markdown-it core rule emits `<p class="md-subtext">`; live preview hides the `-# ` prefix and styles the content.
- Other #6 — No spell check → new `Settings.spellCheck` (default true), settings dialog checkbox, `EditorController.setSpellCheck()`.
- Other #7 — Task lists not toggleable by mouse click → `ListMarkerWidget` mousedown toggles the marker between `[ ]` and `[x]`.
- Other #8 — No find & replace → `@codemirror/search` installed; `search()` and `searchKeymap` (`Mod-f` / `Mod-h`) added to the editor; `.cm-search` styles.
- Other #9 — Preview mode unnecessary; only Live and Source wanted → covered by F1/F2 (preview removed; Live and Source remain).
