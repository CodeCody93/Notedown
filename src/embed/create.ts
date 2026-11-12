/**
 * Public embeddable Notedown editor.
 *
 * This module is the entire public surface of `@codecody93/notedown-editor`:
 * it mounts a self-contained editor (`src/editor/editor.ts` + the live-preview
 * fork) with an optional toolbar, theme handling, image/link policies, and a
 * save keymap. It deliberately imports ONLY the editor core and pure helpers —
 * never the app shell (`src/app/app.ts`, menus, settings), the platform layer,
 * or Tauri.
 *
 * ```ts
 * import { createNotedownEditor } from '@codecody93/notedown-editor'
 *
 * const editor = createNotedownEditor({
 *   mount: '#editor',
 *   value: '# Hello',
 *   toolbar: true,
 *   onChange: (value) => console.log(value),
 * })
 * editor.destroy()
 * ```
 */
import type { KeyBinding } from '@codemirror/view'
import { formattingHotkeyMap, markdownListKeymap } from '../app/formatting'
import { parseOutline, type OutlineHeading } from '../app/outline'
import { createEditor, type EditorController } from '../editor/editor'
import { createEmbedTheme, type EmbedTheme } from './theme'
import {
  createToolbar,
  DEFAULT_TOOLBAR_GROUPS,
  type ToolbarHandle,
  type ToolbarOptions,
} from './toolbar'

/** Editor display mode: rendered live preview or raw markdown source. */
export type NotedownMode = 'live' | 'source'

/** Resolves a markdown image `src` to a renderable URL, or `null` when unresolved. */
export type NotedownImageResolver = (src: string) => Promise<string | null> | string | null

/**
 * Paste-image policy:
 * - a function receives the pasted `File` and returns a URL (or `null` to ignore);
 * - `'inline'` (and the default) embeds the image as a `data:` URL;
 * - `'none'` ignores pasted images.
 */
export type NotedownPasteImageHandler =
  | ((file: File) => Promise<string | null> | string | null)
  | 'inline'
  | 'none'

/** Options accepted by {@link createNotedownEditor}. */
export interface CreateNotedownEditorOptions {
  /** Target element or a CSS selector for it. The element's contents are replaced. */
  mount: HTMLElement | string
  /** Initial markdown document. */
  value?: string
  /** Start in live-preview (`'live'`, default) or raw source mode. */
  mode?: NotedownMode
  /** Color theme. `'system'` follows the OS scheme; `'inherit'` leaves the host in charge. */
  theme?: EmbedTheme
  /** Content is visible/selectable but not editable. Toggle with `setReadOnly`. */
  readOnly?: boolean
  /** Placeholder shown while the document is empty. */
  placeholder?: string
  /** Accessible name for the editor textbox. */
  ariaLabel?: string
  /** Wrapper height: a number is treated as px (`320`) or any CSS length (`'60vh'`). */
  height?: string | number
  /** Editor font size in px. */
  fontSize?: number
  /** Editor line height (unitless multiplier, e.g. `1.6`). */
  lineHeight?: number
  /** Soft-wrap long lines. Default `true`. */
  lineWrapping?: boolean
  /** Native browser spell checking. */
  spellCheck?: boolean
  /** `true`/an options object renders a formatting toolbar; `false`/undefined renders none. */
  toolbar?: boolean | ToolbarOptions
  /** Fires for USER edits (not for `setValue`). */
  onChange?: (value: string) => void
  /** Fires when the caret moves. */
  onCursorChange?: (cursor: { line: number; col: number }) => void
  /** When provided, binds `Mod-s` (Ctrl/Cmd+S) and prevents the browser save dialog. */
  onSave?: (value: string) => void | Promise<void>
  /** Called when a rendered link is clicked. Defaults to opening http(s)/mailto externally. */
  onLinkClick?: (url: string) => void
  /** Resolves relative image paths. Defaults to allowing http(s)/data:image/blob URLs. */
  imageResolver?: NotedownImageResolver
  /** Pasted-image handling. See {@link NotedownPasteImageHandler}. */
  onPasteImage?: NotedownPasteImageHandler
  /** Maximum size for inline `data:` image paste (default 2 MB). Larger files are ignored. */
  maxInlineImageBytes?: number
  /**
   * Additional CodeMirror key-binding groups. They are checked before the
   * built-in formatting/list keymaps, but after the `onSave` `Mod-s` binding.
   */
  extraKeymaps?: KeyBinding[][]
  /** Extra class name(s) added to the `.notedown-editor-root` wrapper. */
  className?: string
}

/** Live editor handle returned by {@link createNotedownEditor}. */
export interface NotedownEditor {
  /** The `.notedown-editor-root` wrapper element. */
  readonly element: HTMLElement
  /** Current markdown document. */
  getValue(): string
  /** Replace the whole document without firing `onChange`. */
  setValue(value: string): void
  /** Focus the editor textbox. */
  focus(): void
  /** Switch between live preview and raw source. */
  setMode(mode: NotedownMode): void
  /** Change the color theme (and replace any active system-scheme listener). */
  setTheme(theme: EmbedTheme): void
  /** Toggle read-only mode in place. */
  setReadOnly(readOnly: boolean): void
  /** Set the font size in px. */
  setFontSize(px: number): void
  /** Enable/disable soft wrapping. */
  setLineWrapping(wrap: boolean): void
  /** Parse the current document's headings into a nested outline. */
  getOutline(): OutlineHeading[]
  /** Escape hatch to the underlying editor controller. */
  getController(): EditorController
  /** Remove listeners, destroy the editor, and detach the wrapper. Idempotent. */
  destroy(): void
}

/** Accepted by the default image resolver: remote, inline data, and object URLs. */
const SAFE_IMAGE_SRC_RE = /^(?:https?:|data:image\/|blob:)/i

/** Accepted by the default link handler. Everything else (javascript:, data:, …) is blocked. */
const SAFE_LINK_RE = /^(?:https?:|mailto:)/i

/** Default cap for inline pasted images (2 MB). */
const DEFAULT_MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024

function resolveMount(mount: HTMLElement | string): HTMLElement {
  if (typeof mount === 'string') {
    const found = document.querySelector<HTMLElement>(mount)
    if (found === null) {
      throw new Error(`Notedown: no element matches the mount selector "${mount}"`)
    }
    return found
  }
  if (mount instanceof HTMLElement) return mount
  throw new Error('Notedown: mount must be an HTMLElement or a CSS selector string')
}

/** First clipboard file whose MIME type is an image, or null. */
function firstImageFile(event: ClipboardEvent): File | null {
  const files = event.clipboardData?.files
  if (!files) return null
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    if (file.type.startsWith('image/')) return file
  }
  return null
}

/** Alt text for a pasted image: the filename without its extension. */
function imageAltText(file: File): string {
  const name = file.name.trim()
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  return stem.length > 0 ? stem : 'image'
}

/** Read a File as a data URL. Resolves null (with a warning) instead of rejecting. */
function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onload = (): void => {
      resolve(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.onerror = (): void => {
      console.warn('Notedown: failed to read the pasted image')
      resolve(null)
    }
    reader.readAsDataURL(file)
  })
}

export function createNotedownEditor(opts: CreateNotedownEditorOptions): NotedownEditor {
  const mountEl = resolveMount(opts.mount)
  // The embed owns the mount: clear any host markup before mounting.
  mountEl.textContent = ''

  const root = document.createElement('div')
  root.className = 'notedown-editor-root'
  if (opts.className !== undefined) {
    for (const name of opts.className.split(/\s+/)) {
      if (name !== '') root.classList.add(name)
    }
  }
  if (opts.height !== undefined) {
    root.style.height = typeof opts.height === 'number' ? `${opts.height}px` : opts.height
  }

  const theme = createEmbedTheme(root, opts.theme ?? 'system')

  const surface = document.createElement('div')
  surface.className = 'notedown-editor-surface'
  root.appendChild(surface)
  mountEl.appendChild(root)

  // Assigned immediately after createEditor returns; the callbacks below can
  // only fire later (user paste/save), never during construction.
  let controller: EditorController | null = null
  let mode: NotedownMode = opts.mode ?? 'live'
  let toolbar: ToolbarHandle | null = null
  let destroyed = false

  const insertImage = (file: File, url: string): void => {
    if (destroyed || controller === null) return
    controller.replaceSelection(`![${imageAltText(file)}](${url})`)
  }

  const pasteImage = opts.onPasteImage
  const maxInlineImageBytes = opts.maxInlineImageBytes ?? DEFAULT_MAX_INLINE_IMAGE_BYTES
  const onPasteImage = (event: ClipboardEvent): void => {
    if (pasteImage === 'none') return
    const file = firstImageFile(event)
    if (file === null) return

    if (typeof pasteImage === 'function') {
      const handler = pasteImage
      void (async (): Promise<void> => {
        try {
          const url = await handler(file)
          if (url !== null && url !== undefined) insertImage(file, url)
        } catch (error) {
          console.warn('Notedown: onPasteImage handler failed', error)
        }
      })()
      return
    }

    // 'inline' or omitted: embed as a data URL, capped to keep documents sane.
    if (file.size > maxInlineImageBytes) {
      console.warn(
        `Notedown: pasted image is ${file.size} bytes, above the ${maxInlineImageBytes}-byte inline limit; ignored`,
      )
      return
    }
    void readFileAsDataUrl(file).then((dataUrl) => {
      if (dataUrl !== null) insertImage(file, dataUrl)
    })
  }

  const userImageResolver = opts.imageResolver
  const imageResolver =
    userImageResolver !== undefined
      ? async (src: string): Promise<string | null> => {
          try {
            return await userImageResolver(src)
          } catch {
            return null
          }
        }
      : async (src: string): Promise<string | null> =>
          SAFE_IMAGE_SRC_RE.test(src) ? src : null

  const userOnLinkClick = opts.onLinkClick
  const onLinkClick =
    userOnLinkClick ??
    ((url: string): void => {
      const safeUrl = url.trim()
      if (!SAFE_LINK_RE.test(safeUrl)) return
      if (typeof window !== 'undefined') {
        window.open(safeUrl, '_blank', 'noopener,noreferrer')
      }
    })

  // Keymap groups are checked in array order (all are raised to Prec.highest by
  // the editor): save first so Mod-s can never fall through to the browser,
  // then caller overrides, then the built-in formatting/list bindings.
  const keymapGroups: KeyBinding[][] = []
  const onSave = opts.onSave
  if (onSave !== undefined) {
    keymapGroups.push([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          try {
            const result = onSave(controller !== null ? controller.getContent() : (opts.value ?? ''))
            if (result !== undefined) {
              void Promise.resolve(result).catch((error: unknown) => {
                console.warn('Notedown: onSave failed', error)
              })
            }
          } catch (error) {
            console.warn('Notedown: onSave failed', error)
          }
          return true
        },
      },
    ])
  }
  if (opts.extraKeymaps !== undefined) keymapGroups.push(...opts.extraKeymaps)
  keymapGroups.push(formattingHotkeyMap(), markdownListKeymap())

  const editor = createEditor(surface, {
    content: opts.value ?? '',
    mode,
    wrap: opts.lineWrapping ?? true,
    fontSize: opts.fontSize,
    lineHeight: opts.lineHeight,
    readOnly: opts.readOnly ?? false,
    placeholder: opts.placeholder,
    ariaLabel: opts.ariaLabel,
    imageResolver,
    onLinkClick,
    onPasteImage,
    extraKeymaps: keymapGroups,
  })
  controller = editor

  if (opts.onChange !== undefined) editor.onChange(opts.onChange)
  if (opts.onCursorChange !== undefined) editor.onCursorChange(opts.onCursorChange)
  editor.setSpellCheck(opts.spellCheck ?? true)

  const applyMode = (next: NotedownMode): void => {
    if (next === mode) return
    mode = next
    editor.setMode(next)
    toolbar?.syncMode(next)
  }

  const toolbarOption = opts.toolbar
  if (toolbarOption !== undefined && toolbarOption !== false) {
    const items =
      typeof toolbarOption === 'object'
        ? (toolbarOption.items ?? DEFAULT_TOOLBAR_GROUPS)
        : DEFAULT_TOOLBAR_GROUPS
    toolbar = createToolbar({
      controller: editor,
      mode,
      items,
      onModeChange: (next) => {
        applyMode(next)
      },
    })
    root.insertBefore(toolbar.element, surface)
  }

  return {
    element: root,
    getValue: (): string => editor.getContent(),
    setValue: (value: string): void => {
      editor.setContent(value)
    },
    focus: (): void => {
      editor.focus()
    },
    setMode: (next: NotedownMode): void => {
      applyMode(next)
    },
    setTheme: (next: EmbedTheme): void => {
      theme.apply(next)
    },
    setReadOnly: (readOnly: boolean): void => {
      editor.setReadOnly(readOnly)
    },
    setFontSize: (px: number): void => {
      editor.setFontSize(px)
    },
    setLineWrapping: (wrap: boolean): void => {
      editor.setWrapping(wrap)
    },
    getOutline: (): OutlineHeading[] => parseOutline(editor.getContent()),
    getController: (): EditorController => editor,
    destroy: (): void => {
      if (destroyed) return
      destroyed = true
      theme.destroy()
      if (toolbar !== null) {
        toolbar.destroy()
        toolbar = null
      }
      editor.destroy()
      root.remove()
    },
  }
}
