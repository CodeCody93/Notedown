# Changelog

All notable changes to Notedown are documented in this file. The project follows
[Semantic Versioning](https://semver.org/) and the format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.8.1] - 2026-11-21

### Changed

- **Dedicated update-check dialog.** Update checking moved out of the About
  dialog into its own Check for updates dialog, with the same layout, version
  line, installer/release-notes links, and auto-check toggle. The status-bar
  "Update X.Y.Z available" pill opens the same dialog with the cached result.
  About now shows only the app summary and the "Support Notedown" link.

### Fixed

- **Navigator navigation lands at the top.** Clicking a heading in the Navigator
  panel now always scrolls that heading to the top of the viewport (clamped near
  the end of the document) instead of using CodeMirror's default minimal scroll,
  which aligned it to whichever edge — top or bottom — happened to be closer.

## [0.8.0] - 2026-11-16

### Added

- **Built-in update checks.** File → Check for updates… and the About dialog
  query the latest published GitHub release, compare it with the bundled
  version, and report either "you're on the latest version" or the newer
  version with a platform-matched installer link (`.msi` on Windows, `.dmg` on
  macOS, `.AppImage`/`.deb` on Linux) and a release-notes link. When no
  installer matches the platform, the release page is offered instead. The app
  never downloads or installs updates itself: links open through the OS
  browser via the platform layer.
- **Optional automatic checks.** Settings → Updates adds an opt-in "Check for
  updates automatically" toggle (off by default), mirrored in the About dialog.
  Automatic checks run at most once every 24 hours, and a newer release adds an
  "Update X.Y.Z available" pill to the status bar that opens the cached result
  without another network request.
- **Support links.** The About dialog's GitHub Sponsors link is now labeled
  "Support Notedown", and `package.json` plus the generated embed package
  advertise the Sponsors page through npm `funding` metadata.

### Changed

- **About dialog refresh.** The dialog now includes update status, installer
  and release-note links, the auto-check toggle, and the version read from the
  shared update module so it cannot drift from the release.
- **GitHub Releases publish automatically from `main`.** The Build workflow
  reads the version from `package.json` on every push to `main`; when that
  version has no published release yet, it builds the installers, attaches them
  to a draft release, and publishes it once all three platform builds succeed.
  `v*` tags still work and go through the same version gate, so tagging is
  optional, and an already-published version only produces build artifacts
  instead of a second release.
- **App identifier.** The Tauri identifier is now `com.codecody93.notedown`,
  which resolves the macOS bundle warning from the old `com.notedown.app`
  suffix. Settings, recents, and drafts stored under the old identifier are not
  migrated.
- **Update-check network allowlist.** The production desktop CSP now permits
  `https://api.github.com` in `connect-src` so update checks work in packaged
  builds; no other network access was added.

## [0.7.6] - 2026-11-16

### Fixed

- **Blurry text while scrolling on Linux.** WebKitGTK's smooth scrolling
  animates the scroll offset through fractional pixel positions, which made
  text look blurry on alternating mouse-wheel steps. The desktop app now
  disables WebKitGTK smooth scrolling on Linux (touchpad and touch scrolling
  are unaffected).
- **App window froze on startup when a draft was waiting to be recovered
  (Linux).** Native dialogs were opened from Tauri's synchronous command
  path, which runs on the GTK main thread; the blocking dialog call then
  deadlocked the event loop, so the window rendered but could not be moved or
  accept input, and the recovery prompt never appeared. All dialog commands
  now run off the main thread, so the recovery prompt shows up and
  Open/Save/Import/Export and alert dialogs no longer freeze the app.

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
