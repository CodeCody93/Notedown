import type { FileIO, ImportResult, OpenResult, SaveOptions } from './types'

// Web mode is a production-capable target: the File System Access API is used
// where it exists (Chromium), and a download / hidden <input type=file> fallback
// keeps Safari, Firefox and any other browser working. File handles are
// persisted in IndexedDB so readFile/saveFile can reuse them without re-picking;
// a text snapshot of each opened/saved file lives beside the handle so Open
// Recent still works after a handle is lost (IndexedDB eviction, permission
// reset). Settings/recents stay in localStorage because they are small blobs.

// TS 5.6 lib.dom lacks the FS Access API types (only OPFS) — declare the small
// subset we use. Kept module-local so they never collide with lib.dom globals.
interface FSAWritable {
  write(data: string | Blob): Promise<void>
  close(): Promise<void>
}

interface FSAHandle {
  name: string
  getFile(): Promise<File>
  createWritable(opts?: unknown): Promise<FSAWritable>
  requestPermission(opts?: { mode?: string }): Promise<string>
}

interface WindowWithFSA extends Window {
  showOpenFilePicker?: (opts?: unknown) => Promise<FSAHandle[]>
  showSaveFilePicker?: (opts?: unknown) => Promise<FSAHandle>
}

// --- encoded document paths ---
//
// Browser storage keys double as document paths in app state (Open Recent, Save
// As, drafts). Encoding the display name into the key makes `basename()` in
// src/app/app.ts work after Save As and keeps recents readable:
//   FSA-backed file:  fs:<uuid>/<filename>
//   download-backed:  web:<uuid>/<filename>
// The name is the source of truth for display; the uuid is only the storage id.

export type BrowserPathKind = 'fs' | 'web'

export interface ParsedBrowserPath {
  kind: BrowserPathKind
  id: string
  name: string
}

const BROWSER_PATH_RE = /^(fs|web):([^/]+)\/(.+)$/

/** Keep path separators out of the encoded name so basename()/parse() stay unambiguous. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/]/g, '_').trim()
  return cleaned === '' ? 'untitled.md' : cleaned
}

/** Build the storage path for a browser-backed document. */
export function encodeDocPath(kind: BrowserPathKind, id: string, name: string): string {
  return `${kind}:${id}/${sanitizeFileName(name)}`
}

/** Parse a path produced by encodeDocPath; null for legacy/Tauri/unknown paths. */
export function parseDocPath(path: string): ParsedBrowserPath | null {
  const match = BROWSER_PATH_RE.exec(path)
  if (match === null) return null
  const [, kind, id, name] = match
  if (kind !== 'fs' && kind !== 'web') return null
  return { kind, id, name }
}

// --- IndexedDB stores (handles + file snapshots + drafts) ---

const DB_NAME = 'notedown.handles'
// v2 added the `files` (content snapshots) and `drafts` stores. The DB name is
// kept for compatibility with handles written by the previous browser backend.
const DB_VERSION = 2
const HANDLE_STORE = 'handles'
const FILE_STORE = 'files'
const DRAFT_STORE = 'drafts'

interface HandleRecord {
  id: string
  handle: FSAHandle
}

interface FileRecord {
  path: string
  name: string
  /** Text snapshot; null for binary exports (docx/pdf) that are not re-readable as text. */
  content: string | null
  lastModified: number
}

interface DraftRecord {
  key: string
  content: string
}

interface DraftMigrationSource {
  key: string
  content: string
}

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    // Accessing indexedDB can itself throw in hardened/private contexts.
    return false
  }
}

/**
 * Open the shared database. Resolves null for every failure (unavailable API,
 * blocked upgrade, quota) — callers degrade to localStorage or a download.
 */
function openDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null)
  return new Promise<IDBDatabase | null>((resolve) => {
    let settled = false
    const finish = (db: IDBDatabase | null): void => {
      if (settled) return
      settled = true
      resolve(db)
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(HANDLE_STORE)) {
          db.createObjectStore(HANDLE_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(FILE_STORE)) {
          db.createObjectStore(FILE_STORE, { keyPath: 'path' })
        }
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          db.createObjectStore(DRAFT_STORE, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        if (settled) {
          // Another tab blocked the v2 upgrade and we already degraded; do not
          // leak the connection that eventually opened.
          request.result.close()
          return
        }
        finish(request.result)
      }
      request.onerror = () => finish(null)
      // An older tab may still hold the v1 database open and block the upgrade.
      // Fail soft (localStorage/download fallback) instead of hanging a save.
      request.onblocked = () => finish(null)
    } catch {
      finish(null)
    }
  })
}

/** Read one record; null on any failure. */
function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  return openDb().then((db) => {
    if (db === null) return null
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly')
        const request = tx.objectStore(storeName).get(key)
        request.onsuccess = () => {
          const result: unknown = request.result
          resolve(result === undefined ? null : (result as T))
        }
        request.onerror = () => {
          db.close()
          resolve(null)
        }
        tx.oncomplete = () => db.close()
        tx.onabort = () => {
          db.close()
          resolve(null)
        }
      } catch {
        db.close()
        resolve(null)
      }
    })
  })
}

/** Write one record; resolves false on any failure. */
function idbPut(storeName: string, value: unknown): Promise<boolean> {
  return openDb().then((db) => {
    if (db === null) return false
    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).put(value)
        tx.oncomplete = () => {
          db.close()
          resolve(true)
        }
        tx.onerror = () => {
          db.close()
          resolve(false)
        }
        tx.onabort = () => {
          db.close()
          resolve(false)
        }
      } catch {
        db.close()
        resolve(false)
      }
    })
  })
}

/** Delete one record; resolves false on any failure. */
function idbDelete(storeName: string, key: IDBValidKey): Promise<boolean> {
  return openDb().then((db) => {
    if (db === null) return false
    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).delete(key)
        tx.oncomplete = () => {
          db.close()
          resolve(true)
        }
        tx.onerror = () => {
          db.close()
          resolve(false)
        }
        tx.onabort = () => {
          db.close()
          resolve(false)
        }
      } catch {
        db.close()
        resolve(false)
      }
    })
  })
}

function getHandle(key: string): Promise<FSAHandle | null> {
  return idbGet<HandleRecord>(HANDLE_STORE, key).then((record) => record?.handle ?? null)
}

function putHandle(key: string, handle: FSAHandle): Promise<void> {
  const record: HandleRecord = { id: key, handle }
  return idbPut(HANDLE_STORE, record).then(() => undefined)
}

function deleteHandle(id: string): Promise<void> {
  return idbDelete(HANDLE_STORE, id).then(() => undefined)
}

function getFileSnapshot(path: string): Promise<FileRecord | null> {
  return idbGet<FileRecord>(FILE_STORE, path)
}

function putFileSnapshot(
  path: string,
  name: string,
  content: string | null,
  lastModified = Date.now(),
): Promise<void> {
  const record: FileRecord = { path, name, content, lastModified }
  return idbPut(FILE_STORE, record).then(() => undefined)
}

/** Look up a handle by its encoded path, then by its bare id (v1 records). */
async function findHandle(path: string, parsed: ParsedBrowserPath | null): Promise<FSAHandle | null> {
  const direct = await getHandle(path)
  if (direct !== null) return direct
  return parsed === null ? null : getHandle(parsed.id)
}

// --- helpers ---

const MARKDOWN_PICKER_TYPES = [
  {
    description: 'Markdown',
    accept: {
      'text/markdown': ['.md', '.markdown', '.mdx'],
      'text/plain': ['.txt'],
    },
  },
]

const HTML_PICKER_TYPES = [
  {
    description: 'HTML',
    accept: {
      'text/html': ['.html', '.htm'],
    },
  },
]

// Round-9 unified export picker types.
const TXT_PICKER_TYPES = [
  {
    description: 'Text',
    accept: {
      'text/plain': ['.txt'],
    },
  },
]

const DOCX_PICKER_TYPES = [
  {
    description: 'Word',
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
  },
]

const RTF_PICKER_TYPES = [
  {
    description: 'RTF',
    accept: {
      'text/rtf': ['.rtf'],
    },
  },
]

const PDF_PICKER_TYPES = [
  {
    description: 'PDF',
    accept: {
      'application/pdf': ['.pdf'],
    },
  },
]

/** Accept string for the markdown open picker's hidden-input fallback. */
const MARKDOWN_ACCEPT = '.md,.markdown,.mdx,.txt'

/** Round-9 unified export: resolve save-dialog picker types from SaveOptions (legacy html:true → HTML). */
function pickerTypesFor(opts?: { html?: boolean; exportKind?: 'txt' | 'html' | 'docx' | 'rtf' | 'pdf' }): unknown {
  const kind = opts?.exportKind ?? (opts?.html === true ? 'html' : undefined)
  switch (kind) {
    case 'txt':
      return TXT_PICKER_TYPES
    case 'html':
      return HTML_PICKER_TYPES
    case 'docx':
      return DOCX_PICKER_TYPES
    case 'rtf':
      return RTF_PICKER_TYPES
    case 'pdf':
      return PDF_PICKER_TYPES
    default:
      return MARKDOWN_PICKER_TYPES
  }
}

/** `accept=` string for the Import <input> (mirrors IMPORT_EXTS in types.ts). */
export const IMPORT_ACCEPT = '.md,.markdown,.txt,.html,.htm,.pdf,.docx,.rtf'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'
const MARKDOWN_MIME = 'text/markdown'
const INLINE_IMAGE_MAX_BYTES = 2 * 1024 * 1024

function makeKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function fileNameOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base === '' ? path : base
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

/** MIME type for a download/save derived from the file extension. */
function mimeForName(name: string): string {
  switch (extensionOf(name)) {
    case '.md':
    case '.markdown':
    case '.mdx':
      return MARKDOWN_MIME
    case '.txt':
      return 'text/plain'
    case '.html':
    case '.htm':
      return 'text/html'
    case '.docx':
      return DOCX_MIME
    case '.rtf':
      return 'text/rtf'
    case '.pdf':
      return PDF_MIME
    default:
      return MARKDOWN_MIME
  }
}

/** Export kind (txt/html/docx/rtf/pdf) wins over the suggested name's extension. */
function mimeForSave(opts: SaveOptions | undefined, name: string): string {
  switch (opts?.exportKind ?? (opts?.html === true ? 'html' : undefined)) {
    case 'txt':
      return 'text/plain'
    case 'html':
      return 'text/html'
    case 'docx':
      return DOCX_MIME
    case 'rtf':
      return 'text/rtf'
    case 'pdf':
      return PDF_MIME
    default:
      return mimeForName(name)
  }
}

function isAbortError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'AbortError'
}

/**
 * Wrap showOpenFilePicker: null on user cancellation (AbortError). Only called
 * after capability detection, so null always means "cancelled".
 */
async function pickOpenHandles(options: unknown): Promise<FSAHandle[] | null> {
  const w = window as WindowWithFSA
  if (typeof w.showOpenFilePicker !== 'function') return null
  try {
    return await w.showOpenFilePicker(options)
  } catch (err) {
    if (isAbortError(err)) return null
    throw err
  }
}

/**
 * Wrap showSaveFilePicker: null on user cancellation (AbortError). Only called
 * after capability detection, so null always means "cancelled".
 */
async function pickSaveHandle(options: unknown): Promise<FSAHandle | null> {
  const w = window as WindowWithFSA
  if (typeof w.showSaveFilePicker !== 'function') return null
  try {
    return await w.showSaveFilePicker(options)
  } catch (err) {
    if (isAbortError(err)) return null
    throw err
  }
}

/**
 * Hidden-input picker used when showOpenFilePicker is unavailable. Resolves
 * null on the `cancel` event (browsers that support it) or a change with no
 * file chosen.
 */
function pickFileWithInput(accept: string): Promise<File | null> {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    // Keep the input in the DOM while the picker is open. Safari in particular
    // may ignore `.click()` on a detached file input. Position it off-screen
    // instead of `display:none` so every browser treats it as interactive.
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top = '0'
    input.style.width = '1px'
    input.style.height = '1px'
    input.style.opacity = '0'
    input.setAttribute('aria-hidden', 'true')
    document.body.appendChild(input)
    let settled = false
    const finish = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}

/**
 * Download a Blob via a temporary object URL. This is the save path on browsers
 * without the File System Access API. The URL is revoked after the click so a
 * long editing session cannot leak blob URLs.
 */
function triggerDownload(blob: Blob, filename: string): boolean {
  let objectUrl: string | null = null
  try {
    if (typeof URL.createObjectURL === 'function') objectUrl = URL.createObjectURL(blob)
  } catch (err) {
    console.warn('[download] URL.createObjectURL() failed', err)
  }
  if (objectUrl === null) {
    console.warn('[download] URL.createObjectURL() is unavailable; the file was not downloaded.')
    return false
  }
  const url = objectUrl
  let clicked = false
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = sanitizeFileName(filename)
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    clicked = true
  } catch (err) {
    console.warn('[download] creating the download link failed', err)
  }
  // Zero-delay keeps the object URL alive until the click has been dispatched
  // (Firefox/Safari start the download asynchronously).
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // Already revoked or the API is unavailable.
    }
  }, 0)
  return clicked
}

/** Download-or-reject wrapper so a blocked object URL never looks like a save. */
function downloadOrThrow(blob: Blob, filename: string): void {
  if (!triggerDownload(blob, filename)) {
    throw new Error('The browser blocked the download; the file was not saved.')
  }
}

/**
 * Best-effort persistent-storage request after a successful save. Some browsers
 * only grant it after user interaction; failures are irrelevant to the save.
 */
function requestPersistentStorage(): void {
  try {
    const storage: StorageManager | undefined = (navigator as Navigator & {
      storage?: StorageManager
    }).storage
    if (storage === undefined || typeof storage.persist !== 'function') return
    void storage.persist().catch(() => undefined)
  } catch {
    // Storage API unavailable; not an error for the save flow.
  }
}

async function requestPermission(handle: FSAHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  const permission = await handle.requestPermission({ mode })
  return permission === 'granted'
}

async function writeHandle(handle: FSAHandle, data: string | Blob): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Could not encode the image as a data URL.'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image data.'))
    reader.readAsDataURL(blob)
  })
}

// --- raw storage (fail soft: missing keys return null, never throw) ---

function readRaw(key: string): Promise<string | null> {
  try {
    return Promise.resolve(localStorage.getItem(key))
  } catch {
    return Promise.resolve(null)
  }
}

function writeRaw(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (e.g. private browsing); it simply won't persist.
  }
  return Promise.resolve()
}

const SETTINGS_KEY = 'notedown.settings'
const RECENTS_KEY = 'notedown.recents'
const DRAFT_PREFIX = 'notedown.draft.'
const DRAFT_MIGRATION_KEY = 'notedown.drafts.migrated'

// --- drafts: IndexedDB primary, localStorage fallback + one-time migration ---

/**
 * Move the old `notedown.draft.*` localStorage keys into the IndexedDB drafts
 * store once. The flag is only set after a complete copy, so an unavailable
 * IndexedDB never loses drafts: they stay readable through the localStorage
 * fallback and migration is retried on the next load.
 */
async function migrateLegacyDrafts(): Promise<void> {
  try {
    if (localStorage.getItem(DRAFT_MIGRATION_KEY) === '1') return
  } catch {
    return // localStorage unavailable — there is nothing to migrate.
  }

  const legacy: DraftMigrationSource[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = localStorage.key(i)
      if (storageKey === null || !storageKey.startsWith(DRAFT_PREFIX)) continue
      legacy.push({
        key: storageKey.slice(DRAFT_PREFIX.length),
        content: localStorage.getItem(storageKey) ?? '',
      })
    }
  } catch {
    return // localStorage became unavailable while reading.
  }

  for (const entry of legacy) {
    const stored = await idbPut(DRAFT_STORE, entry)
    if (!stored) return // IndexedDB unavailable — keep using localStorage.
  }

  try {
    for (const entry of legacy) localStorage.removeItem(DRAFT_PREFIX + entry.key)
    localStorage.setItem(DRAFT_MIGRATION_KEY, '1')
  } catch {
    // The copy succeeded; a failure to remove old keys only duplicates data.
  }
}

let draftMigrationPromise: Promise<void> | null = null

function ensureDraftsMigrated(): Promise<void> {
  if (draftMigrationPromise === null) draftMigrationPromise = migrateLegacyDrafts()
  return draftMigrationPromise
}

async function readDraftValue(key: string): Promise<string | null> {
  await ensureDraftsMigrated()
  const record = await idbGet<DraftRecord>(DRAFT_STORE, key)
  if (record !== null && typeof record.content === 'string') return record.content
  return readRaw(DRAFT_PREFIX + key)
}

async function writeDraftValue(key: string, content: string): Promise<void> {
  await ensureDraftsMigrated()
  const stored = await idbPut(DRAFT_STORE, { key, content })
  if (!stored) await writeRaw(DRAFT_PREFIX + key, content)
}

async function clearDraftValue(key: string): Promise<void> {
  await ensureDraftsMigrated()
  await idbDelete(DRAFT_STORE, key)
  try {
    localStorage.removeItem(DRAFT_PREFIX + key)
  } catch {
    // Storage unavailable; nothing to clear.
  }
}

export const browserIO: FileIO = {
  async openFile(): Promise<OpenResult | null> {
    const w = window as WindowWithFSA
    if (typeof w.showOpenFilePicker === 'function') {
      const handles = await pickOpenHandles({
        multiple: false,
        types: MARKDOWN_PICKER_TYPES,
      })
      if (handles === null) return null // user cancelled the picker
      const handle = handles[0]
      if (handle === undefined) return null
      const file = await handle.getFile()
      // Raw text unchanged — the app layer handles BOM/line-ending detection.
      const content = await file.text()
      const path = encodeDocPath('fs', makeKey(), file.name)
      await putHandle(path, handle)
      await putFileSnapshot(path, file.name, content, file.lastModified)
      return { content, name: file.name, path }
    }

    // Fallback (Safari/Firefox): no path or handle exists, so the content
    // snapshot in IndexedDB is what makes Save/Open Recent work later.
    const file = await pickFileWithInput(MARKDOWN_ACCEPT)
    if (file === null) return null // user cancelled the picker
    const content = await file.text()
    const path = encodeDocPath('web', makeKey(), file.name)
    await putFileSnapshot(path, file.name, content, file.lastModified)
    return { content, name: file.name, path }
  },

  /**
   * Pick an importable document via a hidden <input type=file> (browser mode
   * has no native import dialog). Always yields raw bytes as a Uint8Array —
   * `convertToMarkdown` decodes text formats itself. Resolves null when the
   * user cancels (the `cancel` event; no focus fallback, which would race the
   * picker).
   */
  async importFile(): Promise<ImportResult | null> {
    const file = await pickFileWithInput(IMPORT_ACCEPT)
    if (file === null) return null // user cancelled the picker
    const content = new Uint8Array(await file.arrayBuffer())
    const dot = file.name.lastIndexOf('.')
    return {
      content,
      name: file.name,
      ext: dot >= 0 ? file.name.slice(dot).toLowerCase() : '',
    }
  },

  async saveFile(path, content, suggestedName, opts): Promise<string | null> {
    const w = window as WindowWithFSA
    const parsed = path === null ? null : parseDocPath(path)
    const suggested =
      suggestedName ?? parsed?.name ?? (path === null ? 'untitled.md' : fileNameOf(path))

    // Pick a location when the path is unknown, or when Save As forces the
    // picker (alwaysPick). A new key is generated in both cases, never
    // overwriting the existing handle.
    if (path === null || opts?.alwaysPick === true) {
      const name = sanitizeFileName(suggested)
      if (typeof w.showSaveFilePicker === 'function') {
        const handle = await pickSaveHandle({
          suggestedName: name,
          types: pickerTypesFor(opts),
        })
        if (handle === null) return null // user cancelled the picker
        await writeHandle(handle, content)
        const newPath = encodeDocPath('fs', makeKey(), handle.name)
        await putHandle(newPath, handle)
        await putFileSnapshot(newPath, handle.name, content)
        requestPersistentStorage()
        return newPath
      }

      // No save picker: hand the file to the browser's download flow.
      downloadOrThrow(new Blob([content], { type: mimeForSave(opts, name) }), name)
      const webPath = encodeDocPath('web', makeKey(), name)
      await putFileSnapshot(webPath, name, content)
      requestPersistentStorage()
      return webPath
    }

    // Existing download-backed doc: re-download under the same display name and
    // keep its path so the document identity (and Open Recent entry) is stable.
    if (parsed !== null && parsed.kind === 'web') {
      const name = parsed.name
      downloadOrThrow(new Blob([content], { type: mimeForName(name) }), name)
      await putFileSnapshot(path, name, content)
      requestPersistentStorage()
      return path
    }

    // Existing fs: doc (or a legacy bare key) — reuse the stored handle.
    const handle = await findHandle(path, parsed)
    if (handle !== null) {
      if (!(await requestPermission(handle, 'readwrite'))) {
        throw new Error(`Write permission denied for "${path}".`)
      }
      await writeHandle(handle, content)
      // Re-store a handle found under the legacy bare id under its encoded path.
      if (parsed === null) await putHandle(path, handle)
      await putFileSnapshot(path, handle.name, content)
      requestPersistentStorage()
      return path
    }

    // The handle is gone (IndexedDB cleared, permission reset): fall back to a
    // download using the display name encoded in the path. The snapshot keeps
    // Open Recent readable even without a handle.
    const fallbackName = parsed?.name ?? fileNameOf(path)
    downloadOrThrow(new Blob([content], { type: mimeForName(fallbackName) }), fallbackName)
    await putFileSnapshot(path, fallbackName, content)
    requestPersistentStorage()
    return path
  },

  /**
   * Round-9 unified export: binary save for .docx/.pdf via showSaveFilePicker +
   * `writable.write(new Blob([bytes.slice()]))`, or a download when the picker
   * is unavailable.
   */
  async saveBytes(bytes, suggestedName, opts?: { exportKind?: 'docx' | 'pdf' }): Promise<string | null> {
    const w = window as WindowWithFSA
    const name = sanitizeFileName(suggestedName)
    const mime = opts?.exportKind === 'pdf' ? PDF_MIME : DOCX_MIME
    const types = opts?.exportKind === 'pdf' ? PDF_PICKER_TYPES : DOCX_PICKER_TYPES

    if (typeof w.showSaveFilePicker === 'function') {
      const handle = await pickSaveHandle({ suggestedName: name, types })
      if (handle === null) return null // user cancelled the picker
      // Type-honest BlobPart: `.slice()` copies exactly the viewed bytes, so
      // sub-array views (non-zero byteOffset) never leak surrounding buffer
      // bytes into the file.
      await writeHandle(handle, new Blob([bytes.slice()], { type: mime }))
      const newPath = encodeDocPath('fs', makeKey(), handle.name)
      await putHandle(newPath, handle)
      await putFileSnapshot(newPath, handle.name, null)
      requestPersistentStorage()
      return newPath
    }

    downloadOrThrow(new Blob([bytes.slice()], { type: mime }), name)
    const webPath = encodeDocPath('web', makeKey(), name)
    await putFileSnapshot(webPath, name, null)
    requestPersistentStorage()
    return webPath
  },

  async readFile(path): Promise<string> {
    const parsed = parseDocPath(path)

    if (parsed !== null && parsed.kind === 'fs') {
      const handle = await findHandle(path, parsed)
      if (handle !== null) {
        if (!(await requestPermission(handle, 'read'))) {
          throw new Error(`Read permission denied for "${path}".`)
        }
        const file = await handle.getFile()
        const content = await file.text()
        // Refresh the snapshot in case the on-disk file changed since opening.
        await putFileSnapshot(path, file.name, content, file.lastModified)
        return content
      }
      // Handle lost: the text snapshot still satisfies Open Recent.
      const snapshot = await getFileSnapshot(path)
      if (snapshot !== null && typeof snapshot.content === 'string') return snapshot.content
      throw new Error(`No stored file handle for "${path}" — the file must be re-opened.`)
    }

    if (parsed !== null && parsed.kind === 'web') {
      const snapshot = await getFileSnapshot(path)
      if (snapshot !== null && typeof snapshot.content === 'string') return snapshot.content
      throw new Error(`No stored content for "${path}" — the file must be re-opened.`)
    }

    throw new Error(`Unsupported stored path "${path}" — the file must be re-opened.`)
  },

  async confirm(message): Promise<boolean> {
    return window.confirm(message)
  },

  async alert(message): Promise<void> {
    window.alert(message)
  },

  async readSettings(): Promise<string | null> {
    return readRaw(SETTINGS_KEY)
  },
  async writeSettings(json): Promise<void> {
    await writeRaw(SETTINGS_KEY, json)
  },
  async readRecents(): Promise<string | null> {
    return readRaw(RECENTS_KEY)
  },
  async writeRecents(json): Promise<void> {
    await writeRaw(RECENTS_KEY, json)
  },
  async readDraft(key): Promise<string | null> {
    return readDraftValue(key)
  },
  async writeDraft(key, content): Promise<void> {
    await writeDraftValue(key, content)
  },
  async clearDraft(key): Promise<void> {
    await clearDraftValue(key)
  },

  /**
   * Open a URL in a new browser tab. Never opens into the app;
   * `javascript:`/`data:`/`vbscript:` URLs are blocked, and any scheme other
   * than http/https/mailto is unsupported here — the Tauri runtime is the
   * production path for external links.
   */
  async openExternal(url): Promise<void> {
    const scheme = url.split(':')[0]?.toLowerCase() ?? ''
    if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript') {
      console.warn(`[open-external] blocked scheme: ${scheme}`)
      return
    }
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') {
      console.warn(`[open-external] unsupported scheme in browser mode: ${scheme}`)
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  /**
   * Saving an image next to the document is impossible on the web (there is no
   * document folder), so this warns and returns null. Web paste-image uses
   * saveInlineImage instead, which embeds the image as a data URL.
   */
  async saveImage(docPath, filename, blob): Promise<string | null> {
    void docPath
    void filename
    void blob
    console.warn('[paste-image] Pasting images is not supported in browser mode (there is no document folder to save into). Use the Notedown desktop app for paste-image functionality.')
    window.alert('Pasting images is not supported in browser mode (there is no document folder to save into). Use the Notedown desktop app for paste-image functionality.')
    return null
  },

  /**
   * Web-only paste-image surface: encode the image as a data URL so it can be
   * embedded directly in the markdown. data: URLs are base64 (~33% larger) and
   * live inside the document, so cap them at 2 MB to keep documents loadable;
   * larger images need the desktop app's next-to-the-file storage.
   */
  async saveInlineImage(blob, filename): Promise<string | null> {
    void filename
    if (blob.size > INLINE_IMAGE_MAX_BYTES) {
      const message = 'This image is too large to embed (the maximum is 2 MB). Save larger images with the Notedown desktop app.'
      console.warn('[paste-image] image exceeds the 2 MB inline limit')
      window.alert(message)
      return null
    }
    try {
      return await readBlobAsDataUrl(blob)
    } catch (err) {
      console.warn('[paste-image] could not encode the image', err)
      window.alert('Could not embed the pasted image. Please try again or use the Notedown desktop app.')
      return null
    }
  },

  /**
   * Resolve an absolute local path to a URL the webview can render — a
   * Tauri-only surface; web mode cannot read sibling files. Always rejects.
   */
  async exposeImage(absPath): Promise<string> {
    void absPath
    throw new Error('exposeImage is a Tauri-only surface; browser mode cannot read sibling files.')
  },
}

// deleteHandle is unused by FileIO today but kept for future cleanup of stale
// handles; exported for Open Recent pruning compatibility.
export { deleteHandle }
