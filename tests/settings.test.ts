import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/app/settings'

describe('DEFAULT_SETTINGS', () => {
  it('matches the §12 defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'system',
      fontSize: 15,
      lineHeight: 1.6,
      lineWrapping: true,
      autosaveDrafts: true,
      extraMenuAlwaysVisible: false,
      spellCheck: true,
      defaultMode: 'live',
    })
  })
})

describe('mergeSettings', () => {
  it('null → defaults', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('undefined → defaults', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('empty object → defaults', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('partial merge keeps defaults except the overridden key', () => {
    const merged = mergeSettings({ theme: 'dark' })
    expect(merged.theme).toBe('dark')
    expect(merged.fontSize).toBe(DEFAULT_SETTINGS.fontSize)
    expect(merged.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight)
    expect(merged.lineWrapping).toBe(DEFAULT_SETTINGS.lineWrapping)
    expect(merged.autosaveDrafts).toBe(DEFAULT_SETTINGS.autosaveDrafts)
    expect(merged.extraMenuAlwaysVisible).toBe(DEFAULT_SETTINGS.extraMenuAlwaysVisible)
    expect(merged.spellCheck).toBe(DEFAULT_SETTINGS.spellCheck)
    expect(merged.defaultMode).toBe(DEFAULT_SETTINGS.defaultMode)
  })

  it('spellCheck: passes a stored false through and defaults to true when absent', () => {
    expect(mergeSettings({ spellCheck: false }).spellCheck).toBe(false)
    expect(mergeSettings({}).spellCheck).toBe(true)
  })

  it('coerces a stored defaultMode of "preview" (mode removed) back to live', () => {
    const merged = mergeSettings({ defaultMode: 'preview' as unknown as 'live' | 'source' })
    expect(merged.defaultMode).toBe('live')
  })

  it('drops unknown keys and applies known ones', () => {
    const merged = mergeSettings({ bogus: 123, theme: 'light' })
    expect(merged).not.toHaveProperty('bogus')
    expect(merged.theme).toBe('light')
  })
})
