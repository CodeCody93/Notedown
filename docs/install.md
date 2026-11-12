# Installing Notedown

Notedown is available as a desktop app, a web app, and an embeddable editor
package. This page covers the desktop installers. For the other surfaces, see:

- **Web app:** <https://codecody93.github.io/Notedown/> — no install required.
- **Embeddable editor:** [`docs/embedding.md`](embedding.md) — install
  `@codecody93/notedown-editor` or load the CDN bundle.

## Download

Download the latest installer from the GitHub Releases page:

<https://github.com/CodeCody93/Notedown/releases/latest>

| Platform | Asset | Notes |
| --- | --- | --- |
| Windows 10/11 (x64) | `Notedown_<version>_x64_en-US.msi` | Per-machine MSI installer. WebView2 is included with current Windows 10/11; older systems may prompt for it. |
| Ubuntu / Debian-based Linux (x64) | `Notedown_<version>_amd64.deb` | Built on Ubuntu 22.04. Install with `apt`. |
| Linux (x64) | `Notedown_<version>_amd64.AppImage` | Portable single file; make it executable and run. |
| macOS (Universal) | `Notedown_<version>_universal.dmg` | Apple Silicon and Intel. Unsigned and not notarized. |

Release assets are built by GitHub Actions from the tagged source. The project
does not currently publish checksums or signed binaries.

## Windows

1. Download the `.msi`.
2. Run the installer. Windows SmartScreen will warn that the publisher is
   unknown because the build is unsigned.
3. Choose **More info → Run anyway**, then complete the installer.
4. Notedown registers `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, and `.mdwn`
   file associations. Windows may still ask you to confirm the default app the
   first time you open a Markdown file.

To update, download the newer `.msi` and install it over the existing version.
To uninstall, use **Settings → Apps → Installed apps → Notedown → Uninstall**.

## Linux

### Debian / Ubuntu

```sh
sudo apt install ./Notedown_<version>_amd64.deb
```

The package registers the Markdown file associations and installs a desktop
entry. To update, install the newer `.deb` the same way.

### AppImage

```sh
chmod +x Notedown_<version>_amd64.AppImage
./Notedown_<version>_amd64.AppImage
```

The AppImage is portable: keep it anywhere and run it directly. It is useful on
distributions where installing a `.deb` is not appropriate. Desktop integration
(file associations, menu entry) depends on your AppImage launcher.

### RPM

The local `npm run tauri build` pipeline can also emit an RPM, but the release
workflow publishes the `.deb` and `.AppImage`. Use one of those release assets
unless you build the RPM yourself.

## macOS

1. Download the universal `.dmg`.
2. Open it and drag **Notedown** into **Applications**.
3. The build is unsigned and not notarized, so Gatekeeper may block the first
   launch. Right-click the app and choose **Open**, or allow it in
   **System Settings → Privacy & Security**.
4. If macOS reports that the app is damaged, clear the quarantine flag once:

   ```sh
   xattr -cr /Applications/Notedown.app
   ```

To update, download a newer `.dmg` and replace the app in Applications.

## Web alternative

If you cannot install desktop software, use the web app:

<https://codecody93.github.io/Notedown/>

The web app is the same editor and export/import pipeline. Browser limitations
are documented in [`docs/web.md`](web.md): Chromium can save in place, while
Firefox and Safari download a new copy on save, and relative local images cannot
be resolved.

## Embedding instead of installing

If you are building another web app and want the Markdown editor rather than the
full Notedown application, install the package:

```sh
npm install @codecody93/notedown-editor
```

See [`docs/embedding.md`](embedding.md) for `.npmrc` authentication, the API,
CSS, CSP requirements, and CDN usage.

## System requirements

- **Windows:** Windows 10 or newer; WebView2 (bundled with current Windows).
- **macOS:** a recent macOS release supported by the universal Tauri build.
- **Linux:** a modern WebKitGTK-based desktop; the release `.deb` targets
  Ubuntu 22.04 and later. Other distributions can use the AppImage.
- **Disk/network:** no account or cloud service is required. Network access is
  only needed to download the app and, optionally, to load remote images or
  open external links.

Documents, drafts, recent files, and settings are stored locally by the desktop
app. The web app stores its data in browser storage instead; treat that as a
convenience, not a backup.
