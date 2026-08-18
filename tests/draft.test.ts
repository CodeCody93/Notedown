import { describe, expect, it } from 'vitest'
import { SESSION_KEY, draftKey, parseSession, shouldRecover } from '../src/app/draft'

describe('draftKey', () => {
  it('null → d:untitled', () => {
    expect(draftKey(null)).toBe('d:untitled')
  })

  it('empty string → d:untitled', () => {
    expect(draftKey('')).toBe('d:untitled')
  })

  it('keeps allowed filename characters', () => {
    expect(draftKey('a.md')).toBe('d:a.md')
  })

  it('slugifies slashes and colons to underscore', () => {
    expect(draftKey('c:/dir/file.md')).toBe('d:c__dir_file.md')
  })

  it('spaces become underscores', () => {
    expect(draftKey('my file.md')).toBe('d:my_file.md')
  })
})

describe('parseSession', () => {
  it('null → null', () => {
    expect(parseSession(null)).toBeNull()
  })

  it('empty string → null', () => {
    expect(parseSession('')).toBeNull()
  })

  it('corrupt JSON → null', () => {
    expect(parseSession('{ not json')).toBeNull()
  })

  it('parses a minimal session with null path', () => {
    expect(parseSession('{"name":"x","ts":1}')).toEqual({ path: null, name: 'x', ts: 1 })
  })

  it('parses a session with a path', () => {
    expect(parseSession('{"path":"/a.md","name":"a.md","ts":3}')).toEqual({
      path: '/a.md',
      name: 'a.md',
      ts: 3,
    })
  })

  it('missing string name → null', () => {
    expect(parseSession('{"ts":1}')).toBeNull()
  })
})

describe('shouldRecover', () => {
  const session = { path: null, name: 'x', ts: 1 }

  it('null session → false', () => {
    expect(shouldRecover(null, 'x')).toBe(false)
  })

  it('null draft → false', () => {
    expect(shouldRecover(session, null)).toBe(false)
  })

  it('empty draft → false', () => {
    expect(shouldRecover(session, '')).toBe(false)
  })

  it('session with non-empty draft → true', () => {
    expect(shouldRecover(session, 'x')).toBe(true)
  })
})

describe('SESSION_KEY', () => {
  it('is the session storage key', () => {
    expect(SESSION_KEY).toBe('__session__')
  })
})
