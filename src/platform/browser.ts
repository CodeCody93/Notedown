import type { FileIO, OpenResult } from './types'

// Browser mode is a dev/test surface only — the File System Access API is
// Chromium-only; production runs inside Tauri (see tauri.ts). File handles are
// persisted in IndexedDB so readFile/saveFile can reuse them without re-picking.

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

// --- IndexedDB handle store (FileSystemFileHandle is structured-cloneable) ---

const DB_NAME = 'markitdown.handles'
const DB_VERSION = 1
const HANDLE_STORE = 'handles'

interface HandleRecord {
  id: string
  handle: FSAHandle
}

function withStore(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<any>
): Promise<any> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: 'id' })
      }
    }
    open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'))
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(HANDLE_STORE, mode)
      const request = run(tx.objectStore(HANDLE_STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    }
  })
}

function getHandle(id: string): Promise<FSAHandle | null> {
  return withStore('readonly', (store) => store.get(id)).then((result) => {
    const record = result as HandleRecord | undefined
    return record === undefined ? null : record.handle
  })
}

function putHandle(id: string, handle: FSAHandle): Promise<void> {
  const record: HandleRecord = { id, handle }
  return withStore('readwrite', (store) => store.put(record)).then(() => undefined)
}

function deleteHandle(id: string): Promise<void> {
  return withStore('readwrite', (store) => store.delete(id)).then(() => undefined)
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

function fsUnavailable(): Error {
  return new Error(
    'File System Access API unavailable — browser mode requires Chromium; production runs inside Tauri.'
  )
}

function makeKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

const SETTINGS_KEY = 'markitdown.settings'
const RECENTS_KEY = 'markitdown.recents'
const DRAFT_PREFIX = 'markitdown.draft.'

export const browserIO: FileIO = {
  async openFile(): Promise<OpenResult | null> {
    const w = window as WindowWithFSA
    if (typeof w.showOpenFilePicker !== 'function') throw fsUnavailable()
    const [handle] = await w.showOpenFilePicker({
      multiple: false,
      types: MARKDOWN_PICKER_TYPES,
    })
    const file = await handle.getFile()
    // Raw text unchanged — the app layer handles BOM/line-ending detection.
    const content = await file.text()
    const path = makeKey()
    await putHandle(path, handle)
    return { content, name: file.name, path }
  },

  async saveFile(path, content, suggestedName, opts): Promise<string | null> {
    const w = window as WindowWithFSA
    // Pick a location when the path is unknown, or when Save As forces the
    // picker (alwaysPick). The alwaysPick branch behaves exactly like the
    // null-path branch: a NEW key is generated and stored, never overwriting
    // the existing handle.
    if (path === null || opts?.alwaysPick === true) {
      if (typeof w.showSaveFilePicker !== 'function') throw fsUnavailable()
      const handle = await w.showSaveFilePicker({
        suggestedName: suggestedName ?? 'untitled.md',
        types: opts?.html === true ? HTML_PICKER_TYPES : MARKDOWN_PICKER_TYPES,
      })
      const writable = await handle.createWritable()
      // Verbatim content (preserves CRLF as passed).
      await writable.write(content)
      await writable.close()
      const key = makeKey()
      await putHandle(key, handle)
      return key
    }
    const handle = await getHandle(path)
    if (handle === null) {
      throw new Error(`No stored file handle for "${path}" — the file must be re-opened.`)
    }
    const permission = await handle.requestPermission({ mode: 'readwrite' })
    if (permission !== 'granted') throw new Error(`Write permission denied for "${path}".`)
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    return path
  },

  async readFile(path): Promise<string> {
    const w = window as WindowWithFSA
    if (typeof w.showOpenFilePicker !== 'function') throw fsUnavailable()
    const handle = await getHandle(path)
    if (handle === null) {
      throw new Error(`No stored file handle for "${path}" — the file must be re-opened.`)
    }
    const permission = await handle.requestPermission({ mode: 'read' })
    if (permission !== 'granted') throw new Error(`Read permission denied for "${path}".`)
    const file = await handle.getFile()
    return file.text()
  },

  async confirm(message): Promise<boolean> {
    return window.confirm(message)
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
    return readRaw(DRAFT_PREFIX + key)
  },
  async writeDraft(key, content): Promise<void> {
    await writeRaw(DRAFT_PREFIX + key, content)
  },
  async clearDraft(key): Promise<void> {
    try {
      localStorage.removeItem(DRAFT_PREFIX + key)
    } catch {
      // Storage unavailable; nothing to clear.
    }
  },

  /**
   * Open a URL in a new browser tab (dev/test mode only). Never opens into the
   * app; `javascript:`/`data:`/`vbscript:` URLs are blocked, and any scheme
   * other than http/https/mailto is unsupported here — the Tauri runtime is the
   * production path for external links.
   */
  async openExternal(url): Promise<void> {
    const scheme = url.split(':')[0]?.toLowerCase() ?? ''
    if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript') {
      console.warn(`[open-external] blocked scheme: ${scheme}`)
      return
    }
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') {
      console.warn(`[open-external] unsupported scheme in browser dev mode: ${scheme}`)
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  /**
   * Save an image blob next to the document — impossible in browser dev mode
   * (no directory handle to write into), so this warns and returns null. Use
   * the Tauri runtime for paste-image (PLAN §11).
   */
  async saveImage(docPath, filename, blob): Promise<string | null> {
    void docPath
    void filename
    void blob
    console.warn('[paste-image] Browser dev mode cannot write next to a document (no directory handle); use the Tauri runtime.')
    return null
  },

  /**
   * Resolve an absolute local path to a URL the webview can render — a
   * Tauri-only surface; browser dev mode cannot read sibling files. Always
   * rejects.
   */
  async exposeImage(absPath): Promise<string> {
    void absPath
    throw new Error('exposeImage is a Tauri-only surface; browser dev mode cannot read sibling files.')
  },
}

// deleteHandle is unused by FileIO today but kept for future cleanup of stale
// handles; exported to avoid a noUnusedLocals failure and for Open Recent pruning.
export { deleteHandle }
