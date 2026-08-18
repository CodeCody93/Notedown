import { invoke } from '@tauri-apps/api/core'
import type { FileIO, OpenResult } from './types'

// Desktop paths only for now; mobile content:// URI I/O lands in M5 (Android/iOS).

// Wrap invoke rejections into plain Errors so callers handle one error shape.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

export const tauriIO: FileIO = {
  async openFile(): Promise<OpenResult | null> {
    return call<OpenResult | null>('pick_and_read')
  },

  async saveFile(path, content, suggestedName, opts): Promise<string | null> {
    if (path === null || opts?.alwaysPick === true) {
      const picked = await call<string | null>('pick_save_path', {
        suggested: suggestedName ?? 'untitled.md',
        html: opts?.html ?? false,
      })
      if (picked === null) return null // user cancelled the picker
      await call<void>('write_file', { path: picked, content })
      return picked
    }
    await call<void>('write_file', { path, content })
    return path
  },

  async readFile(path): Promise<string> {
    return call<string>('read_file', { path })
  },

  async confirm(message): Promise<boolean> {
    return call<boolean>('confirm_dialog', { message })
  },

  async readSettings(): Promise<string | null> {
    return call<string | null>('read_settings')
  },
  async writeSettings(json): Promise<void> {
    await call<void>('write_settings', { json })
  },
  async readRecents(): Promise<string | null> {
    return call<string | null>('read_recents')
  },
  async writeRecents(json): Promise<void> {
    await call<void>('write_recents', { json })
  },
  async readDraft(key): Promise<string | null> {
    return call<string | null>('read_draft', { key })
  },
  async writeDraft(key, content): Promise<void> {
    await call<void>('write_draft', { key, content })
  },
  async clearDraft(key): Promise<void> {
    await call<void>('clear_draft', { key })
  },

  /** Open a URL in the default external browser via the Rust `open_external` command (tauri-plugin-opener). `javascript:`/`data:`/`vbscript:` URLs are rejected before the call. */
  async openExternal(url): Promise<void> {
    const scheme = url.split(':')[0]?.toLowerCase() ?? ''
    if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript') {
      throw new Error(`Blocked external URL scheme: ${scheme}`)
    }
    await call<void>('open_external', { url })
  },

  /**
   * Save a pasted image next to the document via the Rust `write_image`
   * command (PLAN §11). `docPath` null (unsaved doc) → the Rust side asks the
   * user for a folder first; a null result means the user cancelled.
   * NOTE: invoke() serializes the JS number array into the Rust `Vec<u8>` arg.
   */
  async saveImage(docPath, filename, blob): Promise<string | null> {
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
    return call<string | null>('write_image', { docPath, filename, bytes })
  },

  /**
   * Resolve an absolute local path to a URL the webview can render via the
   * Rust `expose_image` command. M4 uses `data:` URLs; M5+ may switch to
   * Tauri's asset protocol if large pasted images make data URLs too heavy.
   */
  async exposeImage(absPath): Promise<string> {
    return call<string>('expose_image', { absPath })
  },
}
