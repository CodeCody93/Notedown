# Notedown — User Test Checklist (Round 6: Phase 3 File Menu)

Covers all Phase 3 work: Export HTML fixes, Export PDF (new), Import (new),
Help (new), About (new). Everything from Rounds 2–5 was already verified and
is covered by the automated suite (357 Vitest tests green) — re-test old items
only if something below looks broken.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. Import works here (file picker); image embedding does NOT (expected, item F3). |
| Tauri desktop (dev) | `npm run tauri dev` | Requires Rust toolchain + VS Build Tools. |
| Tauri desktop (built) | `npm run tauri build` | Produces `Notedown_0.2.0_x64-setup.exe` / `.msi`. Preferred surface for this round. |

## Tester info

- Date: 9/5/2026
- Platform (Windows 11 / macOS / Linux): Windows 10
- Build/version: 0.3.0 dev
- Mode tested (browser dev / Tauri dev / built installer): Built Installer
- Hotkey convention (Ctrl on Windows/Linux, Cmd on macOS): Ctrl

## Test conventions

- `Mod` = **Ctrl** on Windows/Linux, **Cmd** on macOS.
- Check `[ ]` after verifying Expected. Add a subtext `-#` below the item if anything deviates.

---

## A. Export HTML (fixed — image matrix)

Set up: create a folder with a doc `export-test.md` plus a real `pic.png` (any PNG)
and a `pic.svg` (any SVG) next to it.

- [x] **A1 — PNG and SVG embedded (fix round 2).** Reference both via
  `![png](pic.png)` and `![svg](pic.svg)` → File/Export HTML → save → open the
  HTML offline. Expected: BOTH visible offline; View Source contains
  `data:image/png;base64,…` and `data:image/svg+xml;base64,…`. SVGs are
  DOMPurify-sanitized before embedding (scripts stripped — safe). No skip
  alert appears when everything embeds.
-# SVGs are not encoded as base64 correctly. But when viewed in HTML they are displayed as text (![svg](data:image/svg+xml;base64,... etc) rather than as a visable image.
- [x] **A2 — Raw-HTML and reference-style images.** Add
  `<img src="pic.png" alt="h">` and a reference image — IMPORTANT: put a
  **blank line** between the usage and the definition (standard Markdown —
  a definition cannot interrupt a paragraph, GitHub behaves the same):
  `![ref][r]`, blank line, then `[r]: pic.png` → Export HTML. Expected: both
  embedded as `data:image/png` (View Source shows 3 PNG data URLs total with
  A1's). Reference definitions exist so one image can be reused many times
  without repeating its path — that is their purpose, kept deliberately.
- [x] **A3 — Remote images reported, not broken silently.** Add
  `![web](https://example.com/x.png)` → Export HTML. Expected: export succeeds;
  alert lists it as skipped `(remote)`; the exported file shows alt text (CSP
  blocks remote loads by design).
- [x] **A4 — Unsaved doc warns.** With an unsaved `untitled.md` containing
  `![png](pic.png)` → Export HTML. Expected: alert mentions the unsaved-document
  reason (local images cannot resolve without a saved doc path).
-# Warning is displayed correctly. However file is still exported regardless.
- [x] **A5 — Small images not blown up.** Include a tiny icon PNG. Expected: it
  renders at natural size in the export (previously forced to full width).
- [x] **A6 — Print stylesheet present.** Open the exported HTML → Print Preview.
  Expected: white background, black text, no copy-buttons on code blocks,
  spoilers revealed as plain text.
-# All working except spoiler text is missing when trying to print from an exported HTML file.

## B. Export PDF (new — print dialog)

- [x] **B1 — Menu + hotkey.** File menu shows `Export PDF…` with hint `Ctrl+P`
  (Win/Linux) / `Cmd+P` (mac). Pressing `Mod+P` opens the print dialog — NOTE:
  inside Tauri this IS the Chromium/WebView2 print dialog (same look as the
  browser's), which is expected: it prints the exported document (not the app
  shell), and its "Save as PDF" destination is the PDF.
-# All working. However spoiler text is missing in the print preview just like the issue described in A6.
- [x] **B2 — Save as PDF with images.** Doc with `![png](pic.png)`, a code block,
  a table, a dropdown (`>>> Title`…`>>>`). File/Export PDF… → destination
  "Save as PDF" / "Microsoft Print to PDF". Expected: PDF contains the image,
  code, and table; no copy-buttons; links show their URLs in parentheses.
- [x] **B3 — Cancel is safe.** Open Export PDF then cancel the dialog. Expected:
  no error, doc untouched.

## C. Import (new — all formats + loss dialog)

For each file below: File/Import… → pick the file → a dialog lists what may be
lost → [Import anyway] loads it as a new unsaved `*.md` doc (dirty dot on);
[Cancel]/Esc/backdrop-click aborts with the current doc untouched. If the
current doc has unsaved changes, a discard-confirm comes FIRST — verify with a
dirty doc once (use TXT for that run).

- [ ] **C1 — TXT/Markdown (lossless, no warning list).** Import a `.txt` file.
  Expected: dialog says "No formatting will be lost."; content lands verbatim
  as `<name>.md`, dirty.
-# No reaction. Nothing happens.
- [ ] **C2 — HTML.** Import a saved web page / `.html` with headings, bold,
  a list, a table. Expected: loss dialog lists scripts/styles/layout/images/fonts;
  result is readable markdown (headings `#`, `-` bullets, table pipes).
-# No reaction. Nothing happens.
- [ ] **C3 — DOCX.** Import a Word `.docx` with headings + bold + a list.
  Expected: loss dialog mentions images/fonts/headers/footnotes; text imports
  with headings and list intact.
-# No reaction. Nothing happens.
- [ ] **C4 — PDF.** Import a text-based `.pdf` (1–2 pages). Expected: loss dialog
  mentions images/layout/fonts/scanned-PDF caveat; text extracts in reading
  order (layout may flatten — acceptable, note it with `-#`).
-# No reaction. Nothing happens.
- [ ] **C5 — RTF.** Import an `.rtf` with bold/italic/paragraphs. Expected:
  paragraphs survive; loss dialog notes the minimal converter (embeds/fonts/
  underline lost).
-# No reaction. Nothing happens.
- [ ] **C6 — Cancel paths.** Start Import of a DOCX but press [Cancel], then
  again with Esc. Expected: both abort, current doc untouched, no error.
-# Untested.
- [ ] **C7 — Encrypted/corrupt file.** Import a password-protected PDF or a
  renamed non-DOCX `.docx`. Expected: a readable "Import failed: …" alert, no
  hang, doc untouched.
-# Untested.

## D. Help (new — in-app modal)

- [x] **D1 — Opens with summary + TOC.** File/Help. Expected: modal with a short
  summary, a table of contents, and one section per feature; each section shows
  an example, `syntax` (e.g. `**text**`), and the correct hotkey
  (spot-check Bold `Ctrl+B`, Subscript `Ctrl+Alt+J`, Export PDF `Ctrl+P`).
- [x] **D2 — TOC jumps + close paths (fix round 2).** Click a TOC link (jumps to
  the section); close via ×, backdrop click, and Esc (all three). Expected:
  focus returns to the editor AND the caret is back where it was before the
  dialog opened (same fix applied to About and Settings).

## E. About (new — dialog + placeholder link)

- [x] **E1 — Content.** File/About. Expected: "Notedown", `Version 0.2.0`,
  one-paragraph summary, a "Support Notedown" link, Close button.
- [x] **E2 — Placeholder noted.** Clicking the support link goes to an
  `example.com/...-TODO` placeholder (EXPECTED for this round — the real
  Ko-fi/Sponsors URL gets wired on your go-ahead). Close via Esc.

## F. Regression spot-checks (Phase 3 touched shared code)

- [x] **F1 — File menu order.** File menu reads: New, Open, Open Recent,
  Import…, — Save, Save as, Export HTML…, Export PDF…, — Settings, Help, About.
- [x] **F2 — Old shortcuts unchanged.** `Mod+Shift+E` still exports HTML;
  `findDuplicateChords` guard is green in CI (no hotkey collisions).
- [x] **F3 — Browser dev mode (expected gaps, not bugs).** Paste-image warns and
  no-ops; local images render raw; Import works but PDF/DOCX parse in-page
  (large files may be slow — note timing with `-#`).
-# Pasting images does not seem to do anything, no warning and no image insertion. Same with importing there is no visible indication that anything happened.

---

## Notes

- Export embeds local `png/jpg/gif/webp/bmp` as `data:` URLs; `svg`/remote/
  absolute/rooted sources are skipped BY DESIGN (security/CSP) and now REPORTED
  in an alert instead of failing silently.
- Export PDF is the OS print dialog (`window.print()` of the exported HTML in a
  hidden frame) — pagination and headers/footers are browser-controlled.
- Import never overwrites the current file: results always load as a new dirty
  untitled-path doc; binary formats (PDF/DOCX) are read as bytes via the new
  `pick_and_read_bytes` Rust command on desktop.
- Help hotkey hints render through the single `shortcuts.ts` map, so they stay
  in sync automatically. About version is the `APP_VERSION` constant (`0.2.0`).
