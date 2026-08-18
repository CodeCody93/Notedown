import { describe, expect, it } from 'vitest'
import { detectLineEnding, stripBom } from '../src/app/text'

describe('detectLineEnding', () => {
  it('detects CRLF when text contains \\r\\n', () => {
    expect(detectLineEnding('a\r\nb')).toBe('CRLF')
  })

  it('detects LF for a plain \\n', () => {
    expect(detectLineEnding('a\nb')).toBe('LF')
  })

  it('empty string is LF', () => {
    expect(detectLineEnding('')).toBe('LF')
  })

  it('a lone \\n is LF', () => {
    expect(detectLineEnding('\n')).toBe('LF')
  })

  it('mixed endings evaluate on the first \\r or \\n → CRLF', () => {
    expect(detectLineEnding('a\r\nb\nc')).toBe('CRLF')
  })

  it('a lone \\r (old Mac) is LF', () => {
    expect(detectLineEnding('a\rb')).toBe('LF')
  })
})

describe('stripBom', () => {
  it('no BOM → text unchanged, hadBom false', () => {
    expect(stripBom('hello')).toEqual({ text: 'hello', hadBom: false })
  })

  it('strips a single leading U+FEFF', () => {
    expect(stripBom('\uFEFFhello')).toEqual({ text: 'hello', hadBom: true })
  })

  it('empty string → hadBom false', () => {
    expect(stripBom('')).toEqual({ text: '', hadBom: false })
  })
})
