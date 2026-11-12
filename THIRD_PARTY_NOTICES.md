# Third-party notices

Notedown is MIT-licensed, but it bundles and depends on open-source software
maintained by other people. This file lists the major runtime dependencies and
their licenses. The complete dependency tree, including transitive packages and
exact resolved versions, is recorded in [`package-lock.json`](package-lock.json)
for the frontend and [`src-tauri/Cargo.lock`](src-tauri/Cargo.lock) for the Rust
backend. Dev-only tooling is listed separately and is not shipped in release
bundles.

## Editor and language tooling

| Package | License | Notes |
| --- | --- | --- |
| `@codemirror/*`, `@lezer/*` | MIT | CodeMirror 6 editor, language support, search, and state packages |
| `codemirror-live-markdown` | MIT | Pinned `0.5.1-alpha.1`; forked/wrapped behind `src/editor/livePreview.ts` |

## Markdown rendering and sanitizing

| Package | License | Notes |
| --- | --- | --- |
| `markdown-it` | MIT | Markdown renderer |
| `markdown-it-attrs` | MIT | Attribute syntax plugin |
| `markdown-it-deflist` | MIT | Definition lists |
| `markdown-it-emoji` | MIT | Emoji shortcodes |
| `markdown-it-footnote` | MIT | Footnotes |
| `markdown-it-mark` | MIT | Highlight syntax |
| `markdown-it-sub` | MIT | Subscript |
| `markdown-it-sup` | MIT | Superscript |
| `markdown-it-task-lists` | ISC | Task list checkboxes |
| `highlight.js` | BSD-3-Clause | Code-block syntax highlighting |
| `dompurify` | MPL-2.0 OR Apache-2.0 | HTML sanitizer applied to every markdown-it HTML render |

## Server rendering (optional)

| Package | License | Notes |
| --- | --- | --- |
| `jsdom` | MIT | Optional runtime peer for `@codecody93/notedown-editor/render`; also used as the Vitest DOM test environment |

## Import, export, and file handling

| Package | License | Notes |
| --- | --- | --- |
| `pdf-lib` | MIT | PDF generation |
| `pdfjs-dist` | Apache-2.0 | PDF text extraction and rendering |
| `mammoth` | BSD-2-Clause | DOCX import |
| `turndown` | MIT | HTML-to-Markdown conversion |
| `turndown-plugin-gfm` | MIT | GFM tables/strikethrough rules |
| `@tauri-apps/api` | Apache-2.0 OR MIT | Tauri v2 frontend API |
| `@tauri-apps/plugin-opener` | MIT OR Apache-2.0 | Opens external URLs |

## Desktop runtime

The Tauri v2 Rust crates in `src-tauri/Cargo.lock` are predominantly licensed
under MIT and/or Apache-2.0. Notable crates and their families include
`tauri`, `tauri-build`, `tauri-plugin-opener`, `tauri-plugin-dialog`,
`tauri-plugin-single-instance`, `serde`, `serde_json`, and `base64`. Refer to
`Cargo.lock` and the individual crate manifests for the authoritative license
of each dependency.

## Development-only tooling (not shipped)

| Package | License | Notes |
| --- | --- | --- |
| `vite` | MIT | Frontend build and dev server |
| `vitest` | MIT | Test runner |
| `typescript` | Apache-2.0 | Type checker and declaration emit |
| `@types/markdown-it` | MIT | Type declarations |

## Full dependency tree

`package-lock.json` is the source of truth for the exact npm dependency graph
and resolved versions used by `npm ci`; `src-tauri/Cargo.lock` does the same for
the Rust side. If a dependency's license changes upstream, the lockfile and the
upstream package are authoritative for that release. When updating a dependency
in a way that changes this summary, update this file in the same pull request.
