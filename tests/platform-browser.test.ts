// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserIO, encodeDocPath, parseDocPath } from '../src/platform/browser'

/** jsdom implements neither IndexedDB nor the File System Access pickers. */

type PickerName = 'showOpenFilePicker' | 'showSaveFilePicker'

function setPicker(name: PickerName, value: unknown): void {
  Object.defineProperty(window, name, { value, configurable: true })
}

function stubDownloadUrls(): { create: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> } {
  const create = vi.fn(() => 'blob:notedown-test')
  const revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true })
  return { create, revoke }
}

// Preserve whatever URL implementation the environment provides (jsdom has no
// createObjectURL; Node's URL does) so restoring never leaks into other files.
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const originalIndexedDb = Object.getOwnPropertyDescriptor(window, 'indexedDB')

function restoreDownloadUrls(): void {
  if (originalCreateObjectURL === undefined) {
    Reflect.deleteProperty(URL, 'createObjectURL')
  } else {
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
  }
  if (originalRevokeObjectURL === undefined) {
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  } else {
    Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
  }
}

beforeEach(() => {
  // Make capability detection deterministic even if the jsdom version ships a
  // partial implementation of the pickers.
  setPicker('showOpenFilePicker', undefined)
  setPicker('showSaveFilePicker', undefined)
  Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  restoreDownloadUrls()
  Reflect.deleteProperty(window, 'showOpenFilePicker')
  Reflect.deleteProperty(window, 'showSaveFilePicker')
  if (originalIndexedDb === undefined) {
    Reflect.deleteProperty(window, 'indexedDB')
  } else {
    Object.defineProperty(window, 'indexedDB', originalIndexedDb)
  }
  localStorage.clear()
})

describe('encoded document paths', () => {
  it('round-trips fs and web paths with their display names', () => {
    expect(encodeDocPath('fs', 'abc-123', 'my notes.md')).toBe('fs:abc-123/my notes.md')
    expect(parseDocPath('fs:abc-123/my notes.md')).toEqual({
      kind: 'fs',
      id: 'abc-123',
      name: 'my notes.md',
    })
    expect(encodeDocPath('web', 'key-1', 'report.pdf')).toBe('web:key-1/report.pdf')
    expect(parseDocPath('web:key-1/report.pdf')).toEqual({
      kind: 'web',
      id: 'key-1',
      name: 'report.pdf',
    })
  })

  it('sanitizes path separators so basename() in app.ts still yields the filename', () => {
    expect(encodeDocPath('fs', 'abc', 'a/b\\c.md')).toBe('fs:abc/a_b_c.md')
    expect(parseDocPath(encodeDocPath('fs', 'abc', 'a/b\\c.md'))?.name).toBe('a_b_c.md')
  })

  it('rejects legacy keys, Tauri paths, and malformed encodings', () => {
    expect(parseDocPath('3f7c-legacy-uuid')).toBeNull()
    expect(parseDocPath('/home/cody/notes.md')).toBeNull()
    expect(parseDocPath('C:\\docs\\notes.md')).toBeNull()
    expect(parseDocPath('fs:abc')).toBeNull()
    expect(parseDocPath('git:abc/name.md')).toBeNull()
  })
})

describe('fallback save/download', () => {
  it('downloads a markdown blob with the right MIME and returns an encoded web path', async () => {
    const { create, revoke } = stubDownloadUrls()
    const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {})
    vi.useFakeTimers()

    const path = await browserIO.saveFile(null, '# hello', 'note.md')

    expect(path).toMatch(/^web:[^/]+\/note\.md$/)
    expect(parseDocPath(path ?? '')).toMatchObject({ kind: 'web', name: 'note.md' })
    expect(create).toHaveBeenCalledTimes(1)
    const blob = create.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('text/markdown')
    expect(click).toHaveBeenCalledTimes(1)

    // The object URL must be revoked only after the click, never before.
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:notedown-test')
  })

  it('re-downloads an existing web path without changing its identity', async () => {
    const { create } = stubDownloadUrls()
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {})
    vi.useFakeTimers()

    const path = encodeDocPath('web', 'existing-id', 'notes.md')
    const saved = await browserIO.saveFile(path, 'updated body')

    expect(saved).toBe(path)
    expect(create).toHaveBeenCalledTimes(1)
    expect((create.mock.calls[0]?.[0] as Blob).type).toBe('text/markdown')

    vi.runAllTimers()
  })

  it('downloads binary exports with the docx MIME type', async () => {
    const { create } = stubDownloadUrls()
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {})
    vi.useFakeTimers()

    const path = await browserIO.saveBytes(new Uint8Array([1, 2, 3]), 'file.docx', {
      exportKind: 'docx',
    })

    expect(path).toMatch(/^web:[^/]+\/file\.docx$/)
    expect(create).toHaveBeenCalledTimes(1)
    expect((create.mock.calls[0]?.[0] as Blob).type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    vi.runAllTimers()
  })

  it('treats a cancelled save picker as a cancel, not an error', async () => {
    setPicker(
      'showSaveFilePicker',
      vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
    )
    await expect(browserIO.saveFile(null, '# hello', 'note.md')).resolves.toBeNull()
  })

  it('treats a cancelled binary-export picker as a cancel too', async () => {
    setPicker(
      'showSaveFilePicker',
      vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
    )
    await expect(browserIO.saveBytes(new Uint8Array([1, 2, 3]), 'file.pdf', { exportKind: 'pdf' })).resolves.toBeNull()
  })
})

describe('saveInlineImage', () => {
  it('rejects images over the 2 MB cap with a user-facing alert', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const tooLarge = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/png' })

    const result = await browserIO.saveInlineImage!(tooLarge, 'big.png')

    expect(result).toBeNull()
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0]?.[0]).toMatch(/2 MB/)
  })

  it('returns a data URL for images within the cap', async () => {
    const small = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })

    const result = await browserIO.saveInlineImage!(small, 'small.png')

    expect(result).toMatch(/^data:image\/png;base64,/)
  })
})

describe('draft fallback', () => {
  it('uses localStorage when IndexedDB is unavailable, and clearDraft clears both', async () => {
    await browserIO.writeDraft('d:test', 'hello draft')
    expect(localStorage.getItem('notedown.draft.d:test')).toBe('hello draft')
    await expect(browserIO.readDraft('d:test')).resolves.toBe('hello draft')

    await browserIO.clearDraft('d:test')
    expect(localStorage.getItem('notedown.draft.d:test')).toBeNull()
    await expect(browserIO.readDraft('d:test')).resolves.toBeNull()
  })
})
