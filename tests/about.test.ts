// @vitest-environment jsdom
// About dialog (P4): package-sourced version, GitHub Sponsors link, update
// check controls, and open/close lifecycle.
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
import { DEFAULT_SETTINGS } from '../src/app/settings'
import type { Settings } from '../src/app/settings'
import { resetUpdateState } from '../src/app/updates'

const { openExternalMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn<(url: string) => Promise<void>>(),
}))

vi.mock('../src/platform', () => ({
  getFileIO: () => ({ openExternal: openExternalMock }),
}))

const RELEASES_PAGE_URL = 'https://github.com/CodeCody93/Notedown/releases'
const RELEASE_URL = `${RELEASES_PAGE_URL}/tag/v99.0.0`
const TRUSTED_RELEASE_PREFIX = `${RELEASES_PAGE_URL}/`

const onApplyMock = vi.fn<(patch: Partial<Settings>) => void>()
let settings: Settings

/** Minimal GitHub `releases/latest` payload with a newer, trusted release. */
function releasePayload(): Record<string, unknown> {
  const asset = (name: string): Record<string, string> => ({
    name,
    browser_download_url: `${RELEASES_PAGE_URL}/download/v99.0.0/${name}`,
  })
  return {
    tag_name: 'v99.0.0',
    name: 'Notedown v99.0.0',
    html_url: RELEASE_URL,
    published_at: '2026-01-01T00:00:00Z',
    body: 'A newer release for testing.',
    assets: [
      asset('Notedown_99.0.0_x64_en-US.msi'),
      asset('Notedown_99.0.0_x64-setup.exe'),
      asset('Notedown_99.0.0_amd64.deb'),
      asset('Notedown_99.0.0_amd64.AppImage'),
      asset('Notedown_99.0.0_x64.dmg'),
      asset('Notedown_99.0.0_aarch64.dmg'),
      asset('Notedown_99.0.0_universal.dmg'),
    ],
  }
}

/** Response-shaped stub that works whether updates.ts uses .json() or .text(). */
function releaseResponse(): Response {
  const payload = releasePayload()
  const body = JSON.stringify(payload)
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => body,
  } as unknown as Response
}

function currentSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, autoCheckForUpdates: false, ...overrides }
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
    onApplyMock.mockReset()
    settings = currentSettings()
    resetUpdateState()
    document.body.innerHTML = '<div id="about-modal-root"></div>'
    wireAboutModal({ getSettings: () => settings, onApply: onApplyMock })
  })

  afterEach(() => {
    closeAboutModal()
    vi.unstubAllGlobals()
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

  it('renders the update section with an idle check button and hidden links', () => {
    openAboutModal()
    const section = document.querySelector('.about-update')
    expect(section).toBeTruthy()
    expect(section?.querySelector('.about-check-updates')?.textContent).toBe('Check for updates')
    expect(section?.querySelector('.about-update-status')?.textContent).toBe('')
    expect(section?.querySelector<HTMLAnchorElement>('.about-download')?.hidden).toBe(true)
    expect(section?.querySelector<HTMLAnchorElement>('.about-release-notes')?.hidden).toBe(true)
    closeAboutModal()
  })

  it('reflects autoCheckForUpdates and applies checkbox changes', () => {
    settings = currentSettings({ autoCheckForUpdates: true })
    openAboutModal()
    const input = document.querySelector<HTMLInputElement>('.about-auto-update-input')
    if (input === null) throw new Error('Missing .about-auto-update-input')
    expect(input.checked).toBe(true)

    input.checked = false
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onApplyMock).toHaveBeenCalledWith({ autoCheckForUpdates: false })
    closeAboutModal()
  })

  it('checks for updates on demand and opens the trusted link through the platform layer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(releaseResponse()))
    openAboutModal()

    document.querySelector<HTMLButtonElement>('.about-check-updates')?.click()
    const status = document.querySelector('.about-update-status')
    await vi.waitFor(() => {
      expect(status?.textContent).toContain('Notedown v99.0.0 is available.')
    })

    const download = document.querySelector<HTMLAnchorElement>('.about-download')
    if (download === null) throw new Error('Missing .about-download')
    expect(download.hidden).toBe(false)
    const href = download.getAttribute('href') ?? ''
    expect(href.startsWith(TRUSTED_RELEASE_PREFIX)).toBe(true)

    download.click()
    expect(openExternalMock).toHaveBeenCalledWith(href)
    closeAboutModal()
  })

  it('shows a friendly error and a releases fallback link when the check fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    openAboutModal()

    document.querySelector<HTMLButtonElement>('.about-check-updates')?.click()
    const status = document.querySelector('.about-update-status')
    await vi.waitFor(() => {
      expect(status?.textContent).toContain("Couldn't check for updates.")
    })

    const release = document.querySelector<HTMLAnchorElement>('.about-release-notes')
    if (release === null) throw new Error('Missing .about-release-notes')
    expect(release.hidden).toBe(false)
    expect(release.textContent).toBe('View releases on GitHub')
    expect(release.getAttribute('href')).toBe(RELEASES_PAGE_URL)
    closeAboutModal()
  })

  it('openAboutModal({ checkForUpdates: true }) starts a check even when already open', async () => {
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse())
    vi.stubGlobal('fetch', fetchMock)
    openAboutModal()
    expect(fetchMock).not.toHaveBeenCalled()

    // Already open: the option must still kick off the check.
    openAboutModal({ checkForUpdates: true })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const status = document.querySelector('.about-update-status')
    await vi.waitFor(() => {
      expect(status?.textContent).toContain('99.0.0')
    })
    closeAboutModal()
  })

  it('closes on Escape', () => {
    openAboutModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isAboutOpen()).toBe(false)
  })
})
