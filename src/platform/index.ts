import type { FileIO } from './types'
import { isTauri } from '@tauri-apps/api/core'
import { browserIO } from './browser'
import { tauriIO } from './tauri'

let instance: FileIO | null = null
export function getFileIO(): FileIO {
  // Decide at call-time via isTauri() — the cached `runtime` const in
  // detect.ts may be stale if evaluated before Tauri internals were ready.
  // First call happens in initApp() after Tauri is ready; the instance is
  // then cached for the lifetime of the app.
  if (instance === null) instance = isTauri() ? tauriIO : browserIO
  return instance
}
