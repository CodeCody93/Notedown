import { isTauri } from '@tauri-apps/api/core'

export type Runtime = 'browser' | 'tauri'

// Browser mode is a dev/test surface only (the File System Access API is
// Chromium-only); production runs inside Tauri.

/** Call-time runtime check — never cache at module load (Tauri internals may not be ready yet). */
export function getRuntime(): Runtime {
  return isTauri() ? 'tauri' : 'browser'
}

/**
 * @deprecated Prefer getRuntime() or isTauri() at call-time. This const is
 * evaluated once at module load and may be stale ("browser") if Tauri
 * internals were not yet injected. Kept for backward compat only.
 */
export const runtime: Runtime = isTauri() ? 'tauri' : 'browser'

/** Call-time mobile check — derived from getRuntime() so it is never stale. */
export function isMobileDevice(): boolean {
  return getRuntime() === 'tauri' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/**
 * @deprecated Prefer isMobileDevice() at call-time. Cached at module load and
 * may be stale. Kept for backward compat (e.g. clipboard.ts).
 */
export const isMobile: boolean =
  runtime === 'tauri' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
