# Notedown — User Test Checklist (Round 8: Round-7 fixes retest)

Covers the round-7 feedback fixes (lossless-import dialog skip, HTML import
upgrades, PDF empty-import hardening, RTF bold fix, paste-image wording,
Import filter default). Everything else from Rounds 2–7 was verified and is
covered by the automated suite (385 Vitest tests green, `npm run typecheck` +
`cargo check` clean) — re-test old items only if something below looks broken.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. |
| Tauri desktop (dev) | `npm run tauri dev` | Requires Rust toolchain + VS Build Tools. |
| Tauri desktop (built) | `npm run tauri build` | Produces `Notedown_0.1.0_x64-setup.exe` / `.msi`. Preferred surface for this round. |

## Tester info

- Date: 9/6/2026
- Platform (Windows 11 / macOS / Linux): Windows 10
- Build/version: 0.2.0 dev
- Mode tested (browser dev / Tauri dev / built installer): Built installer
- Hotkey convention (Ctrl on Windows/Linux, Cmd on macOS): Ctrl

## Test conventions

- `Mod` = **Ctrl** on Windows/Linux, **Cmd** on macOS.
- Check `[ ]` after verifying Expected. Add a subtext `-#` below the item if anything deviates.

---

## A. Import lossless — no dialog (was: warning with nothing to lose)

- [x] **A1 — TXT/Markdown imports with NO dialog.** Import a `.txt` file (then
  a `.md` file). Expected: NO loss dialog appears at all — content lands
  directly as a new unsaved `<name>.md` doc, dirty dot on. (Behavior change vs
  round 7: the "No formatting will be lost" dialog is gone for lossless
  formats.)
- [x] **A2 — Lossy formats still warn.** Import an `.html` file. Expected: the
  loss dialog DOES appear with the scripts/styles/layout/images/fonts list;
  [Import anyway] loads it, [Cancel] aborts with the current doc untouched.

## B. Import HTML upgrades (was: no footnotes, no Notedown dialect, data-URL blob)

Set up: an `.html` file containing a heading, bold, a list, a table, a
footnote (`<sup class="footnote-ref"><a href="#fn1">[1]</a></sup>` plus a
`<section class="footnotes">` block or any saved web page with footnotes), plus
`<mark>hi</mark>`, `<sup>up</sup>`, `<sub>dn</sub>`, a
`<span class="md-spoiler">secret</span>`, a
`<details class="md-dropdown"><summary>Title</summary><p>body</p></details>`,
a `<p class="md-subtext">aside</p>`, a `<dl><dt>Term</dt><dd>Def</dd></dl>`,
and one `<img src="data:image/png;base64,…">`.

- [x] **B1 — Footnotes survive.** Expected: result contains `[^1]`-style refs
  inline plus `[^1]: …` definitions at the end (numbers may renumber —
  acceptable); no raw `<sup>`/`<section>` HTML left behind.
- [x] **B2 — Notedown dialect round-trips.** Expected: `==hi==`, `^up^`,
  `~dn~`, `||secret||`, `>>> Title` … `>>>` dropdown block, `-# aside`
  subtext line, and `Term` / `: Def` definition lines in the markdown.
- [x] **B3 — Embedded data: images stripped.** Expected: NO giant
  `![](data:…)` blob in the result; the image is gone (whitespace collapsed)
  and the loss dialog / post-import notes mention embedded `(data:)` images
  being stripped. Normal `http`/relative `<img>` behavior unchanged (dropped
  per the existing loss list).

## C. Import PDF hardening (was: sometimes no text, silent on encrypted)

- [x] **C1 — Previous failing PDF now imports.** Re-import the PDF from round 7
  that came back empty. Expected: text extracts in reading order (multi-column
  order and table structure may flatten — acceptable, note with `-#`); one
  paragraph per line group, pages separated by a blank line.
-# Please see Other Notes 1.
- [x] **C2 — Encrypted PDF fails readably.** Import a password-protected PDF
  (any PDF viewer can set a password: Print → Save as PDF with security, or
  use a sample). Expected: a readable "Import failed: Password-protected PDFs
  cannot be imported (…)" alert, no hang, current doc untouched.
-# Please see Other Notes 1.
- [x] **C3 — Scanned PDF stays honest.** Import an image-only/scanned PDF if
  available. Expected: imports as empty with the existing scanned-PDF caveat
  in the loss dialog (no error, no hang).
-# Please see Other Notes 1.

## D. Import RTF (was: closing `**` stranded on a new line)

- [x] **D1 — Bold stays inline.** Import an `.rtf` with bold/italic/paragraphs
  (WordPad: type "Hello", bold "bold", Enter, "world", save as `.rtf`).
  Expected: `Hello **bold**` with the closer on the SAME line as the text
  (a closer at end-of-line before a paragraph break, `**bold**` + newline, is
  correct); no line consists of a lone `**`; no `\b`/`\par` literals remain.
-# RTF import seems to be completely broken. Please see docs/rtf-source.rtf and the resulting docs/rtf-result.md for a before and after of RTF import. It looks as though, bold, italic, underline, strikethrough, lists, subscript, superscript and highlight all do not import correctly or overflow into each other. This import feature may require a full rework.
- [x] **D2 — Italic check.** Same file with an italic span. Expected: `*…*`
  closers likewise inline, paragraphs survive, loss dialog still notes the
  minimal converter (embeds/fonts/underline lost).
-# Please see sebtext note for D1.

## E. Import filters + cancel/corrupt paths (untested in rounds 6–7)

No Word install needed for most of this — use TXT where noted.

- [x] **E1 — Combined filter is default.** File/Import… → look at the file-type
  dropdown BEFORE picking. Expected: first/default entry reads
  `Importable Files (*.md, *.markdown, *.txt, *.html, *.htm, *.pdf, *.docx, *.rtf)`,
  followed by Markdown, HTML, PDF, Word, RTF, All files.
- [x] **E2 — Cancel paths (use TXT).** Start an Import and press [Cancel], then
  again with Esc, then again via backdrop click. Expected: all three abort,
  current doc untouched, no error. (DOCX-specific cancel is identical code —
  TXT exercises the same path.)
- [x] **E3 — Corrupt file fails readably.** Copy any `.txt` to `fake.docx` and
  import it; or import a renamed non-PDF `.pdf`. Expected: either a fallback
  raw-text import with an "additional notes" alert, or a readable
  "Import failed: …" alert — never a hang, current doc untouched on failure.
- [x] **E4 — DOCX (needs a real file).** Only if you have Word/Google Docs:
  export a doc with headings + bold + a list as `.docx` and import it.
  Expected: loss dialog mentions images/fonts/headers/footnotes; headings and
  list survive. If no file available, mark `-# Untested (no file)` — same as
  round 7, not a failure.
-# Looks like it is working except for task lists/check lists.
- [x] **E5 — Discard-confirm still first.** With a dirty doc, start a TXT
  import and decline the discard confirm. Expected: picker never opens, doc
  untouched.

## F. Browser dev-mode wording

- [x] **F1 — Paste-image alert exact text.** In `npm run dev` (Chromium), paste
  an image from the clipboard. Expected: alert reads VERBATIM
  "Pasting images is not supported in browser preview mode (there is no
  document folder to save into). Use the Notedown desktop app for paste-image
  functionality." Nothing is inserted.

## G. Regression spot-checks

- [x] **G1 — Old shortcuts unchanged.** `Mod+Shift+E` exports HTML; `Mod+P`
  opens Export PDF; `findDuplicateChords` guard green in CI.
- [x] **G2 — Export untouched.** One Export HTML of a doc with a local image
  still embeds `data:…` and works offline (round-7 A1 guard).

---

## Notes

- Import never overwrites the current file: results always load as a new dirty
  untitled-path doc; binary formats (PDF/DOCX) are read as bytes via the
  `pick_and_read_bytes` Rust command on desktop.
- Lossless formats (`.md`/`.markdown`/`.txt`) now skip the loss dialog
  entirely; lossy formats (`.html`/`.htm`/`.pdf`/`.docx`/`.rtf`) keep it.
- HTML import now maps `<mark>`→`==…==`, `<sup>`→`^…^`, `<sub>`→`~…~`,
  `md-spoiler` spans→`||…||`, `md-dropdown` details→`>>>…>>>`,
  `md-subtext`/`small`→`-# …`, definition lists→`Term`/`:` lines, and
  footnotes→`[^n]` refs + definitions; `<img src="data:…">` is stripped by
  design (noted in the dialog) instead of becoming a text blob.
- PDF text reconstruction follows pdfjs `hasEOL` line breaks; encrypted PDFs
  report "Password-protected PDFs cannot be imported (…)" instead of silence.
- RTF markers never strand alone on a line; bold spanning a paragraph break
  legitimately reopens on the next paragraph (`**a**` newline `**b**`).
- About → "Support Notedown" placeholder stays as-is per your round-7 answer
  ("leave the placeholder") — not retested this round.
  
## Other Notes
1. It has been discovered that PDF exporting has been exporting "image" PDFs which when imported again resulted in "blank" imports (since images where not imported). This has called into question the entire export workflow and I would like it redesigned like so: No longer have menu options for each export type. Rather have a unified "export" option (retaining the Mod+Shift+E hotkey) which opens an export dialog. From this dialog you should be able to chose from any of the export options (same list as import options: .txt, .html, .pdf, .docx and .rtf) where you can then chose and have it exported in the selected file type. If there is loss potential on the export then please warn the user before exporting. If possible these should be fully reversible exports when possible so no more "image" exports.
