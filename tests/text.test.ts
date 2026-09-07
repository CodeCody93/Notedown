import { describe, expect, it } from 'vitest'
import { detectLineEnding, docDir, resolveAgainstDocDir, stripBom } from '../src/app/text'

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

describe('docDir', () => {
  it('posix path: dir + / separator', () => {
    expect(docDir('/docs/notes.md')).toEqual({ dir: '/docs', sep: '/' })
  })

  it('windows path: dir + \\ separator', () => {
    expect(docDir('C:\\docs\\notes.md')).toEqual({ dir: 'C:\\docs', sep: '\\' })
  })

  it('bare filename → empty dir, / separator', () => {
    expect(docDir('notes.md')).toEqual({ dir: '', sep: '/' })
  })

  it('mixed separators split at the LAST one', () => {
    expect(docDir('a/b\\c.md')).toEqual({ dir: 'a/b', sep: '\\' })
  })
})

describe('resolveAgainstDocDir', () => {
  it('resolves a relative path against the doc directory', () => {
    expect(resolveAgainstDocDir('/docs/notes.md', 'other.md')).toBe('/docs/other.md')
  })

  it('resolves an image src against the doc directory', () => {
    expect(resolveAgainstDocDir('/docs/notes.md', 'pic.png')).toBe('/docs/pic.png')
  })

  it('strips a leading ./', () => {
    expect(resolveAgainstDocDir('/docs/notes.md', './other.md')).toBe('/docs/other.md')
  })

  it('strips leading slashes (treats the path as relative to the doc dir)', () => {
    expect(resolveAgainstDocDir('/docs/notes.md', '/other.md')).toBe('/docs/other.md')
  })

  it('uses the doc path separator flavor (windows)', () => {
    expect(resolveAgainstDocDir('C:\\docs\\notes.md', 'pic.png')).toBe('C:\\docs\\pic.png')
  })

  it('bare doc filename (no dir): stays relative (P1 — no leading separator)', () => {
    expect(resolveAgainstDocDir('notes.md', 'pic.png')).toBe('pic.png')
  })
})
