// @vitest-environment jsdom
// About dialog (P4): placeholder support URL, version rendering, support
// anchor attributes, and open/close lifecycle.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ABOUT_SUMMARY,
  APP_VERSION,
  SUPPORT_URL,
  closeAboutModal,
  isAboutOpen,
  openAboutModal,
  wireAboutModal,
} from '../src/app/about'

describe('about constants', () => {
  it('pins the app version', () => {
    expect(APP_VERSION).toBe('0.6.0')
  })

  it('keeps SUPPORT_URL as a replace-me placeholder', () => {
    expect(SUPPORT_URL.startsWith('https://')).toBe(true)
    expect(SUPPORT_URL).toContain('TODO')
  })

  it('has a non-empty summary', () => {
    expect(ABOUT_SUMMARY.trim().length).toBeGreaterThan(0)
  })
})

describe('about modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="about-modal-root"></div>'
    wireAboutModal()
  })

  it('renders name, version and a safe support link', () => {
    openAboutModal()
    expect(isAboutOpen()).toBe(true)
    const dialog = document.getElementById('about-modal')
    if (dialog === null) throw new Error('Missing #about-modal')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.querySelector('.about-title')?.textContent).toContain('Notedown')
    expect(dialog.querySelector('.about-version')?.textContent).toContain(APP_VERSION)

    const support = dialog.querySelector('.about-support')
    if (support === null) throw new Error('Missing .about-support')
    expect(support.getAttribute('href')).toBe(SUPPORT_URL)
    expect(support.getAttribute('target')).toBe('_blank')
    expect(support.getAttribute('rel')).toContain('noopener')
    expect(support.textContent).toBe('Support Notedown')

    closeAboutModal()
    expect(isAboutOpen()).toBe(false)
  })

  it('closes on Escape', () => {
    openAboutModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isAboutOpen()).toBe(false)
  })
})
