# Notedown on the web

Live build: <https://codecody93.github.io/Notedown/>

The web target is the same Vite frontend as the desktop app, built as a static
site and deployed to GitHub Pages. It is a convenient secondary surface for
quick edits and sharing; **the desktop app remains the recommended path for
serious local file work** (native open/save, sibling image resolution, and
paste-image files written next to the document).

## How the build works

- `npm run build` (`tsc && vite build`) produces a static `dist/` bundle. There
  is no server component: rendering, conversion, and file access all happen in
  the browser.
- `vite.config.ts` sets `base: process.env.VITE_BASE ?? "/"`. Desktop/Tauri
  builds and `npm run dev` use `/`; the Pages workflow sets
  `VITE_BASE=/Notedown/` so assets resolve under the repository subpath.
- `public/.nojekyll` is copied into `dist/`. It disables Jekyll on GitHub Pages
  so the bundle is served exactly as Vite emitted it.
- To reproduce the Pages build locally:

  ```sh
  VITE_BASE=/Notedown/ npm run build
  VITE_BASE=/Notedown/ npm run preview
  ```

  Then open the preview URL printed by Vite (it includes `/Notedown/`).
- If Pages loads a blank page or `/assets/...` requests 404, `VITE_BASE` is
  missing or wrong for the deployment path.

The base is only a deployment concern. `VITE_BASE` must match the site path:
`/Notedown/` for the project site, `/` for a user/organization site or a custom
domain served at the root. Keep the leading and trailing slashes.

## File handling

| Operation | Chrome / Edge (Chromium) | Firefox / Safari |
| --- | --- | --- |
| Open | File System Access API (`showOpenFilePicker`); the file handle is retained and persisted in IndexedDB | Hidden `<input type="file">` picker; the selected file is read into memory |
| Save | Writes through the retained handle (after a permission prompt), updating the original file in place | Downloads a new copy of the `.md` file; the original file is never modified |
| Save As / export | File System Access save picker (`showSaveFilePicker`) | Blob download |
| Reopen later | The handle can be restored from IndexedDB; Chromium may ask for read/write permission again | Pick the file again with the file input |

Firefox and Safari do not implement the File System Access API, so they always
use the file-input + download fallback. The same fallback applies wherever
`showOpenFilePicker` is unavailable (for example, all iOS browsers use WebKit).
Some Chromium-based browsers on Android expose the API and take the File System
Access path; when they do not, the download fallback applies.

## Limitations

- **No in-place save in Firefox/Safari.** Every save downloads a new copy
  (usually into Downloads). The document you opened is not updated, and repeated
  saves can leave duplicate files unless you manage them yourself.
- **No sibling/local image resolution.** A relative image such as
  `![diagram](./diagram.png)` cannot be resolved: the web target has no directory
  handle or asset protocol that exposes files next to the document. Remote
  `https:` images and inline `data:` images render. Keep documents with local
  images on the desktop app.
- **Pasted images are inline `data:` URLs, capped at about 2 MB each.** The web
  target cannot write files next to the document, so image data is embedded in
  the Markdown (and in drafts). Images over the cap are rejected. Large inline
  images make documents and autosaved drafts much bigger; desktop saves an image
  file next to the document and inserts a relative path instead.
- **Browser storage can be evicted.** Settings, recent-file metadata, autosaved
  drafts, and (in Chromium) file handles live in `localStorage`/IndexedDB.
  Private browsing, clearing site data, storage pressure, or aggressive mobile
  browser eviction (notably iOS Safari) can remove them. Treat browser storage
  as a convenience, not a backup — keep source files on disk and export changes.
- **No OS integration.** There are no file associations, native recent
  documents, or native dialogs. File pickers and download prompts vary by
  browser and cannot be styled consistently.

## Enabling GitHub Pages

1. Push the repository, including the Pages workflow, to `main`.
2. Open the repository on GitHub: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions** (not
   "Deploy from a branch").
4. Run the Pages workflow — push to `main` or use **Actions → the Pages workflow
   → Run workflow**. It installs dependencies, builds with
   `VITE_BASE=/Notedown/`, and deploys `dist/`.
5. Confirm the deployment at <https://codecody93.github.io/Notedown/>. The first
   deployment may need approval if the `github-pages` environment is protected.

The workflow needs `pages: write` and `id-token: write` permissions. Publishing
Pages from a private repository requires a GitHub plan that supports it (the
published site is public unless access control is configured). If the repository
is renamed, update the `VITE_BASE` value and the URL above to the new
`/<repo>/` path.

## Content Security Policy

`index.html` ships a restrictive CSP. The web target keeps the Tauri allowances
(`asset:`, `http://asset.localhost`, `ipc:`, `http://ipc.localhost`) so the same
file works in both runtimes, and adds:

- `img-src ... https:` so remote Markdown images render.
- `worker-src 'self' blob:` for bundled PDF import workers.
- `base-uri 'self'` and `form-action 'none'` as hardening.

Everything (scripts, styles, fonts, icons) is bundled locally. There are no
external scripts, CDN links, or web fonts; keep it that way when adding features.

## QA checklist

Run these against the deployed Pages site (and optionally a local
`VITE_BASE=/Notedown/` preview). Clear site data before starting.

### Chrome / Edge (desktop)

- [ ] The page loads with no 404s for assets, favicon, or styles.
- [ ] Open a `.md` file with the picker; the filename/status bar update and the
      content renders in live preview.
- [ ] Edit and **Save**: the original file on disk is updated in place.
- [ ] **Save As** writes a separate file with the chosen name.
- [ ] A remote image (`https://...`) in Markdown renders, and the console shows
      no CSP violations.
- [ ] Paste an image under ~2 MB: an inline `data:` URL is inserted and renders.
      Paste one over the cap: it is rejected with a warning.
- [ ] Export HTML/DOCX/PDF: downloads or save picker work, and PDF import/export
      workers load with no `worker-src` CSP errors.
- [ ] Reload or reopen: drafts/recents recover; the file handle prompts for
      permission and saves successfully when allowed.

### Firefox (desktop)

- [ ] Open a `.md` file through the file input.
- [ ] Edit and **Save**: a new copy downloads; the original file is unchanged.
- [ ] **Save As** and HTML/DOCX/PDF export complete via downloads.
- [ ] Remote images render; relative/local images do not.
- [ ] Paste a small image: inline `data:` URL is inserted; oversized images are
      rejected.
- [ ] Reload and reopen the file through the picker; the app stays usable with no
      unhandled errors in the console.

### Safari (macOS)

- [ ] Open via the file input; save results in a downloaded copy (check the
      Downloads folder or the browser's download prompt).
- [ ] Remote images render; relative images do not.
- [ ] HTML/DOCX/PDF export downloads successfully.
- [ ] Paste an image from the clipboard, if Safari exposes it; otherwise confirm
      the app degrades gracefully.
- [ ] No CSP or module-loading errors in the Web Inspector console.

### Mobile (Android Chrome and iOS Safari)

- [ ] The menu bar, editor, and status bar fit the viewport without horizontal
      scrolling; controls remain tappable.
- [ ] Open a file from the device's Files/Downloads picker.
- [ ] Edit and save: Android Chrome may write through a file handle when the
      API is available; iOS Safari downloads a copy. In both cases confirm the
      filename and extension.
- [ ] The soft keyboard does not hide the active line, and rotating the device
      preserves content.
- [ ] Draft recovery works after backgrounding/reloading the tab (subject to
      storage eviction).
- [ ] Remote images render; if image paste is offered on this device, verify the
      inline `data:` URL is inserted and renders.

**Desktop remains the recommended path** for local file work, especially for
documents with sibling images, frequent in-place saves, or large pasted images.
