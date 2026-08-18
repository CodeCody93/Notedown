import { describe, expect, it } from 'vitest'
import { MAX_RECENTS, addRecent, parseRecents, removeRecent, type RecentEntry } from '../src/app/recent'

function entry(path: string, name: string, lastOpened = 0): RecentEntry {
  return { path, name, lastOpened }
}

describe('parseRecents', () => {
  it('null → empty array', () => {
    expect(parseRecents(null)).toEqual([])
  })

  it('empty string → empty array', () => {
    expect(parseRecents('')).toEqual([])
  })

  it('valid JSON array is parsed', () => {
    const json = JSON.stringify([entry('/a.md', 'a.md', 1)])
    expect(parseRecents(json)).toEqual([entry('/a.md', 'a.md', 1)])
  })

  it('malformed JSON → empty array', () => {
    expect(parseRecents('{ not json')).toEqual([])
  })

  it('non-array JSON → empty array', () => {
    expect(parseRecents('{"a":1}')).toEqual([])
  })

  it('filters entries missing string path or name', () => {
    const json = JSON.stringify([
      { path: '/ok.md', name: 'ok.md', lastOpened: 2 },
      { name: 'no-path', lastOpened: 2 },
      { path: '/no-name', lastOpened: 2 },
      { path: 42, name: 'bad-path', lastOpened: 2 },
      { path: '/bad-name', name: 7, lastOpened: 2 },
    ])
    expect(parseRecents(json)).toEqual([entry('/ok.md', 'ok.md', 2)])
  })
})

describe('addRecent', () => {
  it('adds a new entry to the front', () => {
    const out = addRecent([entry('b', 'b.md', 1)], { path: 'a', name: 'a.md' })
    expect(out.map((r) => r.path)).toEqual(['a', 'b'])
    expect(out[0].lastOpened).toBeGreaterThanOrEqual(out[1].lastOpened)
  })

  it('dedupes by path, replacing and moving to front', () => {
    const out = addRecent([entry('a', 'a.md', 1), entry('b', 'b.md', 2)], { path: 'a', name: 'a.md' })
    expect(out.map((r) => r.path)).toEqual(['a', 'b'])
    expect(out).toHaveLength(2)
    expect(out[0].lastOpened).toBeGreaterThanOrEqual(out[1].lastOpened)
  })

  it('caps the list at MAX_RECENTS, dropping the oldest', () => {
    let recents: RecentEntry[] = []
    for (let i = 0; i < MAX_RECENTS; i++) {
      recents = addRecent(recents, { path: `p${i}`, name: `p${i}.md` })
    }
    expect(recents).toHaveLength(MAX_RECENTS)
    const out = addRecent(recents, { path: 'new', name: 'new.md' })
    expect(out).toHaveLength(MAX_RECENTS)
    expect(out[0].path).toBe('new')
    expect(out.map((r) => r.path)).not.toContain('p0')
  })

  it('returns a new array and leaves the input unchanged', () => {
    const input = [entry('a', 'a.md', 1)]
    const out = addRecent(input, { path: 'b', name: 'b.md' })
    expect(out).not.toBe(input)
    expect(input).toEqual([entry('a', 'a.md', 1)])
  })
})

describe('removeRecent', () => {
  it('removes the matching path', () => {
    const out = removeRecent([entry('a', 'a.md', 1), entry('b', 'b.md', 2)], 'a')
    expect(out.map((r) => r.path)).toEqual(['b'])
  })

  it('non-matching path leaves the list unchanged', () => {
    const out = removeRecent([entry('a', 'a.md', 1)], 'zzz')
    expect(out.map((r) => r.path)).toEqual(['a'])
  })

  it('empty array stays empty', () => {
    expect(removeRecent([], 'a')).toEqual([])
  })
})
