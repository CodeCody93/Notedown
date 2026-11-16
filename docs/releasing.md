# Releasing Notedown

Notedown 0.7.0 is the first public release. A version bump on `main` produces
two release artifacts automatically:

- Desktop installers attached to a published GitHub Release.
- The `@codecody93/notedown-editor` package published to GitHub Packages.

The build is version-gated: every push to `main` reads `package.json`, and when
`v<version>` has no published release yet, CI builds the installers, attaches
them to a draft, and publishes the release after all three platform builds
succeed. `v*` tags still work and go through the same gate, so tagging is
optional.

The static web app is deployed separately from pushes to `main`, so it tracks
`main` rather than the tagged release.

## CI overview

`.github/workflows/build.yml` runs these jobs:

| Job | Runner | What it does |
| --- | --- | --- |
| Test & version check | `ubuntu-latest` | `npm run version:check`, `npm ci`, typecheck, Vitest, `npm run build:embed`, uploads `notedown-editor-package` |
| Release info | `ubuntu-latest` | Reads `package.json`, checks whether `v<version>` is already published, decides whether this run creates a release |
| Web | `ubuntu-latest` | On pushes to `main` only (not tags/PRs): builds with `VITE_BASE=/<repo>/`, uploads the Pages artifact, deploys `dist/` |
| Build | matrix | Windows MSI, Linux deb/AppImage, macOS universal DMG; attaches them to the draft release on release runs, otherwise uploads workflow artifacts |
| Publish embed | `ubuntu-latest` | On release runs: downloads `notedown-editor-package` and publishes `dist-embed/` to GitHub Packages (skips versions that already exist) |
| Publish release | `ubuntu-latest` | Publishes the draft GitHub Release after the whole build matrix succeeds and every platform installer is attached |

The desktop build and publish jobs do not start unless the test job passes, and
publishing waits for all three platform builds. Main/tag runs whose version is
already published build only; branch/PR runs upload workflow artifacts for 14
days instead. The web job deploys on every push to `main`, so the live site
tracks `main` between releases.

## One-time repository setup

Do these before the first public release:

1. **Make the repository public.** GitHub Pages on the free plan and public
   package visibility both require it. Check `LICENSE` (MIT) and the README are
   ready for public view, and that no secrets are committed.

2. **Enable GitHub Actions.** Repository → Settings → Actions → General. Allow
   the workflow to run and let it use the repository `GITHUB_TOKEN`.

3. **Enable GitHub Pages.** Repository → Settings → Pages → Build and
   deployment → Source: **GitHub Actions** (not "Deploy from a branch"). The
   `web` job requests `pages: write` and `id-token: write`, and targets the
   `github-pages` environment. The first deployment may need environment
   approval if protection rules are enabled. Confirm the site at
   <https://codecody93.github.io/Notedown/>.

4. **Enable GitHub Packages.** The `publish-embed` job uses the repository
   `GITHUB_TOKEN` with `packages: write`. After the first tag run, open the
   package page (<https://github.com/CodeCody93/Notedown/pkgs/npm/notedown-editor>)
   and link it to the repository if GitHub did not do so automatically. Set the
   package visibility to public. Grant the repository write access under the
   package's settings if package creation was inherited from another repo.

5. **Verify GitHub Sponsors.** Confirm the approved account at
   <https://github.com/sponsors/CodeCody93>: the profile details are correct and
   both the monthly and one-time tiers are published. The repository ships
   `.github/FUNDING.yml` (`github: CodeCody93`), and the About dialog uses the
   same URL (`SPONSOR_URL` in `src/app/about.ts`). Keep those references and the
   `funding` metadata in `package.json` and the generated embed package in sync.

6. **Workflow permissions.** The workflow declares permissions at job level:
   - `contents: write` (top level) for creating and publishing the release.
   - `pages: write`, `id-token: write` for the Pages deployment.
   - `packages: write` for the GitHub Packages publish.

   If organization policy restricts token permissions, allow these scopes for
   this workflow. No signing secrets are required for unsigned builds; Windows
   MSI and macOS DMG are unsigned, and macOS is not notarized.

## Release checklist

> **First public release:** the version files are already at `0.7.0`; tag
> `v0.7.0` after the public-release setup below. Use the bump step for every
> subsequent release.

1. **Start from a green `main`.** Pull the latest `main` and confirm the Build
   workflow (test, web, desktop artifacts) is green.

2. **Bump every version file atomically.**

   ```powershell
   npm run version:bump -- 0.7.0
   ```

   This updates `package.json`, both versions in `package-lock.json`,
   `src-tauri/Cargo.toml`, the root `notedown` block in `src-tauri/Cargo.lock`,
   and `src-tauri/tauri.conf.json`. The About dialog reads the version straight
   from `package.json`, so it updates automatically.

3. **Review and verify.**

   ```powershell
   git diff
   npm run verify
   ```

   `verify` runs the version check, typecheck, the full Vitest suite, the
   web/embed production build (`npm run build:web`), and the local Tauri bundle.
   To reproduce the Pages deployment locally, rebuild with the Pages base:

   ```powershell
   $env:VITE_BASE = "/Notedown/"
   npm run build:web
   npm run preview       # terminal 1
   npm run demo:embed    # terminal 2
   ```

   Smoke-test the demo (open the printed URL, switch theme/mode/read-only) and
   the previewed web build.

4. **Commit and push `main`.**

   ```powershell
   git add -A
   git commit -m "chore: release 0.7.0"
   git push origin main
   ```

   The push is the release trigger: the `release-info` job sees a new version,
   the matrix builds the installers, and `publish-release` publishes the GitHub
   Release automatically. No tag or manual publish step is needed. Confirm the
   `web` job also redeploys <https://codecody93.github.io/Notedown/>.

5. **Optional dry run.** Go to Actions → Build → Run workflow on a **feature
   branch** (release creation only happens on `main` and `v*` tags). This builds
   and uploads `notedown-windows-msi`, `notedown-linux`,
   `notedown-macos-universal`, and `notedown-editor-package` artifacts without
   creating a release or publishing the package. Download and smoke-test the
   installers.

6. **Tags are optional.** The workflow creates `v<version>` at the built commit
   for a main-driven release. If you prefer to publish the tag yourself, push it
   before or after `main`:

   ```powershell
   git tag -a v0.7.0 -m "Notedown 0.7.0"
   git push origin v0.7.0
   ```

   The tag must be exactly `v<package version>`. The test job fails if it is not.
   If the version is already published, the tag run only builds artifacts.

7. **Wait for all jobs.** The draft release is created after the test and
   release-info jobs pass, each platform build uploads its assets, the
   `publish-release` job flips the draft public, and `publish-embed` publishes
   the package. The tag run deliberately does not deploy Pages; the web job is
   protected to `main`.

8. **Verify all artifacts.**

   - **Web:** open <https://codecody93.github.io/Notedown/>, hard-refresh, and
     check the browser QA checklist in [`docs/web.md`](web.md).
   - **Embed package:** confirm the tag version appears at
     <https://github.com/CodeCody93/Notedown/pkgs/npm/notedown-editor>, and test
     installation in a clean project with the `.npmrc` from
     [`docs/embedding.md`](embedding.md). Also load the CDN copy from
     <https://codecody93.github.io/Notedown/embed/notedown-editor.js>.
   - **Desktop:** open GitHub → Releases → `Notedown v0.7.0`; confirm these
     assets are attached:
     - `*.msi` (Windows x64)
     - `*.deb` and `*.AppImage` (Linux x64)
     - `*universal*.dmg` (macOS Apple Silicon + Intel)

   The release should already be public; `publish-release` verifies that every
   platform asset is present before publishing.

## Important: let the workflow own the release

The workflow creates the tag (for main-driven releases), attaches the
installers, and publishes the release. Do not create or publish a release by
hand: `release-info` treats any published release for the current version as
"already done" and will only build artifacts, so a manual release freezes that
version. If a release exists but is wrong, bump the patch version instead of
editing or reusing it.

## GitHub Packages consumer auth caveat

GitHub Packages requires authentication even when the package is public.
Consumers must authenticate to `https://npm.pkg.github.com`; anonymous installs
fail with a 401/404. The published README and [`docs/embedding.md`](embedding.md)
document this `.npmrc` setup:

```ini
@codecody93:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`GITHUB_TOKEN` (or a classic PAT with `read:packages`) must belong to a GitHub
account with access to the package. For public, unauthenticated consumption use
the CDN copy under the Pages site's `/embed/` path instead. Never commit tokens.

## If a release run fails

- Re-run the workflow (or push a fix to `main`). `tauri-action` reuses the
  draft release with the same tag, and `publish-release` publishes it once every
  platform installer is present.
- If `publish-release` reports a missing installer, inspect the failed platform
  build; do not hand-edit the release.
- The `publish-embed` job fails if the version already exists in the registry.
  Bump the patch version; npm/GitHub Packages versions are immutable.
- If the release was already published, do not reuse the version. Bump the patch
  version and push `main` again.
- Branch/PR runs keep their bundles as workflow artifacts for 14 days.

## Platform notes

- **Windows:** unsigned; SmartScreen warns. Users choose **More info → Run anyway**. The `.msi` is a per-machine installer.
- **macOS:** universal, unsigned, and not notarized. Gatekeeper may block the first launch: right-click the app → **Open**, or allow it under **System Settings → Privacy & Security**. If macOS says the app is damaged, run `xattr -cr /Applications/Notedown.app` once.
- **Ubuntu/Kubuntu:** `sudo apt install ./Notedown_<version>_amd64.deb`, or `chmod +x` the `.AppImage` and run it.
- **Web:** the Pages build uses `VITE_BASE=/<repo>/`; a blank page or 404 on `/assets/...` means the base is wrong. Browser-specific file behavior is documented in [`docs/web.md`](web.md).

## Version sources

`npm run version:check` compares all of these and fails if any differ:

- `package.json` (`version`)
- `package-lock.json` (top-level `version` and `packages[""].version`)
- `src-tauri/Cargo.toml` (`[package].version`)
- `src-tauri/Cargo.lock` (root `[[package]]` for `notedown`)
- `src-tauri/tauri.conf.json` (`version`)

On a tag build, it also requires `GITHUB_REF_NAME` to equal `v` + the app version.
The embed package version and About dialog version both come from
`package.json`, so they follow the same bump.
