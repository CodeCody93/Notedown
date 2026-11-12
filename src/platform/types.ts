/**
 * FileIO abstraction:
 * - browser.ts uses the File System Access API (showOpenFilePicker /
 *   showSaveFilePicker) where available, with a download / hidden-input
 *   fallback for other browsers, plus localStorage/IndexedDB for
 *   settings/recents/drafts/opened-file snapshots.
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

/** Raw import-candidate payload (P3 Import). Text formats arrive decoded as a
 * string; binary formats (pdf/docx) arrive as raw bytes for pdfjs/mammoth.
 * The Tauri backend always yields bytes; the browser backend always yields
 * bytes; `convertToMarkdown` in `src/app/import.ts` accepts either shape. */
export interface ImportResult {
  content: Uint8Array | string
  /** Original file name (e.g. "notes.docx"). */
  name: string
  /** Lowercase extension including the dot (e.g. ".docx"), or "" when unknown. */
  ext: string
}

/** File extensions accepted by the Import flow (native dialog + browser accept). */
export const IMPORT_EXTS: string[] = [
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
  '.pdf',
  '.docx',
  '.rtf',
]

/** Extra options for saveFile (Save As / round-9 unified export). */
export interface SaveOptions {
  /** Show the picker even when a path is already known (Save As). The saved path/key is always freshly generated. */
  alwaysPick?: boolean
  /** Use HTML file filters instead of markdown ones (Export HTML). Kept working: treated as exportKind 'html'. */
  html?: boolean
  /** Round-9 unified export: selects the export save-dialog filters. When absent with html:true, treated as 'html'. */
  exportKind?: 'txt' | 'html' | 'docx' | 'rtf' | 'pdf'
}

export interface FileIO {
  /** Open a document via the platform picker. Returns null when the user cancels. */
  openFile(): Promise<OpenResult | null>
  /** Pick any importable document (see IMPORT_EXTS). Returns null when the user cancels. */
  importFile(): Promise<ImportResult | null>
  /** Save content. When path is null — or opts.alwaysPick is set (Save As) — ask the user for a location (suggestedName is a hint). Returns the saved path/key, or null when cancelled. opts.html switches the picker to HTML filters (Export HTML); opts.exportKind (round-9 unified export) selects txt/html/docx/rtf/pdf filters. */
  saveFile(path: string | null, content: string, suggestedName?: string, opts?: SaveOptions): Promise<string | null>
  /** Round-9 unified export: binary save for .docx/.pdf. Asks the user for a location, writes the bytes, resolves the saved path/key, or null on cancel. */
  saveBytes(bytes: Uint8Array, suggestedName: string, opts?: { exportKind?: 'docx' | 'pdf' }): Promise<string | null>
  /** Read a file that was previously opened (used for Open Recent). Rejects on failure (missing/permission). */
  readFile(path: string): Promise<string>
  /**
   * Tauri only: drain buffered OS file-open requests (file association / CLI
   * launch and second-instance forwarding). Returns absolute file paths.
   * Browser mode omits this method.
   */
  takePendingOpenPaths?(): Promise<string[]>
  /**
   * Tauri only: subscribe to the Rust wake-up signal that new OS file-open
   * paths are buffered. Resolves to an unsubscribe function.
   * Browser mode omits this method.
   */
  onOpenFileRequested?(cb: () => void): Promise<() => void>
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
  /** Save an image blob next to the document (paste-image, PLAN §11). docPath null (unsaved doc) → ask the user for a folder first. Returns the saved ABSOLUTE path, or null when the user cancelled the folder picker or the platform cannot do it (web mode has no document folder — see saveInlineImage). */
  saveImage(docPath: string | null, filename: string, blob: Blob): Promise<string | null>
  /**
   * Web only: embed a pasted image inline because there is no document folder.
   * Resolves to a data URL the markdown can reference directly, or null when
   * the image is too large (implementations show a user-facing alert).
   * Tauri omits this method — it saves the image next to the document through
   * saveImage instead.
   */
  saveInlineImage?(blob: Blob, filename: string): Promise<string | null>
  /** Resolve an absolute local path to a URL the webview can render (data: URL in M4). Rejects when unresolvable (browser dev mode cannot read sibling files). */
  exposeImage(absPath: string): Promise<string>
}
