// @vitest-environment jsdom
// About dialog (P4): package-sourced version, GitHub Sponsors link, and
// open/close lifecycle.
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('renders name, version and a safe sponsor link', () => {
    openAboutModal()
    expect(isAboutOpen()).toBe(true)
    const dialog = document.getElementById('about-modal')
    if (dialog === null) throw new Error('Missing #about-modal')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.querySelector('.about-title')?.textContent).toContain('Notedown')
    expect(dialog.querySelector('.about-version')?.textContent).toContain(APP_VERSION)

    const sponsor = dialog.querySelector('.about-support')
    if (sponsor === null) throw new Error('Missing .about-support')
    expect(sponsor.getAttribute('href')).toBe(SPONSOR_URL)
    expect(sponsor.getAttribute('target')).toBe('_blank')
    expect(sponsor.getAttribute('rel')).toContain('noopener')
    expect(sponsor.textContent).toBe('Sponsor Notedown')

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

  it('closes on Escape', () => {
    openAboutModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isAboutOpen()).toBe(false)
  })
})
