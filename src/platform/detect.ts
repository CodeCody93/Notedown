import { isTauri } from '@tauri-apps/api/core'

export type Runtime = 'browser' | 'tauri'

// Browser mode is a dev/test surface only (the File System Access API is
// Chromium-only); production runs inside Tauri.
export const runtime: Runtime = isTauri() ? 'tauri' : 'browser'

export const isMobile: boolean =
  runtime === 'tauri' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
