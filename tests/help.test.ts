// @vitest-environment jsdom
// Help content + modal (P4): entry coverage of every FORMATTING_COMMANDS key,
// no duplicate ids, hotkeyId validity against SHORTCUTS, and a TOC/section
// rendering smoke test through openHelpModal.
import { beforeEach, describe, expect, it } from 'vitest'
import { HELP_ENTRIES, HELP_SUMMARY, missingHelpIds } from '../src/app/helpContent'
import { FORMATTING_COMMANDS } from '../src/app/formatting'
import { EXTRA_MENU, FILE_MENU, TOOLBAR_GROUPS, type MenuEntry } from '../src/app/menu'
import { SHORTCUTS, chordLabel, keysFor } from '../src/app/shortcuts'
import { closeHelpModal, isHelpOpen, openHelpModal, wireHelpModal } from '../src/app/help'

const CORE_FILE_IDS = [
  'new',
  'open',
  'open-recent',
  'save',
  'save-as',
  'export',
  'import',
  'settings',
  'toggle-mode',
  'navigator',
  'help',
  'about',
  'find',
  'replace',
  'undo',
  'redo',
  'copy',
  'cut',
  'paste',
]

/** Menu entries that only open a submenu (not user-facing actions of their own). */
const STRUCTURAL_MENU_IDS = new Set(['header', 'extra', 'open-recent-list'])

function collectMenuActionIds(): string[] {
  const ids: string[] = []
  const walk = (entries: MenuEntry[]): void => {
    for (const entry of entries) {
      if (!STRUCTURAL_MENU_IDS.has(entry.id)) ids.push(entry.id)
      if (entry.children !== undefined) walk(entry.children)
    }
  }
  walk([...FILE_MENU, ...EXTRA_MENU, ...TOOLBAR_GROUPS.flat()])
  return [...new Set(ids)]
}

function entryById(id: string) {
  const entry = HELP_ENTRIES.find((e) => e.id === id)
  if (entry === undefined) throw new Error(`Missing help entry ${id}`)
  return entry
}

describe('help content', () => {
  it('covers every FORMATTING_COMMANDS key', () => {
    expect(missingHelpIds(Object.keys(FORMATTING_COMMANDS))).toEqual([])
  })

  it('covers the core file/app, editing, and search ids', () => {
    expect(missingHelpIds(CORE_FILE_IDS)).toEqual([])
  })

  it('documents every SHORTCUTS chord through some entry hotkeyId', () => {
    const documented = new Set(HELP_ENTRIES.map((e) => e.hotkeyId).filter((id): id is string => id !== null))
    const undisplayed = SHORTCUTS.filter((s) => !documented.has(s.id)).map((s) => s.id)
    expect(undisplayed).toEqual([])
  })

  it('covers every menu and toolbar action id', () => {
    expect(missingHelpIds(collectMenuActionIds())).toEqual([])
  })

  it('has no duplicate ids', () => {
    const ids = HELP_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a non-empty summary', () => {
    expect(HELP_SUMMARY.trim().length).toBeGreaterThan(0)
  })

  it('uses only null or known SHORTCUTS ids for hotkeyId', () => {
    const known = new Set(SHORTCUTS.map((s) => s.id))
    for (const entry of HELP_ENTRIES) {
      if (entry.hotkeyId !== null) expect(known.has(entry.hotkeyId)).toBe(true)
    }
  })

  it('missingHelpIds reports unknown ids', () => {
    expect(missingHelpIds(['bold', 'no-such-id'])).toEqual(['no-such-id'])
  })
})

describe('help modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="help-modal-root"></div>'
    wireHelpModal()
  })

  it('renders summary, TOC and one section per entry', () => {
    openHelpModal()
    expect(isHelpOpen()).toBe(true)
    const dialog = document.getElementById('help-modal')
    if (dialog === null) throw new Error('Missing #help-modal')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    const summary = dialog.querySelector('.help-summary')
    if (summary === null) throw new Error('Missing .help-summary')
    expect(summary.textContent).toBe(HELP_SUMMARY)

    const links = dialog.querySelectorAll('.help-toc-link')
    expect(links.length).toBe(HELP_ENTRIES.length)
    for (const entry of HELP_ENTRIES) {
      const section = document.getElementById(`help-${entry.id}`)
      if (section === null) throw new Error(`Missing section #help-${entry.id}`)
      expect(section.querySelector('h3')?.textContent).toBe(entry.title)
      expect(section.querySelector('.help-example')?.textContent).toBe(entry.example)
    }
    // spot-check: bold section shows its syntax and a hotkey hint
    const bold = entryById('bold')
    const boldSection = document.getElementById('help-bold')
    if (boldSection === null) throw new Error('Missing #help-bold')
    expect(boldSection.querySelector('.help-syntax')?.textContent).toBe(bold.syntax)
    expect((boldSection.querySelector('.help-hotkey')?.textContent ?? '').length).toBeGreaterThan(0)

    closeHelpModal()
    expect(isHelpOpen()).toBe(false)
  })

  it('starts hidden, opens visibly, and hides again on close', () => {
    const root = document.getElementById('help-modal-root')
    if (root === null) throw new Error('Missing #help-modal-root')
    expect(root.hidden).toBe(true)
    openHelpModal()
    expect(root.hidden).toBe(false)
    closeHelpModal()
    expect(root.hidden).toBe(true)
  })

  it('renders every effective chord for multi-chord actions', () => {
    openHelpModal()
    const redo = document.getElementById('help-redo')
    if (redo === null) throw new Error('Missing #help-redo')
    const rendered = Array.from(redo.querySelectorAll('.help-hotkey')).map((el) => el.textContent)
    const expected = keysFor('redo', 'win').map((chord) => chordLabel(chord, 'win'))
    expect(expected.length).toBeGreaterThan(1)
    expect(rendered).toEqual(expected)
  })

  it('TOC links scroll in place without changing the URL hash', () => {
    openHelpModal()
    window.location.hash = ''
    const link = document.querySelector<HTMLAnchorElement>('a.help-toc-link[href="#help-export"]')
    if (link === null) throw new Error('Missing Export TOC link')
    const notCancelled = link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(notCancelled).toBe(false)
    expect(window.location.hash).toBe('')
  })

  it('closes on Escape', () => {
    openHelpModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isHelpOpen()).toBe(false)
  })
})
