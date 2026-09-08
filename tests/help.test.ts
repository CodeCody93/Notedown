// @vitest-environment jsdom
// Help content + modal (P4): entry coverage of every FORMATTING_COMMANDS key,
// no duplicate ids, hotkeyId validity against SHORTCUTS, and a TOC/section
// rendering smoke test through openHelpModal.
import { beforeEach, describe, expect, it } from 'vitest'
import { HELP_ENTRIES, HELP_SUMMARY, missingHelpIds } from '../src/app/helpContent'
import { FORMATTING_COMMANDS } from '../src/app/formatting'
import { SHORTCUTS } from '../src/app/shortcuts'
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
]

function entryById(id: string) {
  const entry = HELP_ENTRIES.find((e) => e.id === id)
  if (entry === undefined) throw new Error(`Missing help entry ${id}`)
  return entry
}

describe('help content', () => {
  it('covers every FORMATTING_COMMANDS key', () => {
    expect(missingHelpIds(Object.keys(FORMATTING_COMMANDS))).toEqual([])
  })

  it('covers the core file/app feature ids', () => {
    expect(missingHelpIds(CORE_FILE_IDS)).toEqual([])
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

  it('closes on Escape', () => {
    openHelpModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isHelpOpen()).toBe(false)
  })
})
