# Changelog

All notable changes to Notedown are documented in this file. The project follows
[Semantic Versioning](https://semver.org/) and the format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.7.5] - 2026-11-13

### Added

- **Node server renderer.** The embed package now publishes
  `@codecody93/notedown-editor/render`, a Node-only subpath that renders
  Markdown without loading the browser editor.
  `renderMarkdown()` returns a sanitized HTML fragment, and
  `renderMarkdownDocument()` returns a complete standalone page mirroring
  File → Export HTML (theme, highlight themes, print CSS, CSP, and the
  spoiler/copy script).
- **Renderer helpers and CSS exports.** `createNotedownRenderer(sanitizeHtml)`
  accepts a custom DOMPurify configuration or DOM implementation, and
  `MARKDOWN_BODY_CSS`, `NOTEDOWN_THEME_CSS`, `HLJS_CSS_LIGHT`, and
  `HLJS_CSS_DARK` are exported for hosts that render the fragment themselves.
- **Optional `jsdom` peer.** Server rendering requires Node 20+ and `jsdom`;
  editor-only installs do not need it. The renderer reuses the exact editor
  markdown-it pipeline and DOMPurify sanitization, so all Notedown extensions
  render the same.

## [0.7.0] - 2026-11-12

First public release. The repository, desktop installers, web app, and embeddable
editor package are now MIT-licensed.

### Added

- **Web app on GitHub Pages.** The same Vite frontend is built as a static site
  and deployed to <https://codecody93.github.io/Notedown/> on pushes to `main`
  and `v*` tags.
- **Embeddable editor package.** `@codecody93/notedown-editor` is published to
  GitHub Packages, with TypeScript declarations, scoped CSS, and an
  unauthenticated CDN copy under the Pages site's `/embed/` path.
- **GitHub Sponsors.** The About dialog links to
  <https://github.com/sponsors/CodeCody93>, and `.github/FUNDING.yml` adds the
  repository Sponsor button.
- **Cross-browser save fallback.** Chromium keeps File System Access in-place
  saves; Firefox, Safari, and other browsers use a hidden file picker and
  download a copy of the document on save.
- **Inline paste images on the web.** Pasted images are embedded as `data:` URLs
  (about 2 MB maximum each) because the web target has no document folder; the
  desktop app continues to save image files next to the document.

### Changed

- License changed from proprietary to the MIT License for the whole repository
  and the embed package.
- `src/app/about.ts` reads the app version from the root `package.json` instead
  of a hardcoded string, and the About dialog opens the sponsor page through the
  platform layer (system browser on desktop, new tab on the web).
- Release automation now deploys the web app and publishes the embed package on
  `v*` tags alongside the existing draft desktop release.
- Added `CHANGELOG.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, and
  `docs/embedding.md`.

### Security

- Security reports should go through GitHub private security advisories; see
  [`SECURITY.md`](SECURITY.md).
