// Emoji picker popover — a small searchable emoji palette anchored near an
// element. Shared by the app menubar (src/app/menu.ts) and the embeddable
// toolbar.
//
// Plain DOM (createElement + textContent for emoji chars/names), so there is no
// injection surface. One picker instance at a time; click-outside / Escape
// closes.

/** Curated emoji palette (char + searchable name). */
export const EMOJI_LIST: { char: string; name: string }[] = [
  { char: '😀', name: 'grinning face' },
  { char: '😃', name: 'smiley face with open mouth' },
  { char: '😄', name: 'smiling face with open mouth and smiling eyes' },
  { char: '😁', name: 'beaming face with smiling eyes' },
  { char: '😂', name: 'face with tears of joy' },
  { char: '🤣', name: 'rolling on the floor laughing' },
  { char: '😊', name: 'smiling face with smiling eyes' },
  { char: '😇', name: 'smiling face with halo' },
  { char: '🙂', name: 'slightly smiling face' },
  { char: '🙃', name: 'upside-down face' },
  { char: '😉', name: 'winking face' },
  { char: '😍', name: 'smiling face with heart-eyes' },
  { char: '😘', name: 'face blowing a kiss' },
  { char: '😋', name: 'face savoring food' },
  { char: '😎', name: 'smiling face with sunglasses' },
  { char: '🤔', name: 'thinking face' },
  { char: '🤗', name: 'hugging face' },
  { char: '🤩', name: 'star-struck face' },
  { char: '😢', name: 'crying face' },
  { char: '😭', name: 'loudly crying face' },
  { char: '😅', name: 'grinning face with sweat' },
  { char: '😳', name: 'flushed face' },
  { char: '😴', name: 'sleeping face' },
  { char: '😷', name: 'face with medical mask' },
  { char: '🤒', name: 'face with thermometer' },
  { char: '😈', name: 'smiling face with horns' },
  { char: '👻', name: 'ghost' },
  { char: '💀', name: 'skull' },
  { char: '👋', name: 'waving hand' },
  { char: '🤚', name: 'raised back of hand' },
  { char: '👌', name: 'ok hand' },
  { char: '✌️', name: 'victory hand' },
  { char: '🤞', name: 'crossed fingers' },
  { char: '👍', name: 'thumbs up' },
  { char: '👎', name: 'thumbs down' },
  { char: '👏', name: 'clapping hands' },
  { char: '🙌', name: 'raising hands' },
  { char: '🤝', name: 'handshake' },
  { char: '🙏', name: 'folded hands' },
  { char: '💪', name: 'flexed biceps' },
  { char: '👀', name: 'eyes' },
  { char: '🧠', name: 'brain' },
  { char: '❤️', name: 'red heart' },
  { char: '🧡', name: 'orange heart' },
  { char: '💛', name: 'yellow heart' },
  { char: '💚', name: 'green heart' },
  { char: '💙', name: 'blue heart' },
  { char: '💜', name: 'purple heart' },
  { char: '🖤', name: 'black heart' },
  { char: '🤍', name: 'white heart' },
  { char: '💔', name: 'broken heart' },
  { char: '💕', name: 'two hearts' },
  { char: '💯', name: 'hundred points' },
  { char: '✨', name: 'sparkles' },
  { char: '⭐', name: 'star' },
  { char: '🌟', name: 'glowing star' },
  { char: '💫', name: 'dizzy' },
  { char: '🔥', name: 'fire' },
  { char: '💧', name: 'droplet' },
  { char: '❄️', name: 'snowflake' },
  { char: '☀️', name: 'sun' },
  { char: '🌙', name: 'crescent moon' },
  { char: '🌈', name: 'rainbow' },
  { char: '☁️', name: 'cloud' },
  { char: '⚡', name: 'high voltage' },
  { char: '⏰', name: 'alarm clock' },
  { char: '⌛', name: 'hourglass done' },
  { char: '📅', name: 'calendar' },
  { char: '📌', name: 'pushpin' },
  { char: '📍', name: 'round pushpin' },
  { char: '✂️', name: 'scissors' },
  { char: '🔗', name: 'link symbol' },
  { char: '✏️', name: 'pencil' },
  { char: '📝', name: 'memo' },
  { char: '📁', name: 'file folder' },
  { char: '📂', name: 'open file folder' },
  { char: '📄', name: 'page facing up' },
  { char: '📎', name: 'paperclip' },
  { char: '🔍', name: 'magnifying glass tilted left' },
  { char: '💡', name: 'light bulb' },
  { char: '🔔', name: 'bell' },
  { char: '✅', name: 'check mark button' },
  { char: '❌', name: 'cross mark' },
  { char: '❗', name: 'red exclamation mark' },
  { char: '❓', name: 'red question mark' },
  { char: '✔️', name: 'check mark' },
  { char: '➡️', name: 'right arrow' },
  { char: '⬅️', name: 'left arrow' },
  { char: '⬆️', name: 'up arrow' },
  { char: '⬇️', name: 'down arrow' },
  { char: '↩️', name: 'right arrow curving left' },
  { char: '🔃', name: 'clockwise vertical arrows' },
  { char: '🔄', name: 'counterclockwise arrows button' },
  { char: '🔢', name: 'input numbers' },
  { char: '🔣', name: 'input symbols' },
  { char: '#️⃣', name: 'hash keycap' },
  { char: '*️⃣', name: 'asterisk keycap' },
  { char: '0️⃣', name: 'keycap digit zero' },
  { char: '1️⃣', name: 'keycap digit one' },
  { char: '2️⃣', name: 'keycap digit two' },
  { char: '3️⃣', name: 'keycap digit three' },
]

export interface EmojiPickerOptions {
  /** Element that owns the popover. Defaults to document.body. */
  container?: HTMLElement
  /** Extra class name(s) added to the popover root. */
  className?: string
  /** Position the popover with position: fixed (needed inside the embed toolbar). */
  fixed?: boolean
}

export interface EmojiPickerHandle {
  /** Close this picker if it is still the active one. Idempotent. */
  close(): void
}

let emojiPicker: { root: HTMLElement; cleanup: () => void } | null = null

/** Close any open emoji picker (no-op when none is open). */
export function closeEmojiPicker(): void {
  if (emojiPicker === null) return
  emojiPicker.cleanup()
  emojiPicker = null
}

/** Close only when `root` is the currently active picker (safe after cleanup). */
function closeIfActive(root: HTMLElement): void {
  if (emojiPicker === null || emojiPicker.root !== root) return
  emojiPicker.cleanup()
  emojiPicker = null
}

/**
 * Build & show a small searchable emoji popover anchored near `anchor`; clicking
 * an emoji calls `onPick(emoji)` and closes. One instance at a time (any existing
 * picker is closed first). Click-outside / Escape closes.
 */
export function openEmojiPicker(
  anchor: HTMLElement,
  onPick: (emoji: string) => void,
  options?: EmojiPickerOptions
): EmojiPickerHandle {
  closeEmojiPicker()

  const container = options?.container ?? document.body
  const root = document.createElement('div')
  const classNames = ['emoji-picker']
  const extraClasses = options?.className
  if (extraClasses !== undefined) {
    classNames.push(...extraClasses.split(/\s+/).filter((name) => name !== ''))
  }
  root.className = classNames.join(' ')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Emoji picker')
  if (options?.fixed === true) root.style.position = 'fixed'

  const handle: EmojiPickerHandle = { close: () => closeIfActive(root) }

  const input = document.createElement('input')
  input.className = 'emoji-search'
  input.type = 'text'
  input.placeholder = 'Search emoji…'
  input.setAttribute('aria-label', 'Search emoji')

  const grid = document.createElement('div')
  grid.className = 'emoji-grid'

  const renderGrid = (query: string): void => {
    grid.textContent = ''
    const q = query.trim().toLowerCase()
    for (const e of EMOJI_LIST) {
      if (q !== '' && !e.name.toLowerCase().includes(q)) continue
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'emoji-cell'
      cell.textContent = e.char
      cell.title = e.name
      cell.addEventListener('click', () => {
        onPick(e.char)
        closeEmojiPicker()
      })
      grid.appendChild(cell)
    }
  }

  input.addEventListener('input', () => renderGrid(input.value))

  root.append(input, grid)
  renderGrid('')

  // When opened via hotkey the anchor is the full editor (view.dom, .cm-editor)
  // whose rect is the whole editor pane (left 0, bottom at pane bottom) — that
  // would place the picker at the left edge below the editor and out of view.
  // Detect the editor root and re-anchor to the caret (or centered top) instead.
  let anchorRect = anchor.getBoundingClientRect()
  const isEditorAnchor =
    anchor.classList.contains('cm-editor') ||
    anchor.classList.contains('cm-content') ||
    anchor.querySelector('.cm-content') !== null
  if (isEditorAnchor) {
    const cursorEl = anchor.querySelector('.cm-cursor') as HTMLElement | null
    if (cursorEl !== null) {
      const r = cursorEl.getBoundingClientRect()
      // Place below the caret; if caret coords are empty (detached), fall back.
      if (r.width !== 0 || r.height !== 0) {
        anchorRect = r as DOMRect
      }
    }
    if (cursorEl === null || (anchorRect.width === 0 && anchorRect.height === 0)) {
      // Fallback: center-top of the editor, just below the toolbar area.
      const pickerHalf = 122 // 244px / 2
      const centerX = anchor.getBoundingClientRect().left + anchor.getBoundingClientRect().width / 2
      const left = Math.max(8, Math.min(centerX - pickerHalf, window.innerWidth - 244 - 8))
      const top = Math.max(8, Math.round(anchor.getBoundingClientRect().top + 48))
      root.style.left = `${Math.round(left)}px`
      root.style.top = `${top}px`
      container.appendChild(root)
      const onDocMousedown = (ev: MouseEvent): void => {
        const t = ev.target
        if (t instanceof Node && root.contains(t)) return
        closeEmojiPicker()
      }
      const onDocKey = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape') closeEmojiPicker()
      }
      document.addEventListener('mousedown', onDocMousedown)
      document.addEventListener('keydown', onDocKey)
      setTimeout(() => input.focus(), 0)
      emojiPicker = {
        root,
        cleanup: () => {
          document.removeEventListener('mousedown', onDocMousedown)
          document.removeEventListener('keydown', onDocKey)
          root.remove()
        },
      }
      return handle
    }
  }
  // Clamp to viewport so the picker never overflows horizontally and stays
  // visible when the anchor is near the right edge (toolbar Extra button) or
  // when the caret is near the viewport edge.
  const pickerWidth = 244
  let left = Math.round(anchorRect.left)
  let top = Math.round(anchorRect.bottom + 6)
  // If anchor is the caret (isEditorAnchor true above), anchorRect is the
  // caret rect — keep the picker below it; for toolbar buttons, anchorRect
  // is the button rect (bottom is below the button). Both work with the same
  // formula.
  left = Math.max(8, Math.min(left, window.innerWidth - pickerWidth - 8))
  // If the picker would overflow the bottom edge, flip it above the anchor.
  const pickerHeight = 260 // approx (search + grid)
  if (top + pickerHeight > window.innerHeight - 8) {
    const flipped = Math.round(anchorRect.top - pickerHeight - 6)
    if (flipped >= 8) top = flipped
  }
  top = Math.max(8, top)
  root.style.left = `${left}px`
  root.style.top = `${top}px`

  container.appendChild(root)

  const onDocMousedown = (ev: MouseEvent): void => {
    const t = ev.target
    if (t instanceof Node && root.contains(t)) return
    closeEmojiPicker()
  }
  const onDocKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') closeEmojiPicker()
  }
  document.addEventListener('mousedown', onDocMousedown)
  document.addEventListener('keydown', onDocKey)
  setTimeout(() => input.focus(), 0)

  emojiPicker = {
    root,
    cleanup: () => {
      document.removeEventListener('mousedown', onDocMousedown)
      document.removeEventListener('keydown', onDocKey)
      root.remove()
    },
  }
  return handle
}
