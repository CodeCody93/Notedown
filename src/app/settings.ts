import type { FileIO } from '../platform/types'

export type ThemeSetting = 'dark' | 'light' | 'system'

export interface Settings {
  theme: ThemeSetting
  fontSize: number
  lineHeight: number
  lineWrapping: boolean
  autosaveDrafts: boolean
  extraMenuAlwaysVisible: boolean
  spellCheck: boolean
  defaultMode: 'live' | 'source'
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontSize: 15,
  lineHeight: 1.6,
  lineWrapping: true,
  autosaveDrafts: true,
  extraMenuAlwaysVisible: false,
  spellCheck: true,
  defaultMode: 'live',
}

// Merge persisted settings onto defaults, keeping only known settings keys.
export function mergeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const merged: Settings = { ...DEFAULT_SETTINGS }
  if (stored === null || stored === undefined) return merged
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = stored[key]
    if (value !== undefined) {
      const target = merged as unknown as Record<string, unknown>
      // 'preview' mode was removed — a stored value from an older build must not
      // resurrect it, so coerce anything outside the narrowed union to 'live'.
      target[key] = key === 'defaultMode' && value !== 'live' && value !== 'source' ? 'live' : value
    }
  }
  return merged
}

// Load persisted settings through FileIO, falling back to defaults for missing or corrupt data.
export async function loadSettings(io: FileIO): Promise<Settings> {
  let raw: string | null = null
  try {
    raw = await io.readSettings()
  } catch {
    return mergeSettings(null)
  }
  if (raw === null) return mergeSettings(null)
  try {
    return mergeSettings(JSON.parse(raw) as Partial<Settings>)
  } catch {
    return mergeSettings(null)
  }
}

export async function saveSettings(io: FileIO, s: Settings): Promise<void> {
  await io.writeSettings(JSON.stringify(s))
}

// Resolve the effective theme, mapping 'system' to the OS preference.
export function resolveTheme(theme: ThemeSetting): 'dark' | 'light' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Single module-level listener so repeated applyTheme calls never stack handlers.
let systemThemeListener: ((event: MediaQueryListEvent) => void) | null = null

export function applyTheme(theme: ThemeSetting): void {
  document.documentElement.dataset.theme = resolveTheme(theme)

  if (systemThemeListener !== null) {
    window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', systemThemeListener)
    systemThemeListener = null
  }
  if (theme === 'system') {
    systemThemeListener = () => {
      document.documentElement.dataset.theme = resolveTheme('system')
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', systemThemeListener)
  }
}
