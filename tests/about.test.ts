// @vitest-environment jsdom
// About dialog: package-sourced version, GitHub Sponsors link, one-paragraph
// summary, and open/close lifecycle. Update checking lives in its own dialog
// (tests/updatesUI.test.ts); About must not grow update controls again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pkg from '../package.json'
import {
  ABOUT_SUMMARY,
  APP_VERSION,
  SPONSOR_URL,
  closeAboutModal,
  isAboutOpen,
  openAboutModal,
  wireAboutModal,
} from '../src/app/about'

const { openExternalMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn<(url: string) => Promise<void>>(),
}))

vi.mock('../src/platform', () => ({
  getFileIO: () => ({ openExternal: openExternalMock }),
}))

/** Selectors that belonged to the old update panel embedded in About. */
const REMOVED_UPDATE_SELECTORS = [
  '.about-update',
  '.about-check-updates',
  '.about-update-status',
  '.about-download',
  '.about-release-notes',
  '.about-auto-update-input',
]

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Missing element #${id}`)
  return node as T
}

describe('about constants', () => {
  it('uses the root package version', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('points at the GitHub Sponsors page', () => {
    expect(SPONSOR_URL).toBe('https://github.com/sponsors/CodeCody93')
  })

  it('has a non-empty summary', () => {
    expect(ABOUT_SUMMARY.trim().length).toBeGreaterThan(0)
  })
})

describe('about modal', () => {
  beforeEach(() => {
    openExternalMock.mockReset()
    openExternalMock.mockResolvedValue(undefined)
    document.body.innerHTML = '<div id="about-modal-root"></div>'
    wireAboutModal()
  })

  afterEach(() => {
    closeAboutModal()
  })

  it('renders name, version and a safe sponsor link', () => {
    openAboutModal()
    expect(isAboutOpen()).toBe(true)

    const dialog = byId('about-modal')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.querySelector('.about-title')?.textContent).toContain('Notedown')
    expect(dialog.querySelector('.about-version')?.textContent).toContain(APP_VERSION)

    const sponsor = dialog.querySelector<HTMLAnchorElement>('.about-support')
    if (sponsor === null) throw new Error('Missing .about-support')
    expect(sponsor.getAttribute('href')).toBe(SPONSOR_URL)
    expect(sponsor.getAttribute('target')).toBe('_blank')
    expect(sponsor.getAttribute('rel')).toContain('noopener')
    expect(sponsor.textContent).toBe('Support Notedown')
    expect(sponsor.getAttribute('aria-label')).toBe('Support Notedown on GitHub Sponsors')
    expect(sponsor.getAttribute('title')).toBe('Opens GitHub Sponsors in your browser')

    closeAboutModal()
    expect(isAboutOpen()).toBe(false)
  })

  it('opens the sponsor link through the platform layer', () => {
    openAboutModal()
    const sponsor = document.querySelector<HTMLAnchorElement>('.about-support')
    if (sponsor === null) throw new Error('Missing .about-support')
    sponsor.click()
    expect(openExternalMock).toHaveBeenCalledWith(SPONSOR_URL)
    closeAboutModal()
  })

  it('keeps update controls out of the About dialog', () => {
    openAboutModal()
    for (const selector of REMOVED_UPDATE_SELECTORS) {
      expect(document.querySelector(selector), `Unexpected ${selector} in About`).toBeNull()
    }
    closeAboutModal()
  })

  it('closes on Escape', () => {
    openAboutModal()
    expect(isAboutOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isAboutOpen()).toBe(false)
  })
})
