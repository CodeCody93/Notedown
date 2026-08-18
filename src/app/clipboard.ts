/**
 * Clipboard helpers (M3) — copy/cut/paste toolbar buttons + paste-image.
 *
 * Everything drives the editor through the `EditorController` seam from
 * `src/editor/editor.ts` — no CM6 types leak to the host (same rule as app.ts).
 * Copy/cut run local CM6 `Command`s (the installed CM6 predates the package's
 * `copySelection`/`cutSelection`, see the DEVIATION NOTE below). Paste reads the
 * clipboard text via `navigator.clipboard` and falls back to
 * `document.execCommand('paste')` when the async API is unavailable or the read is
 * denied (button click = user activation).
 *
 * Paste-image (PLAN §11) is fully implemented in M4: the image is saved next to
 * the document via the Rust `write_image` command (behind `FileIO.saveImage`),
 * then the markdown reference is inserted at the caret. When the doc is unsaved
 * the user picks a folder first; on mobile it is a graceful no-op (`isMobile`
 * from platform/detect).
 */
import { isMobile } from '../platform/detect'
import type { Command } from '@codemirror/view'
import type { EditorController } from '../editor/editor'
import type { FileIO } from '../platform/types'

/** '![alt](filename)' markdown reference. alt defaults to the filename stem. */
export function buildImageRef(filename: string, alt?: string): string {
  const label = alt ?? filename.replace(/\.[^./\\]+$/, '')
  return `![${label}](${filename})`
}

/** Ext derived from the image mime type ('image/png'→'png', 'image/jpeg'→'jpg', default 'png'). */
function imageExt(mime?: string): string {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    default:
      return 'png'
  }
}

/** 'docname-<epochms>.<ext>' where ext derives from mime ('image/png'→'png', 'image/jpeg'→'jpg', default 'png'); stem strips the doc extension and invalid chars. */
export function imageFileName(docName: string, ts: number, mime?: string): string {
  const stem = docName
    .replace(/\.[^./\\]+$/, '') // strip the last extension
    .replace(/[\u0000-\u001f<>:"\\|?*/]+/g, '_') // replace invalid filename chars
  return `${stem}-${ts}.${imageExt(mime)}`
}

/**
 * Copy/cut as CM6 `Command`s driven through the controller seam.
 *
 * DEVIATION NOTE: the installed `@codemirror/commands`/`@codemirror/view` do not
 * export `copySelection`/`cutSelection` (they arrive in a later CM6 release), so we
 * implement the same behavior here: read the main selection from the editor state and
 * write it via `navigator.clipboard.writeText` (a toolbar-button click counts as user
 * activation, so the write is permitted even when the editor is not focused). Returns
 * false when nothing is selected → the button is a no-op. This plugs into
 * `controller.runCommand`, keeping the controller seam intact for the M4 swap.
 */

/** Best-effort write of the selected slice to the system clipboard. */
function writeClipboard(text: string): void {
  const p = navigator.clipboard?.writeText?.(text)
  if (p !== undefined) {
    p.catch((err) => console.warn('[clipboard] navigator.clipboard.writeText() failed', err))
  }
}

const cmCopy: Command = (view) => {
  const sel = view.state.selection.main
  if (sel.empty) return false
  writeClipboard(view.state.sliceDoc(sel.from, sel.to))
  return true
}

const cmCut: Command = (view) => {
  const sel = view.state.selection.main
  if (sel.empty) return false
  writeClipboard(view.state.sliceDoc(sel.from, sel.to))
  view.dispatch(view.state.replaceSelection(''))
  return true
}

/** Copy the current editor selection to the clipboard (uses CM6 copySelection command; no-op if nothing selected). */
export async function copySelection(controller: EditorController): Promise<void> {
  controller.runCommand(cmCopy)
}

/** Cut the current editor selection. */
export async function cutSelection(controller: EditorController): Promise<void> {
  controller.runCommand(cmCut)
}

/**
 * Paste clipboard text at the caret: `navigator.clipboard.readText()` then
 * `controller.replaceSelection`. On NotAllowedError/PermissionDenied (or when the
 * async clipboard API is absent) fall back to `document.execCommand('paste')`
 * (button click = user activation). Never throws — logs a console.warn on failure.
 */
export async function pasteText(controller: EditorController): Promise<void> {
  try {
    const text = await navigator.clipboard?.readText?.()
    if (text === undefined || text === '') {
      legacyPaste()
      return
    }
    controller.replaceSelection(text)
  } catch (err) {
    console.warn('[clipboard] navigator.clipboard.readText() failed; falling back to execCommand("paste")', err)
    legacyPaste()
  }
}

/** document.execCommand('paste') fallback, guarded for environments without it. */
function legacyPaste(): void {
  if (typeof document.execCommand === 'function') {
    try {
      document.execCommand('paste')
    } catch (err) {
      console.warn('[clipboard] document.execCommand("paste") failed', err)
    }
  } else {
    console.warn('[clipboard] Clipboard API unavailable and document.execCommand("paste") is not supported')
  }
}

/** First image file in the paste event's clipboard, or null when there is none. */
function firstImageFile(event: ClipboardEvent): File | null {
  const files = event.clipboardData?.files
  if (!files) return null
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith('image/')) return files[i]
  }
  return null
}

/** Save the pasted image next to the document via FileIO (M4: Rust write_image). Returns the saved absolute path, or null when cancelled/unavailable. */
async function saveImageBlob(io: FileIO, docPath: string | null, blob: Blob, filename: string): Promise<string | null> {
  return io.saveImage(docPath, filename, blob)
}

/**
 * Paste-image flow (M4): on desktop, when the clipboard holds an image, build a
 * filename for it, save it next to the doc (`FileIO.saveImage` → Rust
 * `write_image`; a folder picker is shown when the doc is unsaved), and insert
 * the markdown reference at the caret when the save succeeded. Mobile is a
 * graceful no-op.
 */
export async function pasteImage(
  controller: EditorController,
  io: FileIO,
  doc: { name: string; path: string | null },
  event: ClipboardEvent,
): Promise<void> {
  if (isMobile) {
    console.info('[paste-image] Not available on mobile')
    return
  }
  const file = firstImageFile(event)
  if (file === null) return
  const filename = imageFileName(doc.name, Date.now(), file.type)
  const savedPath = await saveImageBlob(io, doc.path, file, filename)
  if (savedPath !== null) {
    controller.replaceSelection(buildImageRef(filename))
  }
}
