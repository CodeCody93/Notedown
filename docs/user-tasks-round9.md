# Notedown — User Test Checklist (Round 9: unified Export + RTF rework)

Covers the round-8 feedback: the unified Export dialog (replacing the
separate Export HTML / Export PDF menu items, per your Other Notes 1),
the full RTF import rework (`docs/rtf-source.rtf`), and DOCX task lists.
Everything else from Rounds 2–8 was verified and is covered by the
automated suite (403 Vitest tests green, `npm run typecheck` +
`cargo check` + `npm run tauri build` clean) — re-test old items only if
something below looks broken.

## How to run

| Surface | Command | Notes |
|---|---|---|
| Browser dev mode | `npm run dev` then open URL | **Chromium only** (Chrome/Edge). Dev/test surface, not production. |
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

## A. Unified Export dialog (was: separate Export HTML / Export PDF items)

Behavior change: File menu now has ONE `Export…` item (hotkey
`Mod+Shift+E`). It opens a dialog listing TXT, HTML, PDF, DOCX, RTF with
each format's loss warnings shown live; [Export] proceeds, [Cancel]/Esc/
backdrop-click aborts. `Ctrl+P` / `Cmd+P` is no longer hijacked — it is
native print again.

- [ ] **A1 — Dialog + menu order.** File menu reads: New, Open, Open Recent,
  Import…, — Save, Save as, Export…, — Settings, Help, About. `Mod+Shift+E`
  opens the Export dialog. Expected: five format radios in TXT/HTML/PDF/
  DOCX/RTF order; selecting each one updates the loss list underneath
  (TXT shows "No formatting will be lost.").
- [ ] **A2 — Cancel paths.** Open Export…, press [Cancel]; again with Esc;
  again via backdrop click. Expected: all three abort, no save/print dialog
  appears, current doc untouched, no error.
- [ ] **A3 — TXT export.** Export a doc as `.txt`. Expected: saves the
  verbatim markdown source (fully reversible — re-import it as TXT/Markdown
  with NO loss dialog, content identical).
- [ ] **A4 — HTML export (unchanged path).** Export a doc with a local image
  as `.html`, open offline. Expected: images embedded as `data:…`, works
  offline (round-7 A1 guard); unsaved doc with local images still aborts
  with the save-first alert; remote/absolute images still reported skipped.
- [ ] **A5 — PDF export is TEXT (was: suspected "image" PDF).** Export a doc
  as PDF → destination "Save as PDF". Expected: the same inlined standalone
  document as A4 goes to the OS print dialog (spoilers revealed, link URLs
  shown, no copy-buttons); the resulting PDF has SELECTABLE text — import
  that PDF back and the words come back (layout may flatten — acceptable).
  An unsaved doc with local images aborts with the save-first alert (same
  as HTML).
- [ ] **A6 — RTF export (new).** Export a doc with headings, bold/italic,
  a list and a table as `.rtf`; open in Word/WordPad. Expected: headings,
  bold/italic, lists and table text all present and styled; then Import
  that `.rtf` back — headings become `#` lines, bold/italic survive
  (`**`/`*`), lists come back as `-`/`1.` lines.
- [ ] **A7 — DOCX export (new).** Export the same doc as `.docx`; open in
  Word/Google Docs. Expected: headings use real Heading styles,
  bold/italic/lists present; then Import that `.docx` back — headings and
  lists survive. (Lists export as literal `- `/`1. ` prefixes by design,
  noted in the dialog — flag it with `-#` if Word shows anything odd.)
- [ ] **A8 — Export never touches the current file.** After every export
  above: no dirty dot appears/disappears, the doc path/name in the status
  bar is unchanged, and no draft-recovery prompt appears on restart.

## B. Import RTF rework (was: completely broken — see docs/rtf-source.rtf)

Set up: reuse `docs/rtf-source.rtf` (WordPad: bold, italic, underline,
strikethrough, combined, paragraphs, bulleted + numbered lists,
subscript, superscript, highlight).

- [ ] **B1 — Full rework.** File/Import… → pick `docs/rtf-source.rtf` →
  loss dialog notes the minimal converter → [Import anyway]. Expected
  markdown:
  `**bold**`, `*italic*`, plain `underline`, `~~strikethrough~~`,
  combined `all` line with balanced markers, `paragraph`, three
  `- Unordered List` lines, `1. List` / `2. List` / `3. List`,
  `~subscript~ text`, `^superscript^ text`, `==highlight==`.
  No line consists of lone `**`/`*`/`~~`/`==`; no `\b`/`\par` literals;
  no style overflows into the next paragraph.
- [ ] **B2 — Round-trip.** Export the imported result back to `.rtf` (A6)
  and re-import it. Expected: the words and most markers survive both
  trips (underline stays plain text throughout — by design, noted in
  the dialog).

## C. DOCX task lists (was: checkboxes lost)

- [ ] **C1 — Checkboxes.** Only if you have Word/Google Docs: make a `.docx`
  with a checklist (checked + unchecked) plus headings, import it.
  Expected: headings survive; checklist items arrive as `- [ ]`/`- [x]`
  task lines, or — if Word dropped the boxes — as plain bullets (note
  with `-#`; the loss dialog warns checkboxes may simplify). If no file
  available, mark `-# Untested (no file)` — not a failure.

## D. Regression spot-checks

- [ ] **D1 — Import untouched.** One TXT import still skips the loss dialog;
  one HTML import still warns; E2/E3/E5 cancel/corrupt/discard paths from
  round 8 still behave.
- [ ] **D2 — Old shortcuts.** `findDuplicateChords` guard green in CI;
  `Mod+Shift+E` opens Export; `Mod+P` is native print (no app dialog).

---

## Notes

- Export never overwrites the current file: TXT/HTML/RTF/DOCX always go
  through a save dialog for a NEW file; PDF goes through the OS print
  dialog. The current doc's dirty state, path and name are untouched.
- TXT export is the verbatim markdown source (lossless, fully reversible).
  HTML embeds local images as `data:` URLs. PDF prints that same document
  as TEXT (selectable, re-importable) — never an image.
- DOCX/RTF use minimal built-in converters (zero new dependencies):
  headings, bold/italic, lists, code and basic tables survive; images are
  dropped (no files created); exact fonts/colors/spacing/layout are not
  preserved; spoilers render revealed; dropdowns expand statically
  (title + body); `-# ` subtext and footnote definitions stay literal so
  they re-import.
- RTF import now maps `\strike`→`~~`, `\sub`/`\super`→`~`/`^`,
  `\highlight`→`==`; underline has no Markdown equivalent and stays plain
  text; WordPad bullets normalize to `- `, ordered numbers are kept.
- About → "Support Notedown" placeholder stays as-is per your round-7
  answer ("leave the placeholder") — not retested this round.

---

## E. Graphs (class-based chart selectors — :has() removal)

Graph chart rows no longer rely on the CSS `:has()` relational selector:
`graph.ts` now emits explicit modifier classes on the chart div
(`md-graph-chart-pie` for pie, `md-graph-chart-plot` for bar/line) and both
stylesheets (`src/app/export.ts` MARKDOWN_BODY_CSS + `src/styles/editor.css`)
target those classes verbatim. Test on BOTH surfaces: Chromium dev
(`npm run dev`) and Tauri Windows (dev or built installer).

- [ ] **E1 — Sample doc renders all three types.** Open
  `docs/graph-sample.md` in Live mode. Expected: pie shows a disc plus side
  legend column; bar shows bars on a y-scaled grid with tick labels; line
  shows slanted segments with dots and x labels — no collapsed/sliver
  charts, no empty band under a pie.
- [ ] **E2 — Insert via menu + hotkey.** With the caret on an empty line, use
  the Extra → Graph submenu to insert each type; then insert one more with
  `Mod-Shift-G`. Expected: each insertion drops a valid `%% ... %%` tag that
  renders immediately when the caret leaves the line.
- [ ] **E3 — Dark mode.** Switch to the dark theme and re-check E1.
  Expected: all three chart types follow the theme tokens (surface, text,
  muted, accent) with readable labels — no hard-coded light colors.
- [ ] **E4 — Print-to-PDF keeps colors.** Export the sample doc as PDF →
  destination "Save as PDF". Expected: pie disc, bar fills and line segments
  keep their colors in the PDF (not flattened to grey/black).
- [ ] **E5 — Mobile webview render (if hardware available).** Open the sample
  doc on Android and/or iOS. Expected: pie (conic-gradient), line segments
  (clip-path with CSS vars) and bar/line grids render as on desktop — there
  is no `:has()` left in either stylesheet, so older webviews are no longer
  gated on relational-selector support. Note with `-#` if anything differs.
- [ ] **E6 — CRLF doc with graphs.** Save a doc containing one of each graph
  tag with CRLF line endings, reopen. Expected: all three graphs still parse
  and render (no literal `%%` text, no broken figures).
- [ ] **E7 — Export HTML round-trip.** Export the sample doc as `.html`, open
  it offline, then Import that `.html` back. Expected: the exported file
  shows all three charts offline; the re-imported markdown contains the
  original `%%` tags (via the hidden data table) and re-renders identically.
- [ ] **E8 — Malformed tag error box.** Type a broken tag (e.g.
  `%% pie without numbers %%` or an unclosed `%% bar`). Expected: a bare
  `md-graph-chart` error box (no pie/plot modifier styling) describing the
  problem, no crash, surrounding content renders normally; fixing the tag
  renders the chart.
