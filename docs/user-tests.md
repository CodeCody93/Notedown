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

- [ ] **U1 — Manual check from the File menu.** File → Check for updates… opens the About dialog and runs a fresh check. It finishes with either "you're up to date" (current version shown) or the newer version number plus a download action — never a blank/stuck state. Closing About restores the editor caret and focus.

- [ ] **U2 — Update available → installer + release notes.** With a newer release published (or mocked), About shows the newer version and a download button/link. Clicking it opens the correct OS installer in the **external browser** — `.msi` on Windows, `.dmg` on macOS, `.AppImage` on Linux — and does not navigate the app webview or download in-app. The release-notes link opens the matching `github.com/CodeCody93/Notedown/releases/...` page. Verify the URL is `https://` and points at the Notedown repository (no arbitrary redirect).

- [ ] **U3 — Opt-in checkbox sync (default off).** Settings → Updates and the About dialog show the same "check automatically" checkbox. On a fresh profile it is **off** by default. Toggling it in either place updates the other immediately (reopen the other dialog to confirm), persists across restart, and enabling it triggers exactly one immediate check even when the 24h throttle has not elapsed / the last check was recent. Disabling it stops future automatic checks.

- [ ] **U4 — 24h throttle + status-bar pill.** With auto-check on and a `lastUpdateCheckAt` older than 24h, startup runs one silent check; launching again within 24h runs none (confirm via the network panel). When a newer release is found, the status-bar pill appears reading `Update X.Y.Z available`. Clicking the pill opens About showing the **cached** result and performs no new network request.

- [ ] **U5 — Offline / rate-limited.** Disconnect the network (or exhaust the GitHub unauthenticated rate limit), then run a manual check: About shows a short, friendly error (no raw JSON/stack trace) and the app remains fully usable. An automatic/startup check fails silently — no dialog, no pill, and `lastUpdateCheckAt` is not advanced by the failure, so the next eligible startup retries.

- [ ] **U6 — CSP + web parity.** In the built desktop installer, the check succeeds under the production Tauri CSP and DevTools shows **no** `connect-src` / CSP violation for `https://api.github.com`. In the GitHub Pages web app the same check succeeds (public GitHub API, CORS allowed), and an available update's download/release link opens in a new tab rather than replacing the editor.

## Notes

- The app never downloads or installs updates itself; it only opens external URLs through the platform layer.
- GitHub's unauthenticated API is rate-limited per IP — repeated QA runs can hit the limit; wait or use another network before treating U5 as a bug.
