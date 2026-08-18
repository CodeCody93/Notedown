// Single source of truth for the full hotkey map (PLAN §9).
// 'Mod' means Cmd on macOS, Ctrl elsewhere. The map is deliberately one
// canonical chord per id so the no-duplicate guarantee (findDuplicateChords)
// stays simple. NOTE: PLAN §9 lists optional alternates (e.g. Alt+Shift+5 for
// strikethrough, Ctrl+` for inline code) — they are intentionally NOT added
// here; every action has exactly one chord per platform.
//
// This module is pure and dependency-free: no DOM access at module top level.
// navigator is only touched inside getPlatform(), guarded for node tests.

export type Platform = 'win' | 'mac' | 'linux'

export interface ShortcutDef {
  /** stable action id (also used as menu data-action and formatting command key) */
  id: string
  /** primary chord(s), CM6-compatible syntax, e.g. ['Mod-n'], ['Mod-Shift-s']. 'Mod' = Cmd on macOS, Ctrl elsewhere. */
  keys: string[]
  /** macOS-only override chord(s) (used when the shortcut differs on Mac, e.g. redo) */
  macKeys?: string[]
  /** human display name for menus, e.g. 'Bold', 'Save as' */
  label: string
}

// Keep this array in PLAN §9 table order — it drives menu order elsewhere.
export const SHORTCUTS: ShortcutDef[] = [
  { id: 'new', keys: ['Mod-n'], label: 'New' },
  { id: 'open', keys: ['Mod-o'], label: 'Open' },
  { id: 'open-recent', keys: ['Mod-Shift-o'], label: 'Open Recent' },
  { id: 'save', keys: ['Mod-s'], label: 'Save' },
  { id: 'save-as', keys: ['Mod-Shift-s'], label: 'Save as' },
  { id: 'export-html', keys: ['Mod-Shift-e'], label: 'Export HTML' },
  { id: 'settings', keys: ['Mod-,'], label: 'Settings' },
  { id: 'undo', keys: ['Mod-z'], label: 'Undo' },
  { id: 'redo', keys: ['Mod-Shift-z', 'Mod-y'], macKeys: ['Mod-Shift-z'], label: 'Redo' },
  { id: 'copy', keys: ['Mod-c'], label: 'Copy' },
  { id: 'cut', keys: ['Mod-x'], label: 'Cut' },
  { id: 'paste', keys: ['Mod-v'], label: 'Paste' },
  { id: 'bold', keys: ['Mod-b'], label: 'Bold' },
  { id: 'italic', keys: ['Mod-i'], label: 'Italic' },
  { id: 'underline', keys: ['Mod-u'], label: 'Underline' },
  { id: 'strikethrough', keys: ['Mod-Shift-x'], label: 'Strikethrough' },
  { id: 'header-cycle', keys: ['Mod-Alt-h'], label: 'Header (cycle)' },
  { id: 'header-1', keys: ['Mod-1'], label: 'Heading 1' },
  { id: 'header-2', keys: ['Mod-2'], label: 'Heading 2' },
  { id: 'header-3', keys: ['Mod-3'], label: 'Heading 3' },
  { id: 'header-4', keys: ['Mod-4'], label: 'Heading 4' },
  { id: 'header-5', keys: ['Mod-5'], label: 'Heading 5' },
  { id: 'header-6', keys: ['Mod-6'], label: 'Heading 6' },
  { id: 'header-0', keys: ['Mod-0'], label: 'Clear heading' },
  { id: 'list', keys: ['Mod-Shift-l'], label: 'List' },
  { id: 'list-ordered', keys: ['Mod-Alt-o'], label: 'Ordered list' },
  { id: 'blockquote', keys: ['Mod-Shift-b'], label: 'Blockquote' },
  { id: 'inline-code', keys: ['Mod-e'], label: 'Inline code' },
  { id: 'code-block', keys: ['Mod-Shift-k'], label: 'Code block' },
  { id: 'link', keys: ['Mod-k'], label: 'Link' },
  { id: 'image', keys: ['Mod-Alt-i'], label: 'Image' },
  { id: 'table', keys: ['Mod-Alt-t'], label: 'Table' },
  { id: 'hr', keys: ['Mod-Shift-h'], label: 'Horizontal rule' },
  { id: 'footnote', keys: ['Mod-Shift-f'], label: 'Footnote' },
  { id: 'task-list', keys: ['Mod-Alt-l'], label: 'Task list' },
  { id: 'emoji', keys: ['Mod-Alt-e'], label: 'Emoji picker' },
  { id: 'heading-id', keys: ['Mod-Shift-2'], label: 'Heading ID' },
  { id: 'def-list', keys: ['Mod-Alt-d'], label: 'Definition list' },
  { id: 'sub', keys: ['Mod-Alt-s'], label: 'Subscript' },
  { id: 'sup', keys: ['Mod-Alt-u'], label: 'Superscript' },
  { id: 'highlight', keys: ['Mod-Alt-m'], label: 'Highlight' },
  { id: 'toggle-mode', keys: ['Mod-/'], label: 'Toggle live/source' },
]

/**
 * 'win'|'linux'|'mac' from navigator.platform/userAgent; safe when navigator
 * is undefined (node tests) → defaults to 'win'.
 */
export function getPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'win'
  const platform = typeof navigator.platform === 'string' ? navigator.platform.toLowerCase() : ''
  if (platform.includes('win')) return 'win'
  // macOS and iOS both use Cmd-like modifier semantics; treat them as 'mac'.
  if (
    platform.includes('mac') ||
    platform === 'iphone' ||
    platform === 'ipad' ||
    platform === 'ipod'
  ) {
    return 'mac'
  }
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : ''
  if (ua.includes('Mac OS') || ua.includes('iPhone') || ua.includes('iPad')) return 'mac'
  return 'linux'
}

/**
 * Effective chords for an id honoring macKeys. Empty array if id unknown.
 */
export function keysFor(id: string, platform?: Platform): string[] {
  const def = SHORTCUTS.find((d) => d.id === id)
  if (!def) return []
  const p = platform ?? getPlatform()
  if (p === 'mac' && def.macKeys !== undefined && def.macKeys.length > 0) {
    return def.macKeys
  }
  return def.keys
}

// Display token for the 'Mod' placeholder.
function modToken(platform: Platform): 'Cmd' | 'Ctrl' {
  return platform === 'mac' ? 'Cmd' : 'Ctrl'
}

/**
 * Single-chord display string: 'Mod-n' → 'Ctrl+N' (win/linux) or 'Cmd+N'
 * (mac); 'Mod-,' → 'Ctrl+,'; 'Mod-/' → 'Ctrl+/'; 'Mod-1' → 'Ctrl+1';
 * 'Mod-Alt-h' → 'Ctrl+Alt+H'. Capitalizes a single-letter final key.
 */
export function chordLabel(chord: string, platform?: Platform): string {
  const p = platform ?? getPlatform()
  const mods: string[] = []
  let key = ''
  for (const part of chord.split('-')) {
    if (part === '') continue
    const lower = part.toLowerCase()
    if (lower === 'mod') {
      mods.push(modToken(p))
    } else if (lower === 'shift') {
      mods.push('Shift')
    } else if (lower === 'alt' || lower === 'option') {
      mods.push('Alt')
    } else if (lower === 'ctrl') {
      mods.push('Ctrl')
    } else if (lower === 'cmd' || lower === 'meta') {
      mods.push(modToken(p))
    } else {
      key = part
    }
  }
  const keyLabel = key.length === 1 ? key.toUpperCase() : key
  return [...mods, keyLabel].join('+')
}

/**
 * Display label for an id's first chord. Returns '' if id has no chords.
 */
export function labelFor(id: string, platform?: Platform): string {
  const chords = keysFor(id, platform)
  if (chords.length === 0) return ''
  return chordLabel(chords[0], platform)
}

// Parsed requirements of a chord: which modifiers must be held + the final key.
interface ParsedChord {
  mod: boolean // 'Mod' → metaKey on mac, ctrlKey elsewhere
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  key: string
}

function parseChord(chord: string): ParsedChord {
  const out: ParsedChord = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: '' }
  for (const part of chord.split('-')) {
    if (part === '') continue
    const lower = part.toLowerCase()
    if (lower === 'mod') out.mod = true
    else if (lower === 'ctrl') out.ctrl = true
    else if (lower === 'cmd' || lower === 'meta') out.meta = true
    else if (lower === 'alt' || lower === 'option') out.alt = true
    else if (lower === 'shift') out.shift = true
    else out.key = part
  }
  return out
}

function chordMatches(
  chord: string,
  ev: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string },
  platform: Platform
): boolean {
  const c = parseChord(chord)
  // Final key compared case-insensitively; numbers and ',' and '/' compare directly.
  if (ev.key.toLowerCase() !== c.key.toLowerCase()) return false
  // Required modifier state for this platform: 'Mod' → Ctrl (win/linux) or Cmd
  // (mac). Matching is EXACT — any extra held modifier (e.g. Shift on 'Mod-o')
  // rejects the chord, so Ctrl+Shift+O hits 'open-recent' and never 'open'.
  const ctrlReq = c.ctrl || (c.mod && platform !== 'mac')
  const metaReq = c.meta || (c.mod && platform === 'mac')
  return (
    ev.ctrlKey === ctrlReq &&
    ev.metaKey === metaReq &&
    ev.altKey === c.alt &&
    ev.shiftKey === c.shift
  )
}

/**
 * True if the keyboard event matches any effective chord of the id on the
 * given platform. 'Mod' → (mac ? ev.metaKey : ev.ctrlKey); Shift/Alt map to
 * ev.shiftKey/ev.altKey; final key compared case-insensitively. Modifier
 * matching is EXACT: extra held modifiers (e.g. Ctrl+Shift+O vs 'Mod-o')
 * do not match.
 */
export function matches(
  id: string,
  ev: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string },
  platform?: Platform
): boolean {
  const p = platform ?? getPlatform()
  for (const chord of keysFor(id, p)) {
    if (chordMatches(chord, ev, p)) return true
  }
  return false
}

// Normalize a chord to its effective form on a platform (Mod → Ctrl/Cmd) so
// collisions compare real key sequences, not placeholder tokens.
function effectiveChord(chord: string, platform: Platform): string {
  return chord
    .split('-')
    .map((part) => (part.toLowerCase() === 'mod' ? (platform === 'mac' ? 'Cmd' : 'Ctrl') : part))
    .join('-')
}

/**
 * Returns the ids whose effective chords collide with another id's chords on
 * EITHER platform (the no-duplicate guard used by tests). Empty when clean.
 */
export function findDuplicateChords(): string[] {
  const seen = new Map<string, string>() // effective chord → id
  const dups = new Set<string>()
  for (const platform of ['win', 'mac'] as const) {
    for (const def of SHORTCUTS) {
      for (const chord of keysFor(def.id, platform)) {
        const eff = effectiveChord(chord, platform)
        const previous = seen.get(eff)
        if (previous !== undefined) {
          dups.add(def.id)
          dups.add(previous)
        } else {
          seen.set(eff, def.id)
        }
      }
    }
  }
  return [...dups]
}
