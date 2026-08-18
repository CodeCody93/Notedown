import type { FileIO } from './types'
import { runtime } from './detect'
import { browserIO } from './browser'
import { tauriIO } from './tauri'

let instance: FileIO | null = null
export function getFileIO(): FileIO {
  if (instance === null) instance = runtime === 'tauri' ? tauriIO : browserIO
  return instance
}
