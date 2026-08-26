// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { buildImageRef, imageFileName, pasteImage, pasteText } from '../src/app/clipboard'
import type { EditorController } from '../src/editor/editor'
import type { FileIO } from '../src/platform/types'

/** Minimal fake controller carrying a replaceSelection spy (cast: tests only use the methods clipboard.ts calls). */
function makeController(): EditorController {
  return {
    replaceSelection: vi.fn(),
    runCommand: vi.fn(),
  } as unknown as EditorController
}

/** Fake FileIO exercising only saveImage — the only member clipboard.ts's pasteImage calls. */
function makeIo(
  saveImage: (docPath: string | null, filename: string, blob: Blob) => Promise<string | null>,
): FileIO {
  return { saveImage } as unknown as FileIO
}

/** ClipboardEvent-shaped object with the given file list (null = no clipboardData at all). */
function fakeEvent(files: File[] | null): ClipboardEvent {
  const clipboardData = files === null ? null : { files: files as unknown as FileList }
  return { clipboardData } as unknown as ClipboardEvent
}

describe('buildImageRef', () => {
  it('defaults the alt to the filename stem', () => {
    expect(buildImageRef('a.png')).toBe('![a](a.png)')
  })

  it('honours a custom alt', () => {
    expect(buildImageRef('a.png', 'My alt')).toBe('![My alt](a.png)')
  })
})

describe('imageFileName', () => {
  it('derives ext from mime and strips the doc extension from the stem', () => {
    expect(imageFileName('notes.md', 0, 'image/png')).toBe('notes-0.png')
    expect(imageFileName('a.b.c.txt', 0, 'image/jpeg')).toBe('a.b.c-0.jpg')
  })

  it('defaults to .png when mime is undefined', () => {
    expect(imageFileName('notes.md', 0)).toBe('notes-0.png')
  })
})

describe('pasteImage', () => {
  it('resolves without inserting when clipboardData.files is empty or null', async () => {
    const io = makeIo(async () => null)
    const empty = makeController()
    await pasteImage(empty, io, { name: 'notes.md', path: null }, fakeEvent([]))
    expect(empty.replaceSelection).not.toHaveBeenCalled()

    const none = makeController()
    await pasteImage(none, io, { name: 'notes.md', path: null }, fakeEvent(null))
    expect(none.replaceSelection).not.toHaveBeenCalled()
  })

  it('does not insert a ref when io.saveImage returns null (cancelled/unavailable)', async () => {
    const saveImage = vi.fn(async () => null)
    const io = makeIo(saveImage)
    const controller = makeController()
    const file = new File(['image-bytes'], 'shot.png', { type: 'image/png' })
    await pasteImage(controller, io, { name: 'notes.md', path: '/docs/notes.md' }, fakeEvent([file]))
    // The doc path, the generated filename, and the image File are forwarded to
    // io.saveImage; a null result (cancelled picker / platform cannot save) means
    // no broken reference is inserted.
    expect(saveImage).toHaveBeenCalledWith(
      '/docs/notes.md',
      expect.stringMatching(/^notes-\d+\.png$/),
      file,
    )
    expect(controller.replaceSelection).not.toHaveBeenCalled()
  })

  it('inserts the markdown ref when the image was saved', async () => {
    const io = makeIo(async () => '/docs/notes-123.png')
    const controller = makeController()
    const file = new File(['image-bytes'], 'shot.png', { type: 'image/png' })
    await pasteImage(controller, io, { name: 'notes.md', path: '/docs/notes.md' }, fakeEvent([file]))
    // The ref is built from the generated filename, not the saved path.
    expect(controller.replaceSelection).toHaveBeenCalledWith(
      expect.stringMatching(/^!\[notes-\d+\]\(notes-\d+\.png\)$/),
    )
  })
})

describe('pasteText', () => {
  it('resolves without throwing when the async clipboard API is unavailable', async () => {
    // jsdom typically lacks navigator.clipboard (and even a denied read is caught
    // and routed to the execCommand fallback), so this must never reject.
    await expect(pasteText(makeController())).resolves.toBeUndefined()
  })

  it('wraps a pasted URL as a markdown link', async () => {
    const controller = makeController()
    const readText = vi.fn(async () => 'https://www.example.com')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    await pasteText(controller)
    expect(controller.replaceSelection).toHaveBeenCalledWith('[https://www.example.com](https://www.example.com)')
  })

  it('trims whitespace before URL detection', async () => {
    const controller = makeController()
    const readText = vi.fn(async () => '  https://example.com/path  ')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    await pasteText(controller)
    expect(controller.replaceSelection).toHaveBeenCalledWith('[https://example.com/path](https://example.com/path)')
  })

  it('does not wrap non-URL text', async () => {
    const controller = makeController()
    const readText = vi.fn(async () => 'hello world')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    await pasteText(controller)
    expect(controller.replaceSelection).toHaveBeenCalledWith('hello world')
  })

  it('does not wrap ftp:// URLs', async () => {
    const controller = makeController()
    const readText = vi.fn(async () => 'ftp://files.example.com')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    await pasteText(controller)
    expect(controller.replaceSelection).toHaveBeenCalledWith('ftp://files.example.com')
  })
})
