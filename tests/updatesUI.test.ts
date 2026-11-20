// @vitest-environment jsdom
// Check-for-updates dialog (split out of About): idle rendering, the automatic
// check toggle, manual checks against a stubbed GitHub response, the error
// fallback link, open-with-check, and the Escape lifecycle.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_VERSION,
  closeUpdatesModal,
  isUpdatesOpen,
  openUpdatesModal,
  wireUpdatesModal,
} from '../src/app/updatesUI'
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

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Missing element #${id}`)
  return node as T
}

function dialog(): HTMLElement {
  return byId('updates-modal')
}

function queryEl<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = dialog().querySelector<T>(selector)
  if (el === null) throw new Error(`Missing ${selector}`)
  return el
}

describe('updates modal', () => {
  beforeEach(() => {
    openExternalMock.mockReset()
    openExternalMock.mockResolvedValue(undefined)
    onApplyMock.mockReset()
    settings = currentSettings()
    resetUpdateState()
    document.body.innerHTML = '<div id="updates-modal-root"></div>'
    wireUpdatesModal({ getSettings: () => settings, onApply: onApplyMock })
  })

  afterEach(() => {
    closeUpdatesModal()
    vi.unstubAllGlobals()
  })

  it('renders an accessible dialog in the idle state', () => {
    openUpdatesModal()
    expect(isUpdatesOpen()).toBe(true)

    const dlg = dialog()
    expect(dlg.getAttribute('role')).toBe('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.querySelector('.updates-title')?.textContent).toBe('Check for updates')
    expect(dlg.querySelector('.updates-version')?.textContent).toContain(APP_VERSION)

    expect(queryEl<HTMLButtonElement>('.updates-check-updates').textContent).toBe('Check for updates')

    const status = queryEl('.updates-status')
    expect((status.textContent ?? '').trim()).toBe('')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')

    expect(queryEl<HTMLAnchorElement>('.updates-download').hidden).toBe(true)
    expect(queryEl<HTMLAnchorElement>('.updates-release-notes').hidden).toBe(true)
    expect(queryEl<HTMLInputElement>('.updates-auto-update-input').checked).toBe(false)

    closeUpdatesModal()
    expect(isUpdatesOpen()).toBe(false)
  })

  it('reflects and applies the automatic-update setting', () => {
    settings = currentSettings({ autoCheckForUpdates: true })
    openUpdatesModal()
    const input = queryEl<HTMLInputElement>('.updates-auto-update-input')
    expect(input.checked).toBe(true)

    input.checked = false
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onApplyMock).toHaveBeenCalledWith({ autoCheckForUpdates: false })

    closeUpdatesModal()
  })

  it('checks for updates on demand and opens the trusted download link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(releaseResponse()))
    openUpdatesModal()

    queryEl<HTMLButtonElement>('.updates-check-updates').click()
    await vi.waitFor(() => {
      expect(queryEl('.updates-status').textContent).toContain('Notedown v99.0.0 is available.')
    })

    const download = queryEl<HTMLAnchorElement>('.updates-download')
    expect(download.hidden).toBe(false)
    const href = download.getAttribute('href') ?? ''
    expect(href.startsWith(TRUSTED_RELEASE_PREFIX)).toBe(true)

    download.click()
    expect(openExternalMock).toHaveBeenCalledWith(href)

    closeUpdatesModal()
  })

  it('shows a friendly error and a releases fallback link when the check fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    openUpdatesModal()

    queryEl<HTMLButtonElement>('.updates-check-updates').click()
    await vi.waitFor(() => {
      expect(queryEl('.updates-status').textContent).toContain("Couldn't check for updates.")
    })

    const release = queryEl<HTMLAnchorElement>('.updates-release-notes')
    expect(release.hidden).toBe(false)
    expect(release.textContent).toBe('View releases on GitHub')
    expect(release.getAttribute('href')).toBe(RELEASES_PAGE_URL)

    closeUpdatesModal()
  })

  it('openUpdatesModal({ checkForUpdates: true }) starts a check even when already open', async () => {
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse())
    vi.stubGlobal('fetch', fetchMock)
    openUpdatesModal()
    expect(fetchMock).not.toHaveBeenCalled()

    // Already open: the option must still kick off the check.
    openUpdatesModal({ checkForUpdates: true })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    await vi.waitFor(() => {
      expect(queryEl('.updates-status').textContent).toContain('99.0.0')
    })

    closeUpdatesModal()
  })

  it('closes on Escape', () => {
    openUpdatesModal()
    expect(isUpdatesOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isUpdatesOpen()).toBe(false)
  })
})
