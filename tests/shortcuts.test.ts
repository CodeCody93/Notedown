import { describe, expect, it } from 'vitest'
import {
  SHORTCUTS,
  chordLabel,
  findDuplicateChords,
  getPlatform,
  keysFor,
  labelFor,
  matches,
} from '../src/app/shortcuts'

// Every id in the PLAN §9 table, in table order.
const ALL_IDS = [
  'new',
  'open',
  'open-recent',
  'save',
  'save-as',
  'export-html',
  'settings',
  'undo',
  'redo',
  'copy',
  'cut',
  'paste',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'header-cycle',
  'header-1',
  'header-2',
  'header-3',
  'header-4',
  'header-5',
  'header-6',
  'header-0',
  'list',
  'list-ordered',
  'blockquote',
  'inline-code',
  'code-block',
  'link',
  'image',
  'table',
  'hr',
  'footnote',
  'task-list',
  'emoji',
  'heading-id',
  'def-list',
  'sub',
  'sup',
  'highlight',
  'toggle-mode',
]

describe('SHORTCUTS table', () => {
  it('covers the full PLAN §9 map, in table order', () => {
    expect(SHORTCUTS.map((d) => d.id)).toEqual(ALL_IDS)
  })

  it('every id has at least one primary chord and a label; no duplicate ids', () => {
    const ids = SHORTCUTS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const def of SHORTCUTS) {
      expect(def.keys.length).toBeGreaterThan(0)
      expect(def.label.length).toBeGreaterThan(0)
    }
  })

  it('has no toggle-preview shortcut (preview mode removed)', () => {
    expect(SHORTCUTS.some((d) => d.id === 'toggle-preview')).toBe(false)
  })

  it('keeps the exact chords for the E6/E12 shortcut additions and image re-chord', () => {
    const byId = new Map(SHORTCUTS.map((d) => [d.id, d]))
    // E12: Ctrl+Shift+I collides with Chromium devtools → switch image to Mod-Alt-i.
    expect(byId.get('image')?.keys).toEqual(['Mod-Alt-i'])
    const chords: Record<string, string[]> = {
      'list-ordered': ['Mod-Alt-o'],
      'task-list': ['Mod-Alt-t'],
      table: ['Mod-t'],
      hr: ['Mod-Shift-h'],
      footnote: ['Mod-Shift-f'],
      emoji: ['Mod-Alt-e'],
      'heading-id': ['Mod-Shift-2'],
      'def-list': ['Mod-Alt-d'],
      // B17 -> E19/E20: Ctrl+Alt+S collided with Windows Snipping Tool, then
      // Mod-Alt-Shift-s (Ctrl+Alt+Shift+S) proved unresponsive (too many
      // modifiers). Moved to Mod-Alt-j (Ctrl+Alt+J / Cmd+Alt+J) which is free.
      sub: ['Mod-Alt-j'],
      sup: ['Mod-Alt-u'],
      highlight: ['Mod-Alt-m'],
    }
    for (const [id, keys] of Object.entries(chords)) {
      expect(byId.get(id)?.keys, `chord for "${id}"`).toEqual(keys)
    }
  })
})

describe('findDuplicateChords', () => {
  it('has no collisions on win or mac (redo Mod-Shift-z vs strikethrough Mod-Shift-x, etc.)', () => {
    expect(findDuplicateChords()).toEqual([])
  })
})

describe('labelFor', () => {
  it("'save-as' → Ctrl+Shift+S on win, Cmd+Shift+S on mac", () => {
    expect(labelFor('save-as', 'win')).toBe('Ctrl+Shift+S')
    expect(labelFor('save-as', 'mac')).toBe('Cmd+Shift+S')
  })

  it("'settings' → Ctrl+, on both platforms", () => {
    expect(labelFor('settings', 'win')).toBe('Ctrl+,')
    expect(labelFor('settings', 'mac')).toBe('Cmd+,')
  })

  it("'toggle-mode' → Ctrl+/", () => {
    expect(labelFor('toggle-mode', 'win')).toBe('Ctrl+/')
  })

  it("'header-1' → Ctrl+1 on win and Cmd+1 on mac", () => {
    expect(labelFor('header-1', 'win')).toBe('Ctrl+1')
    expect(labelFor('header-1', 'mac')).toBe('Cmd+1')
  })

  it("'header-cycle' → Ctrl+Alt+H", () => {
    expect(labelFor('header-cycle', 'win')).toBe('Ctrl+Alt+H')
  })

  it('unknown id → empty string', () => {
    expect(labelFor('nope', 'win')).toBe('')
  })
})

describe('keysFor / redo macKeys', () => {
  it('redo on mac resolves to Mod-Shift-z via macKeys', () => {
    expect(keysFor('redo', 'mac')).toEqual(['Mod-Shift-z'])
  })

  it('redo on win keeps Mod-Shift-z AND Mod-y (Windows redo = Ctrl+Shift+Z)', () => {
    expect(keysFor('redo', 'win')).toEqual(['Mod-Shift-z', 'Mod-y'])
  })

  it('unknown id → empty array', () => {
    expect(keysFor('nope', 'win')).toEqual([])
  })
})

describe('chordLabel', () => {
  it('single-letter final key is capitalized', () => {
    expect(chordLabel('Mod-n', 'win')).toBe('Ctrl+N')
    expect(chordLabel('Mod-n', 'mac')).toBe('Cmd+N')
    expect(chordLabel('Mod-Shift-s', 'win')).toBe('Ctrl+Shift+S')
  })

  it("',' and '/' final keys render directly", () => {
    expect(chordLabel('Mod-,', 'mac')).toBe('Cmd+,')
    expect(chordLabel('Mod-/', 'win')).toBe('Ctrl+/')
  })
})

describe('matches', () => {
  const ctrlS = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 's' }
  const cmdS = { ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 's' }

  it('Ctrl+S matches save on win; Cmd+S does NOT on win', () => {
    expect(matches('save', ctrlS, 'win')).toBe(true)
    expect(matches('save', cmdS, 'win')).toBe(false)
  })

  it('Cmd+S DOES match save on mac', () => {
    expect(matches('save', cmdS, 'mac')).toBe(true)
    expect(matches('save', ctrlS, 'mac')).toBe(false)
  })

  it('Mod+Alt+H matches header-cycle only with ctrlKey+altKey on win', () => {
    const modAltH = { ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, key: 'h' }
    const modH = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'h' }
    expect(matches('header-cycle', modAltH, 'win')).toBe(true)
    expect(matches('header-cycle', modH, 'win')).toBe(false)
  })

  it('Ctrl+Shift+O matches open-recent and NOT open on win (extra modifier rejected)', () => {
    const ctrlShiftO = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'o' }
    expect(matches('open-recent', ctrlShiftO, 'win')).toBe(true)
    expect(matches('open', ctrlShiftO, 'win')).toBe(false)
  })

  it('Cmd+Shift+O matches open-recent and NOT open on mac (extra modifier rejected)', () => {
    const cmdShiftO = { ctrlKey: false, metaKey: true, altKey: false, shiftKey: true, key: 'o' }
    expect(matches('open-recent', cmdShiftO, 'mac')).toBe(true)
    expect(matches('open', cmdShiftO, 'mac')).toBe(false)
  })

  it('Ctrl+Alt+S does NOT match save on win (extra modifier rejected)', () => {
    const ctrlAltS = { ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, key: 's' }
    expect(matches('save', ctrlAltS, 'win')).toBe(false)
  })

  it('Ctrl+Shift+S still matches save-as on win', () => {
    const ctrlShiftS = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 's' }
    expect(matches('save-as', ctrlShiftS, 'win')).toBe(true)
  })

  it("Ctrl+, matches settings on win (comma key path unaffected)", () => {
    const ctrlComma = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: ',' }
    expect(matches('settings', ctrlComma, 'win')).toBe(true)
  })
})

describe('getPlatform', () => {
  it('is safe when navigator is undefined (node) and returns a valid platform', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    try {
      // Simulate a non-browser environment with no navigator at all.
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined })
      expect(getPlatform()).toBe('win')
    } finally {
      if (desc !== undefined) {
        Object.defineProperty(globalThis, 'navigator', desc)
      }
    }
  })

  it('always returns a valid platform even when navigator is present', () => {
    expect(['win', 'mac', 'linux']).toContain(getPlatform())
  })
})
