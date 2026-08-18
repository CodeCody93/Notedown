/**
 * FileIO abstraction. Full implementations arrive in M1:
 * - browser.ts uses the File System Access API (showOpenFilePicker /
 *   showSaveFilePicker) plus localStorage/IndexedDB for settings/recents/drafts.
 * - tauri.ts calls the Rust commands via invoke().
 * UI code must never call window.showOpenFilePicker or invoke() directly —
 * all file I/O goes through this interface.
 */
export interface OpenResult {
  content: string
  name: string
  /** Real filesystem path (Tauri) or an opaque storage key (browser FS Access API). */
  path: string | null
}

/** Extra options for saveFile (Save As / Export HTML). */
export interface SaveOptions {
  /** Show the picker even when a path is already known (Save As). The saved path/key is always freshly generated. */
  alwaysPick?: boolean
  /** Use HTML file filters instead of markdown ones (Export HTML). */
  html?: boolean
}

export interface FileIO {
  /** Open a document via the platform picker. Returns null when the user cancels. */
  openFile(): Promise<OpenResult | null>
  /** Save content. When path is null — or opts.alwaysPick is set (Save As) — ask the user for a location (suggestedName is a hint). Returns the saved path/key, or null when cancelled. opts.html switches the picker to HTML filters (Export HTML). */
  saveFile(path: string | null, content: string, suggestedName?: string, opts?: SaveOptions): Promise<string | null>
  /** Read a file that was previously opened (used for Open Recent). Rejects on failure (missing/permission). */
  readFile(path: string): Promise<string>
  /** Platform confirm dialog (browser: window.confirm; Tauri: native dialog). */
  confirm(message: string): Promise<boolean>
  /** Platform message dialog with an OK button (Tauri: native dialog — window.alert is a no-op in the webview, user-results C9; browser: window.alert). */
  alert(message: string): Promise<void>
  /** Raw JSON settings blob, or null when nothing stored yet. */
  readSettings(): Promise<string | null>
  writeSettings(json: string): Promise<void>
  readRecents(): Promise<string | null>
  writeRecents(json: string): Promise<void>
  readDraft(key: string): Promise<string | null>
  writeDraft(key: string, content: string): Promise<void>
  clearDraft(key: string): Promise<void>
  /** Open a URL in the default external browser (Tauri opener) / a new browser tab (browser dev mode). Never window.open into the app; javascript:/data:/vbscript: URLs are rejected by the implementations. */
  openExternal(url: string): Promise<void>
  /** Save an image blob next to the document (paste-image, PLAN §11). docPath null (unsaved doc) → ask the user for a folder first. Returns the saved ABSOLUTE path, or null when the user cancelled the folder picker or the platform cannot do it (browser dev mode). */
  saveImage(docPath: string | null, filename: string, blob: Blob): Promise<string | null>
  /** Resolve an absolute local path to a URL the webview can render (data: URL in M4). Rejects when unresolvable (browser dev mode cannot read sibling files). */
  exposeImage(absPath: string): Promise<string>
}
