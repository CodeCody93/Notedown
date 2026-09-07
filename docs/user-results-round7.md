# Notedown — User Test Checklist (Round 7: Round-6 fixes + Import retest)

Covers the four round-6 fixes (SVG export, unsaved-export guard, spoiler
print, Import dialog) plus the two Import items left untested in round 6
(C6 cancel paths, C7 corrupt file). Everything else from Rounds 2–6 was
verified and is covered by the automated suite (380 Vitest tests green,
`npm run typecheck` + `npm run tauri build` clean) — re-test old items
only if something below looks broken.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. See F3 for expected gaps. |
| Tauri desktop (dev) | `npm run tauri dev` | Requires Rust toolchain + VS Build Tools. |
| Tauri desktop (built) | `npm run tauri build` | Produces `Notedown_0.1.0_x64-setup.exe` / `.msi`. Preferred surface for this round. |

## Tester info

- Date: 9/5/2026
- Platform (Windows 11 / macOS / Linux): Windows 10
- Build/version: 0.2.0 dev
- Mode tested (browser dev / Tauri dev / built installer): Built Installer
- Hotkey convention (Ctrl on Windows/Linux, Cmd on macOS): Ctrl

## Test conventions

- `Mod` = **Ctrl** on Windows/Linux, **Cmd** on macOS.
- Check `[ ]` after verifying Expected. Add a subtext `-#` below the item if anything deviates.

---

## A. Export HTML (round-6 fixes)

Set up: create a folder with a doc `export-test.md` plus a real `pic.png` (any PNG)
and a `pic.svg` (any SVG) next to it.

- [x] **A1 — SVG embedded (was: literal text).** Reference both via
  `![png](pic.png)` and `![svg](pic.svg)` → File/Export HTML → save → open the
  HTML offline. Expected: BOTH visible offline; View Source contains
  `data:image/png;base64,…` and `data:image/svg+xml;base64,…`. Root cause of
  the round-6 failure: markdown-it rejected `data:image/svg+xml` link targets,
  so the SVG rendered as literal `![svg](data:…)` text. No skip alert appears
  when everything embeds.
- [x] **A2 — Unsaved doc aborts (was: warned but still exported).** With an
  unsaved `untitled.md` containing `![png](pic.png)` → File/Export HTML.
  Expected: the unsaved-document alert appears AND **no save dialog opens, no
  file is written**. (Behavior change vs round 6: the export is now aborted
  instead of writing a broken file. An unsaved doc whose images are ALL remote
  `https://…` still exports normally.)
- [x] **A3 — Spoilers visible in exported-HTML print (was: missing).** Doc with
  `||secret||` → Export HTML → open the file → Print Preview. Expected: white
  background, black text, no copy-buttons on code blocks, spoiler text shown
  as plain readable text.

## B. Export PDF (round-6 fix)

- [x] **B1 — Spoilers visible in PDF print (was: missing).** Doc with
  `||secret||`, a code block, a table, a dropdown (`>>> Title`…`>>>`).
  File/Export PDF… → destination "Save as PDF" / "Microsoft Print to PDF".
  Expected: PDF contains the spoiler text as plain text, the image/code/table;
  no copy-buttons; links show their URLs in parentheses.

## C. Import (was: no reaction — dialog never appeared; now fixed)

For each file below: File/Import… → pick the file → a dialog lists what may be
lost → [Import anyway] loads it as a new unsaved `*.md` doc (dirty dot on);
[Cancel]/Esc/backdrop-click aborts with the current doc untouched. If the
current doc has unsaved changes, a discard-confirm comes FIRST — verify with a
dirty doc once (use TXT for that run).

- [x] **C1 — TXT/Markdown (lossless, no warning list).** Import a `.txt` file.
  Expected: dialog says "No formatting will be lost."; content lands verbatim
  as `<name>.md`, dirty.
-# Importing works correctly. But there is no need to have a warning dialog if there is no formatting to be lost.
- [x] **C2 — HTML.** Import a saved web page / `.html` with headings, bold,
  a list, a table. Expected: loss dialog lists scripts/styles/layout/images/fonts;
  result is readable markdown (headings `#`, `-` bullets, table pipes).
-# All working except for footnotes. However it would be nice if the expanded markdown features could also be imported from HTML. E.g. subtext `-#`, Definition lists, superscript `^text^`, subscript `~text~`, highlight `==text==`, spoilers `||text||` and dropdowns `>>> text >>>`. Also, embed data:base64 images are imported as long plain text making it a bit hard to read, consider importing these and new accompanying image files in the same folder, or stripping them all together. Stripping might be better but I don't know.
- [ ] **C3 — DOCX.** Import a Word `.docx` with headings + bold + a list.
  Expected: loss dialog mentions images/fonts/headers/footnotes; text imports
  with headings and list intact.
-# Untested due to lack of testing file.
- [x] **C4 — PDF.** Import a text-based `.pdf` (1–2 pages). Expected: loss dialog
  mentions images/layout/fonts/scanned-PDF caveat; text extracts in reading
  order (layout may flatten — acceptable, note it with `-#`).
-# Import seems fast, but sometimes does not import any text. Further testing required.
- [x] **C5 — RTF.** Import an `.rtf` with bold/italic/paragraphs. Expected:
  paragraphs survive; loss dialog notes the minimal converter (embeds/fonts/
  underline lost).
-# Almost working. However closing bold tags "**" are positioned on a new line instead, breaking them. Double check if italic and underline also have this issue.
- [ ] **C6 — Cancel paths (untested in round 6).** Start Import of a DOCX but
  press [Cancel], then again with Esc, then again via backdrop click. Expected:
  all three abort, current doc untouched, no error.
-# Untested due to lack of testing file.
- [ ] **C7 — Encrypted/corrupt file (untested in round 6).** Import a
  password-protected PDF or a renamed non-DOCX `.docx`. Expected: a readable
  "Import failed: …" alert, no hang, doc untouched.
-# Untested due to lack of testing file.

## D. Browser dev mode gaps (round-6 fix + expected behavior)

- [x] **D1 — Paste-image warns (was: silent).** In `npm run dev` (Chromium),
  paste an image from the clipboard into the editor. Expected: a visible alert
  explains paste-image needs the Tauri desktop app; nothing is inserted.
-# Working correctly. But could you please change the text to instead say: "Pasting images is not supported in browser preview mode (there is no document folder to save into). Use the Notedown desktop app for paste-image functionality."
- [x] **D2 — Import dialog appears in browser too.** In `npm run dev`, run one
  Import (use TXT). Expected: the loss dialog appears and the import completes
  (PDF/DOCX parse in-page; large files may be slow — note timing with `-#`).

## E. Open product question (needs your go-ahead)

- [x] **E1 — Support link.** File/About → "Support Notedown" still points at an
  `example.com/...-TODO` placeholder. Reply with the real Ko-fi / GitHub
  Sponsors / other URL (or "leave the placeholder") and it gets wired next round.
-# Leave placeholder for now.

## F. Regression spot-checks

- [x] **F1 — File menu order.** File menu reads: New, Open, Open Recent,
  Import…, — Save, Save as, Export HTML…, Export PDF…, — Settings, Help, About.
- [x] **F2 — Old shortcuts unchanged.** `Mod+Shift+E` still exports HTML;
  `Mod+P` opens Export PDF; `findDuplicateChords` guard is green in CI.

---

## Notes

- Export embeds local `png/jpg/gif/webp/bmp` AND `svg` as `data:` URLs; SVGs
  are DOMPurify-sanitized before embedding (scripts stripped — safe) and
  `javascript:`/`data:text/html` targets are still rejected. Remote/absolute/
  unreadable sources are skipped BY DESIGN and REPORTED in an alert.
- Unsaved-document export with local images is now ABORTED (no file written);
  save first, then export.
- The standalone export carries its own print stylesheet (spoilers revealed,
  link URLs shown, dropdowns normalized) so it prints correctly on its own;
  Export PDF prints that same document through the OS print dialog.
- Import never overwrites the current file: results always load as a new dirty
  untitled-path doc; binary formats (PDF/DOCX) are read as bytes via the
  `pick_and_read_bytes` Rust command on desktop.

## Other Notes:
- When importing files the default file type filter should be all supported import types in one. And then have the current file type dropdown filter options come afterwards. So it should look like this:
```
  Importable Files (*.md, *.markdown, *.txt, *.html, *.htm, *.pdf, *.docx, *.rtf)
  Markdown (*.md, *.markdown., *.txt)
  HTML (*.html, *.htm)
  PDF (*.pdf)
  Word (*.docx)
  RTF (*.rtf)
  All files (*.*)
```