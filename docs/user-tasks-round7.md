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

- Date:
- Platform (Windows 11 / macOS / Linux):
- Build/version:
- Mode tested (browser dev / Tauri dev / built installer):
- Hotkey convention (Ctrl on Windows/Linux, Cmd on macOS):

## Test conventions

- `Mod` = **Ctrl** on Windows/Linux, **Cmd** on macOS.
- Check `[ ]` after verifying Expected. Add a subtext `-#` below the item if anything deviates.

---

## A. Export HTML (round-6 fixes)

Set up: create a folder with a doc `export-test.md` plus a real `pic.png` (any PNG)
and a `pic.svg` (any SVG) next to it.

- [ ] **A1 — SVG embedded (was: literal text).** Reference both via
  `![png](pic.png)` and `![svg](pic.svg)` → File/Export HTML → save → open the
  HTML offline. Expected: BOTH visible offline; View Source contains
  `data:image/png;base64,…` and `data:image/svg+xml;base64,…`. Root cause of
  the round-6 failure: markdown-it rejected `data:image/svg+xml` link targets,
  so the SVG rendered as literal `![svg](data:…)` text. No skip alert appears
  when everything embeds.
- [ ] **A2 — Unsaved doc aborts (was: warned but still exported).** With an
  unsaved `untitled.md` containing `![png](pic.png)` → File/Export HTML.
  Expected: the unsaved-document alert appears AND **no save dialog opens, no
  file is written**. (Behavior change vs round 6: the export is now aborted
  instead of writing a broken file. An unsaved doc whose images are ALL remote
  `https://…` still exports normally.)
- [ ] **A3 — Spoilers visible in exported-HTML print (was: missing).** Doc with
  `||secret||` → Export HTML → open the file → Print Preview. Expected: white
  background, black text, no copy-buttons on code blocks, spoiler text shown
  as plain readable text.

## B. Export PDF (round-6 fix)

- [ ] **B1 — Spoilers visible in PDF print (was: missing).** Doc with
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

- [ ] **C1 — TXT/Markdown (lossless, no warning list).** Import a `.txt` file.
  Expected: dialog says "No formatting will be lost."; content lands verbatim
  as `<name>.md`, dirty.
- [ ] **C2 — HTML.** Import a saved web page / `.html` with headings, bold,
  a list, a table. Expected: loss dialog lists scripts/styles/layout/images/fonts;
  result is readable markdown (headings `#`, `-` bullets, table pipes).
- [ ] **C3 — DOCX.** Import a Word `.docx` with headings + bold + a list.
  Expected: loss dialog mentions images/fonts/headers/footnotes; text imports
  with headings and list intact.
- [ ] **C4 — PDF.** Import a text-based `.pdf` (1–2 pages). Expected: loss dialog
  mentions images/layout/fonts/scanned-PDF caveat; text extracts in reading
  order (layout may flatten — acceptable, note it with `-#`).
- [ ] **C5 — RTF.** Import an `.rtf` with bold/italic/paragraphs. Expected:
  paragraphs survive; loss dialog notes the minimal converter (embeds/fonts/
  underline lost).
- [ ] **C6 — Cancel paths (untested in round 6).** Start Import of a DOCX but
  press [Cancel], then again with Esc, then again via backdrop click. Expected:
  all three abort, current doc untouched, no error.
- [ ] **C7 — Encrypted/corrupt file (untested in round 6).** Import a
  password-protected PDF or a renamed non-DOCX `.docx`. Expected: a readable
  "Import failed: …" alert, no hang, doc untouched.

## D. Browser dev mode gaps (round-6 fix + expected behavior)

- [ ] **D1 — Paste-image warns (was: silent).** In `npm run dev` (Chromium),
  paste an image from the clipboard into the editor. Expected: a visible alert
  explains paste-image needs the Tauri desktop app; nothing is inserted.
- [ ] **D2 — Import dialog appears in browser too.** In `npm run dev`, run one
  Import (use TXT). Expected: the loss dialog appears and the import completes
  (PDF/DOCX parse in-page; large files may be slow — note timing with `-#`).

## E. Open product question (needs your go-ahead)

- [ ] **E1 — Support link.** File/About → "Support Notedown" still points at an
  `example.com/...-TODO` placeholder. Reply with the real Ko-fi / GitHub
  Sponsors / other URL (or "leave the placeholder") and it gets wired next round.

## F. Regression spot-checks

- [ ] **F1 — File menu order.** File menu reads: New, Open, Open Recent,
  Import…, — Save, Save as, Export HTML…, Export PDF…, — Settings, Help, About.
- [ ] **F2 — Old shortcuts unchanged.** `Mod+Shift+E` still exports HTML;
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
