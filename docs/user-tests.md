# Notedown — User Test Checklist

Focused manual QA for current features. Check `[ ]` after verifying; add a subtext `-#` below an item if anything deviates.

## Tester info

- Date:
- Platform (Windows 11 / macOS / Linux / Android / iOS):
- Build/version:
- Mode tested (browser dev / Tauri dev / built installer):
- Hotkey convention (Ctrl on Windows/Linux, Cmd on macOS):

## Test conventions

- `Mod` = **Ctrl** on Windows/Linux, **Cmd** on macOS.
- Test update checks against a real published release, or temporarily stub the GitHub API response.

---

## Check for updates

- [ ] **U1 — Manual check from the File menu.** File → Check for updates… opens the dedicated **Check for updates** dialog (it must **not** open the About dialog) and runs a fresh check. It finishes with either "you're up to date" (current version shown) or the newer version number plus a download action — never a blank/stuck state. Closing the dialog restores the editor caret and focus.

  - [ ] **U1b — About has no update controls.** File → About shows only the app name, version, summary, and the "Support Notedown" (GitHub Sponsors) link — no update status, installer/release-notes links, or auto-check toggle.

- [ ] **U2 — Update available → installer + release notes.** With a newer release published (or mocked), the Check for updates dialog shows the newer version and a download button/link. Clicking it opens the correct OS installer in the **external browser** — `.msi` on Windows, `.dmg` on macOS, `.AppImage` on Linux — and does not navigate the app webview or download in-app. The release-notes link opens the matching `github.com/CodeCody93/Notedown/releases/...` page. Verify the URL is `https://` and points at the Notedown repository (no arbitrary redirect).

- [ ] **U3 — Opt-in checkbox sync (default off).** Settings → Updates and the Check for updates dialog show the same "check automatically" checkbox. On a fresh profile it is **off** by default. Toggling it in either place updates the other immediately (reopen the other surface to confirm), persists across restart, and enabling it triggers exactly one immediate check even when the 24h throttle has not elapsed / the last check was recent. Disabling it stops future automatic checks.

- [ ] **U4 — 24h throttle + status-bar pill.** With auto-check on and a `lastUpdateCheckAt` older than 24h, startup runs one silent check; launching again within 24h runs none (confirm via the network panel). When a newer release is found, the status-bar pill appears reading `Update X.Y.Z available`. Clicking the pill opens the Check for updates dialog showing the **cached** result and performs no new network request.

- [ ] **U5 — Offline / rate-limited.** Disconnect the network (or exhaust the GitHub unauthenticated rate limit), then run a manual check: the Check for updates dialog shows a short, friendly error (no raw JSON/stack trace) and the app remains fully usable. An automatic/startup check fails silently — no dialog, no pill, and `lastUpdateCheckAt` is not advanced by the failure, so the next eligible startup retries.

- [ ] **U6 — CSP + web parity.** In the built desktop installer, the check succeeds under the production Tauri CSP and DevTools shows **no** `connect-src` / CSP violation for `https://api.github.com`. In the GitHub Pages web app the same check succeeds (public GitHub API, CORS allowed), and an available update's download/release link opens in a new tab rather than replacing the editor.

## Notes

- The app never downloads or installs updates itself; it only opens external URLs through the platform layer.
- GitHub's unauthenticated API is rate-limited per IP — repeated QA runs can hit the limit; wait or use another network before treating U5 as a bug.

---

## Embed toolbar

Exercise these in `examples/embed-demo/` (`npm run demo:embed`) or a host page
that mounts `@codecody93/notedown-editor`.

- [ ] **E1 — Full preset menus.** Create an editor with `toolbar: { preset: 'full' }`. The toolbar shows undo/redo, inline styles including underline, Header, List, and Extra dropdowns, and the mode toggle. Header lists Paragraph plus H1–H6; List lists bulleted, numbered (decimal/alpha/roman), and task lists; Extra includes the nested Graph submenu with pie, bar, and line leaves. The compact `toolbar: true` toolbar is not mixed in.

- [ ] **E2 — Extra menu in a short editor.** Give the mount a 220 px height (the minimum) and open Extra. The menu stays fully visible — it scrolls or flips above the button as needed — with no clipped items and no menu hidden behind the editor edge. Repeat near the right edge of the window.

- [ ] **E3 — Themes style popovers.** Switch through `light`, `dark`, `system` (with the OS toggled both ways), and `inherit` (with host variables overridden on `.notedown-editor-root`). Open a dropdown in each: the panel background, text, borders, hover state, and nested submenu arrow all match the theme, with readable contrast. No panel keeps the previous theme's colors.

- [ ] **E4 — Menus dismiss.** Open a dropdown, then press Escape, click outside the toolbar, scroll the page, and resize the window in separate runs. Each action closes the open menu (including an open nested submenu) and leaves no stray popover behind. After closing, the editor remains usable and no focus trap blocks typing.

- [ ] **E5 — Commands edit content and keep selection.** Select a word, then apply bold, underline, H2, bulleted list, numbered list, blockquote, inline code, and code block from the toolbar. Each changes the Markdown/source content (verify in source mode) and the original selection or caret context remains usable; pressing a toolbar button never collapses or loses the selection before the command runs. The table item inserts a 3×3 GFM table template, and the graph leaves insert starter chart syntax (no app-style builder dialogs appear).

- [ ] **E6 — Emoji picker.** Open the emoji picker from Extra, type a search term (for example "smile"), and insert a result. The emoji is inserted at the caret, the editor keeps the document content otherwise intact, and clicking outside or pressing Escape closes the picker.

- [ ] **E7 — Multiple embeds stay scoped.** Mount two editors with full toolbars on one page. Commands and mode changes apply only to the editor whose toolbar was used; each dropdown positions against its own toolbar; opening a popover in one editor closes another editor's open popover (single-popover behavior), and no listener or menu state leaks between them.

- [ ] **E8 — Destroy with a menu open.** Open a dropdown (or the emoji picker), then call `editor.destroy()`. The popover and toolbar disappear immediately, no error is thrown, and interacting with the page afterward (click, keydown, scroll, resize) triggers no stale listeners or console errors. Calling `destroy()` again stays a no-op.

- [ ] **E9 — Compact toolbar unchanged.** Create an editor with `toolbar: true`. The toolbar still renders exactly the original six groups — undo/redo, bold/italic/strikethrough, H1/H2, bulleted/numbered list, link/inline code, mode — with no dropdown buttons.
