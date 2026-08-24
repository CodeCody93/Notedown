import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@tauri-apps/api/core'
import type { KeyBinding } from '@codemirror/view'
import type { EditorController } from '../editor/editor'
import { getFileIO } from '../platform'
import type { FileIO, OpenResult } from '../platform/types'
import {
  SESSION_KEY,
  clearDraft,
  clearSession,
  draftKey,
  parseSession,
  saveDraft,
  shouldRecover,
  writeSession,
} from './draft'
import { renderStandaloneHtml, renderStandaloneHtmlWithImages } from './export'
import { addRecent, parseRecents, removeRecent } from './recent'
import { applyTheme, loadSettings, resolveTheme } from './settings'
import type { Settings } from './settings'
import { appState } from './state'
import type { CurrentDoc } from './state'
import { detectLineEnding, resolveAgainstDocDir, stripBom } from './text'
import { copySelection, cutSelection, pasteImage, pasteText } from './clipboard'
import { FORMATTING_COMMANDS, markdownListKeymap } from './formatting'
import { formattingHotkeyMap, openEmojiPicker, renderMenubar } from './menu'
import { openSettingsModal, wireSettingsModal } from './settingsUI'
import { SHORTCUTS, getPlatform, matches } from './shortcuts'

const AUTOSAVE_DEBOUNCE_MS = 3000

let io: FileIO
let draftTimer: number | null = null
let editor: EditorController | null = null

// Last value of the extra-pinned menubar setting, so the subscribe re-renders the
// menubar only when the setting actually changes (not on every keystroke/state change).
let lastExtraPinned = false

// Last serialized recents, so the subscribe re-renders the recent list only
// when the list actually changes (not on every keystroke/state change).
let lastRecentsJson = ''

// Cache of resolved image URLs keyed by `${docPath}::${absPath}` — resolving a
// local image to a data: URL is expensive, and the same image typically appears
// many times in a live-preview doc.
const imageCache = new Map<string, string>()

// Tracks the previous doc.dirty so the subscribe can detect the dirty→clean
// transition (e.g. undo back to the saved content) and drop the autosaved
// draft. Init false is fine: the subscribe fires only after initApp.
let lastDirty = false

function basename(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base || path
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Missing element #${id}`)
  return node
}

/** Current editor cursor (1-based line/col), or null when the editor is not up yet. */
function currentCursor(): { line: number; col: number } | null {
  return editor?.getCursor() ?? null
}

/**
 * Platform message dialog. FileIO.alert is the native dialog in Tauri
 * (window.alert is a no-op inside the webview — user-results C9); the local
 * fallback keeps this compiling/running even if a FileIO implementation lacks
 * `alert`.
 */
async function showAlert(message: string): Promise<void> {
  const alertFn = (io as FileIO & { alert?: (message: string) => Promise<void> }).alert
  if (alertFn !== undefined) {
    await alertFn(message)
  } else {
    window.alert(message)
  }
}

export function getEditor(): EditorController | null {
  return editor
}

function docFromContent(content: string, path: string | null, name: string, dirty: boolean): CurrentDoc {
  const { text, hadBom } = stripBom(content)
  return {
    path,
    name,
    content: text,
    savedContent: text,
    dirty,
    lineEnding: detectLineEnding(text),
    encoding: hadBom ? 'utf-8-bom' : 'utf-8',
  }
}

async function confirmDiscard(): Promise<boolean> {
  const doc = appState.get().doc
  if (!doc.dirty) return true
  return io.confirm(`Discard unsaved changes to ${doc.name}?`)
}

async function newDoc(): Promise<void> {
  if (!(await confirmDiscard())) return
  await clearDraft(io, appState.get().doc.path)
  appState.set({
    doc: {
      path: null,
      name: 'untitled.md',
      content: '',
      savedContent: '',
      dirty: false,
      lineEnding: 'LF',
      encoding: 'utf-8',
    },
  })
  await writeSession(io, { path: null, name: 'untitled.md', ts: Date.now(), cursor: currentCursor() })
}

async function openDoc(): Promise<void> {
  if (!(await confirmDiscard())) return
  const prevPath = appState.get().doc.path
  let result: OpenResult
  try {
    const opened = await io.openFile()
    if (opened === null) return
    result = opened
  } catch (err) {
    await showAlert(`Open failed: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  await clearDraft(io, prevPath)
  appState.set({ doc: docFromContent(result.content, result.path, result.name, false) })
  const recents = addRecent(appState.get().recents, { path: result.path ?? '', name: result.name })
  appState.set({ recents })
  await io.writeRecents(JSON.stringify(recents))
  await writeSession(io, { path: result.path, name: result.name, ts: Date.now(), cursor: currentCursor() })
}

async function saveDoc(): Promise<void> {
  const doc = appState.get().doc
  if (doc.path === null) {
    await saveAsDoc()
    return
  }
  const saved = await io.saveFile(doc.path, doc.content)
  if (saved === null) return
  appState.set({ doc: { ...doc, dirty: false, savedContent: doc.content } })
  const recents = addRecent(appState.get().recents, { path: doc.path, name: doc.name })
  appState.set({ recents })
  await io.writeRecents(JSON.stringify(recents))
  await clearDraft(io, doc.path)
  await writeSession(io, { path: doc.path, name: doc.name, ts: Date.now(), cursor: currentCursor() })
}

async function saveAsDoc(): Promise<void> {
  const doc = appState.get().doc
  const saved = await io.saveFile(doc.path, doc.content, doc.name, { alwaysPick: true })
  if (saved === null) return
  const newName = basename(saved)
  appState.set({ doc: { ...doc, path: saved, name: newName, dirty: false, savedContent: doc.content } })
  const recents = addRecent(appState.get().recents, { path: saved, name: newName })
  appState.set({ recents })
  await io.writeRecents(JSON.stringify(recents))
  if (doc.path !== null) await clearDraft(io, doc.path)
  await writeSession(io, { path: saved, name: newName, ts: Date.now(), cursor: currentCursor() })
}

async function openRecent(path: string): Promise<void> {
  if (!(await confirmDiscard())) return
  let content: string
  try {
    content = await io.readFile(path)
  } catch (err) {
    // C9: the entry must be removed from recents, and the user must SEE an error
    // (window.alert is a no-op in the Tauri webview → FileIO.alert).
    const entry = appState.get().recents.find((r) => r.path === path)
    const label = entry?.name ?? path
    await showAlert(
      `Could not open "${label}": the file was not found or could not be read. It has been removed from Open Recent.`
    )
    console.warn('Open recent failed', err)
    const recents = removeRecent(appState.get().recents, path)
    appState.set({ recents })
    await io.writeRecents(JSON.stringify(recents))
    return
  }
  const prevRecents = appState.get().recents
  const entry = prevRecents.find((r) => r.path === path)
  const name = entry?.name ?? path.split(/[\\/]/).pop() ?? path
  appState.set({ doc: docFromContent(content, path, name, false) })
  const recents = addRecent(prevRecents, { path, name })
  appState.set({ recents })
  await io.writeRecents(JSON.stringify(recents))
  await writeSession(io, { path, name, ts: Date.now(), cursor: currentCursor() })
}

async function clearRecents(): Promise<void> {
  appState.set({ recents: [] })
  await io.writeRecents('[]')
}

// Export the current doc as a standalone, styled HTML file (PLAN §14 / §19).
// K3 — local raster images next to the doc (e.g. `pic.png`) are inlined as
// `data:` URLs via `exposeImage` so the exported HTML is self-contained and
// works offline; `pic.svg` is intentionally NOT embedded (rejected by
// expose_image as scriptable, CSP would block a relative svg anyway).
async function exportHtml(): Promise<void> {
  const doc = appState.get().doc
  const opts = {
    title: doc.name,
    theme: resolveTheme(appState.get().settings.theme),
  } as const
  let html: string
  try {
    html = await renderStandaloneHtmlWithImages(doc.content, opts, doc.path, (abs) => io.exposeImage(abs))
  } catch {
    // Inline path failed for an unexpected reason (e.g. exposeImage transport
    // error) — fall back to the plain render so export still succeeds; svg
    // and per-image failures are already handled inside inlineMarkdownImages.
    html = renderStandaloneHtml(doc.content, opts)
  }
  const htmlName = doc.name.replace(/\.[^./\\]+$/, '') + '.html'
  try {
    const saved = await io.saveFile(null, html, htmlName, { html: true })
    if (saved === null) return // user cancelled the save dialog
  } catch (err) {
    await showAlert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function setContent(content: string): void {
  const doc = appState.get().doc
  // dirty derives from the savedContent baseline, so undoing back to the last
  // saved state clears the dirty dot (and the autosaved draft gets dropped).
  appState.set({ doc: { ...doc, content, dirty: content !== doc.savedContent } })
}

export function updateSettings(patch: Partial<Settings>): void {
  const settings = { ...appState.get().settings, ...patch }
  appState.set({ settings })
  applyTheme(settings.theme)
  applyEditorSettings(settings)
  io.writeSettings(JSON.stringify(settings)).catch((err) => {
    console.warn('Settings save failed', err)
  })
}

function applyEditorSettings(s: Settings): void {
  if (s.defaultMode !== appState.get().mode) {
    editor?.setMode(s.defaultMode === 'source' ? 'source' : 'live')
  }
  editor?.setWrapping(s.lineWrapping)
  editor?.setFontSize(s.fontSize)
  editor?.setLineHeight(s.lineHeight)
  // Other #6: spell check toggle. `?? true` guards a persisted value missing the
  // key (mergeSettings fills defaults, but the guard is free).
  editor?.setSpellCheck(s.spellCheck ?? true)
}

export function setMode(mode: 'live' | 'source'): void {
  appState.set({ mode })
  editor?.setMode(mode)
}

function scheduleDraftSave(doc: CurrentDoc): void {
  if (draftTimer !== null) {
    clearTimeout(draftTimer)
  }
  draftTimer = window.setTimeout(() => {
    draftTimer = null
    saveDraft(io, doc.path, doc.content)
      .then(() => {
        // I1/I2: capture the cursor AT SAVE time (not at schedule time — the
        // timer is re-armed on every keystroke) so recovery can restore it.
        const cursor = editor?.getCursor() ?? null
        return writeSession(io, { path: doc.path, name: doc.name, ts: Date.now(), cursor })
      })
      .catch((err) => {
        console.warn('Draft save failed', err)
      })
  }, AUTOSAVE_DEBOUNCE_MS)
}

async function recover(): Promise<void> {
  try {
    const session = parseSession(await io.readDraft(SESSION_KEY))
    if (session === null) return
    const draft = await io.readDraft(draftKey(session.path))
    if (!shouldRecover(session, draft)) return
    const ok = await io.confirm(`Recover unsaved changes to ${session.name}?`)
    if (ok) {
      // The recovered draft becomes the new savedContent baseline
      // (docFromContent sets savedContent = content), so undoing back to the
      // draft clears the dirty flag — the draft is the reference point, not
      // the possibly-stale file on disk.
      appState.set({ doc: docFromContent(draft ?? '', session.path, session.name, true) })
      // I1/I2: restore the cursor saved with the draft. The subscribe above
      // applies the content synchronously inside appState.set, so the editor
      // is ready (and its undo history was just reset for the new document).
      if (session.cursor !== null) {
        editor?.setCursor(session.cursor.line, session.cursor.col)
      }
    } else {
      await clearDraft(io, session.path)
    }
  } catch (err) {
    console.warn('Recovery failed', err)
  } finally {
    try {
      await clearSession(io)
    } catch (err) {
      console.warn('Clearing session failed', err)
    }
  }
}

function renderRecents(): void {
  const container = document.getElementById('recent-list')
  if (container === null) return
  container.textContent = ''
  const recents = appState.get().recents
  if (recents.length === 0) {
    const empty = document.createElement('button')
    empty.type = 'button'
    empty.className = 'menu-item'
    empty.disabled = true
    empty.textContent = 'No recent files'
    container.appendChild(empty)
    return
  }
  for (const rec of recents) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'menu-item'
    btn.dataset.path = rec.path
    btn.title = rec.path
    btn.style.flexDirection = 'column'
    btn.style.alignItems = 'flex-start'
    btn.style.gap = '1px'
    const label = document.createElement('span')
    label.className = 'menu-label'
    label.textContent = rec.name
    const pathEl = document.createElement('span')
    pathEl.className = 'recent-path'
    pathEl.textContent = rec.path
    pathEl.style.color = 'var(--muted)'
    pathEl.style.fontSize = '11px'
    pathEl.style.maxWidth = '100%'
    pathEl.style.overflow = 'hidden'
    pathEl.style.textOverflow = 'ellipsis'
    pathEl.style.whiteSpace = 'nowrap'
    btn.append(label, pathEl)
    btn.addEventListener('click', () => {
      void openRecent(rec.path)
    })
    container.appendChild(btn)
    // Async existence probe: mark the entry as missing when the file can no
    // longer be read. The entry stays CLICKABLE (a disabled button can't be
    // clicked, so the stale entry could never be removed — user-results D3/C9);
    // clicking routes to openRecent, which alerts and removes the entry.
    // Guard btn.isConnected because renderRecents can re-run mid-probe (the
    // button may have been replaced before the promise settles).
    io.readFile(rec.path)
      .then(() => {
        if (btn.isConnected) btn.classList.remove('missing')
      })
      .catch(() => {
        if (btn.isConnected) {
          btn.classList.add('missing')
          btn.title = 'File missing — click to remove it from recents'
        }
      })
  }
}

// Every data-action id that maps 1:1 to a FORMATTING_COMMANDS command.
const FORMATTING_ACTION_IDS = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'header-cycle',
  'header-0',
  'header-1',
  'header-2',
  'header-3',
  'header-4',
  'header-5',
  'header-6',
  'list',
  'list-unordered',
  'list-ordered',
  'list-task',
  'blockquote',
  'inline-code',
  'code-block',
  'link',
  'image',
  'table',
  'hr',
  'footnote',
  'task-list',
  'heading-id',
  'def-list',
  'sub',
  'sup',
  'highlight',
]

function runFormatting(id: string): void {
  const factory = FORMATTING_COMMANDS[id]
  const ed = getEditor()
  if (factory !== undefined && ed !== null) {
    ed.runFormatting(factory)
    // E13: after a toolbar/menu formatting action (table/hr/footnote/…), move
    // the caret back into the editor so the inserted template is immediately
    // editable without an extra click.
    ed.focus()
  }
}

function wireMenu(): void {
  const actions: Record<string, (ev: MouseEvent) => void> = {
    new: () => {
      void newDoc()
    },
    open: () => {
      void openDoc()
    },
    save: () => {
      void saveDoc()
    },
    'save-as': () => {
      void saveAsDoc()
    },
    'export-html': () => {
      void exportHtml()
    },
    settings: () => openSettingsModal(),
    'clear-recents': () => {
      void clearRecents()
    },
    undo: () => {
      editor?.undo()
    },
    redo: () => {
      editor?.redo()
    },
    copy: () => {
      const ed = getEditor()
      if (ed !== null) void copySelection(ed)
    },
    cut: () => {
      const ed = getEditor()
      if (ed !== null) void cutSelection(ed)
    },
    paste: () => {
      const ed = getEditor()
      if (ed !== null) void pasteText(ed)
    },
    emoji: (ev) => {
      // Anchor the picker to the clicked button, falling back to the clicked
      // element itself, then to document.body.
      const target = ev.target
      let anchor: HTMLElement = document.body
      if (target instanceof HTMLElement) {
        const btn = target.closest('button')
        anchor = btn instanceof HTMLElement ? btn : target
      }
      openEmojiPicker(anchor, (emoji) => {
        const ed = getEditor()
        if (ed !== null) ed.replaceSelection(emoji)
      })
    },
  }
  for (const id of FORMATTING_ACTION_IDS) {
    actions[id] = () => runFormatting(id)
  }
  document.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
    const action = el.dataset.action
    if (action !== undefined && Object.prototype.hasOwnProperty.call(actions, action)) {
      el.addEventListener('click', actions[action])
    }
  })
}

// App-level chords handled at the window level (menu/file/mode/settings/toggle).
// Formatting chords (bold, italic, headers, lists, …) live in the editor's CM6
// keymap via extraKeymaps, and undo/redo/copy/cut/paste are CM6 defaults — none
// of those belong in the window set (they would double-fire when the editor is
// focused).
const APP_HOTKEY_IDS = [
  'new',
  'open',
  'open-recent',
  'save',
  'save-as',
  'export-html',
  'settings',
  'toggle-mode',
]

function wireHotkeys(): void {
  const handlers: Record<string, () => void> = {
    new: () => {
      void newDoc()
    },
    open: () => {
      void openDoc()
    },
    'open-recent': () => {
      // The File menu renders first, so it is the FIRST `.dropdown` in the
      // document. Toggle it; when opening, also open the recents submenu so
      // its panel shows without hover. (CSS: `.dropdown.open > .dropdown-panel`
      // and `.submenu-toggle.open > .dropdown-panel`.)
      const fileDropdown = document.querySelector<HTMLElement>('.dropdown')
      if (fileDropdown === null) return
      const trigger = fileDropdown.querySelector<HTMLElement>('.dropdown-trigger')
      if (fileDropdown.classList.contains('open')) {
        fileDropdown.classList.remove('open')
        trigger?.setAttribute('aria-expanded', 'false')
        return
      }
      fileDropdown.classList.add('open')
      trigger?.setAttribute('aria-expanded', 'true')
      const submenu = document.querySelector<HTMLElement>('.submenu-toggle[data-action="open-recent"]')
      if (submenu !== null) {
        submenu.classList.add('open')
        submenu.setAttribute('aria-expanded', 'true')
      }
    },
    save: () => {
      void saveDoc()
    },
    'save-as': () => {
      void saveAsDoc()
    },
    'export-html': () => {
      void exportHtml()
    },
    settings: () => openSettingsModal(),
    'toggle-mode': () => setMode(appState.get().mode === 'live' ? 'source' : 'live'),
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return
    // Bail only on real form inputs (input/textarea). CM6's `.cm-content` is
    // contenteditable=true and must NOT bail — while the editor is focused is
    // exactly when Mod-S / Mod-N / Mod-O / Mod-, are most likely to be pressed.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }
    const platform = getPlatform()
    for (const id of APP_HOTKEY_IDS) {
      if (matches(id, e, platform)) {
        e.preventDefault()
        handlers[id]()
        return
      }
    }
  })
}

function wireCloseGuard(): void {
  // Use isTauri() at call-time — the cached `runtime` const in detect.ts may be
  // stale ("browser") if evaluated before Tauri internals were injected, which
  // caused this guard to never register (C8) and window-title updates to be
  // skipped (A3). Call-time check is safe because wireCloseGuard runs from
  // initApp() after Tauri is ready.
  if (isTauri()) {
    // Tauri v2: onCloseRequested receives a CloseRequestedEvent with
    // preventDefault() to veto the close. The event's async nature means
    // we must call preventDefault() synchronously before awaiting the
    // confirm dialog, then explicitly destroy() if the user confirms.
    // destroy() bypasses close-requested so there is no re-entrancy.
    // For a clean doc we still preventDefault then destroy so the window
    // actually closes even when the Rust side has auto-prevented.
    //
    // C8 NOTE: root cause was likely twofold: (1) `runtime` const cached at
    // module load before Tauri ready → `runtime === 'tauri'` was false so this
    // handler never registered; fixed by switching to isTauri() at call-time.
    // (2) missing window capabilities (setTitle/close/destroy/onCloseRequested)
    // in desktop.json caused invoke rejections that were swallowed. Capability
    // fix in desktop.json should allow this to work. However full close-guard
    // behavior (X/Alt+F4, preventDefault+async confirm+destroy vs close,
    // re-entrancy, race with Rust auto-prevent) is subtle and needs manual QA
    // on Windows/macOS. If QA still fails (e.g. destroy silently blocked or
    // event never fires), defer to a Tauri window-lifecycle specialist — do not
    // claim C8 fully fixed without QA. See A3/C8 investigation notes.
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault()
        const doc = appState.get().doc
        if (!doc.dirty) {
          await getCurrentWindow()
            .destroy()
            .catch((err) => console.warn('[close-guard] destroy failed — check desktop.json window permissions', err))
          return
        }
        const ok = await io.confirm(`Discard unsaved changes to ${doc.name}?`)
        if (ok) {
          await getCurrentWindow()
            .destroy()
            .catch((err) => console.warn('[close-guard] destroy failed — check desktop.json window permissions', err))
        }
      })
      .catch((err) => console.warn('[close-guard] onCloseRequested registration failed — check desktop.json window permissions', err))
  }
  // Browser dev mode: beforeunload keeps the tab from closing silently.
  window.addEventListener('beforeunload', (e) => {
    if (appState.get().doc.dirty) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}

function wireStatusMode(): void {
  const modeEl = document.getElementById('status-mode')
  modeEl?.addEventListener('click', () => setMode(appState.get().mode === 'live' ? 'source' : 'live'))
}

/**
 * Refocus the editor when the window regains focus — but never while the
 * settings modal is open (settingsUI toggles the hidden attribute on
 * #settings-modal-root) and only once the editor exists.
 */
function wireWindowFocus(): void {
  window.addEventListener('focus', () => {
    if (editor === null) return
    const modalRoot = document.getElementById('settings-modal-root')
    if (modalRoot !== null && !modalRoot.hidden) return
    editor.focus()
  })
}

/**
 * Emoji-picker hotkey layer (user-results E21): a single CM6 keybinding built
 * from the 'emoji' shortcut's chord looked up at RUNTIME from the shortcuts
 * map (never hardcoded), so a future chord change needs no code change here.
 * Opens the picker anchored to the editor and inserts the picked emoji into
 * the document.
 */
function emojiHotkeyMap(): KeyBinding[] {
  const chord = SHORTCUTS.find((s) => s.id === 'emoji')?.keys[0]
  if (chord === undefined) return []
  return [
    {
      key: chord,
      run: (view) => {
        openEmojiPicker(view.dom, (emoji) => {
          view.dispatch(view.state.replaceSelection(emoji))
          view.focus()
        })
        return true
      },
    },
  ]
}

export async function initApp(): Promise<void> {
  // The editor module pulls in the ~518 KB cm-editor chunk (CM6 +
  // codemirror-live-markdown + its inlined hljs languages); kicking off the
  // import immediately lets the chunk fetch in parallel with loadSettings,
  // while the app shell (menubar/status bar) stays independent.
  const editorModule = import('../editor/editor')
  io = getFileIO()

  const settings = await loadSettings(io)
  // Defensive mode normalization: settings.defaultMode is 'live' | 'source'
  // (a possibly-stored 'preview' from an older build is coerced by
  // settings.mergeSettings), but treat anything else as 'live' regardless.
  appState.set({ settings, mode: settings.defaultMode === 'source' ? 'source' : 'live' })
  applyTheme(settings.theme)

  const { createEditor } = await editorModule
  editor = createEditor(byId('editor'), {
    content: appState.get().doc.content,
    mode: settings.defaultMode === 'source' ? 'source' : 'live',
    wrap: settings.lineWrapping,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    extraKeymaps: [formattingHotkeyMap(), markdownListKeymap(), emojiHotkeyMap()],
    onPasteImage: (event) => {
      const ed = editor
      const doc = appState.get().doc
      if (ed !== null) void pasteImage(ed, io, { name: doc.name, path: doc.path }, event)
    },
    // Live-preview images: resolve a relative markdown src against the doc's
    // directory into a URL the webview can render (data: URL via exposeImage),
    // or null when unresolvable (unsaved doc, absolute/http/data/blob/asset
    // srcs, browser dev mode). Results are cached per doc-path + absolute path.
    imageResolver: async (src: string) => {
      const doc = appState.get().doc
      if (doc.path === null) return null
      if (/^(https?:|data:|blob:|asset:|\/|#)/i.test(src)) return null
      const abs = resolveAgainstDocDir(doc.path, src)
      const key = `${doc.path}::${abs}`
      const hit = imageCache.get(key)
      if (hit !== undefined) return hit
      try {
        const url = await io.exposeImage(abs)
        imageCache.set(key, url)
        return url
      } catch {
        return null
      }
    },
  })
  editor.onChange((content) => setContent(content))
  applyEditorSettings(settings)
  wireSettingsModal({ getSettings: () => appState.get().settings, onApply: (patch) => updateSettings(patch) })

  // Render the menubar once before wiring; recents + data-action clicks live inside it.
  const menubarRoot = byId('menubar-root')
  renderMenubar(menubarRoot, { extraPinned: settings.extraMenuAlwaysVisible })
  lastExtraPinned = settings.extraMenuAlwaysVisible

  // Subscribe early so ANY doc.content change (recovery, open, new, open-recent)
  // flows into the editor. The controller's setContent never fires onChange, so
  // this cannot create a feedback loop and cannot flip the dirty flag.
  appState.subscribe((s) => {
    if (s.settings.extraMenuAlwaysVisible !== lastExtraPinned) {
      lastExtraPinned = s.settings.extraMenuAlwaysVisible
      renderMenubar(byId('menubar-root'), { extraPinned: s.settings.extraMenuAlwaysVisible })
      // Rebuilding the menubar replaces its data-action buttons, so re-attach listeners.
      wireMenu()
    }
    const recentsJson = JSON.stringify(s.recents)
    if (recentsJson !== lastRecentsJson) {
      lastRecentsJson = recentsJson
      renderRecents()
    }
    // Dirty→clean transition (save, undo back to the saved content): drop the
    // autosaved draft. Idempotent — clearDraft on a missing draft is a no-op.
    if (lastDirty && !s.doc.dirty) {
      void clearDraft(io, s.doc.path).catch((err) => {
        console.warn('Draft clear failed', err)
      })
    }
    // C1: any full-document replace (new/open/open-recent/recover) flows
    // through this subscription, and setContent returns true exactly when it
    // actually replaced the document — reset the undo history there so Ctrl+Z
    // can never undo back into the previous document.
    const ed = editor
    if (ed !== null && ed.setContent(s.doc.content)) {
      ed.resetHistory()
    }
    if (s.doc.dirty && s.settings.autosaveDrafts) {
      scheduleDraftSave(s.doc)
    } else if (draftTimer !== null) {
      clearTimeout(draftTimer)
      draftTimer = null
    }
    lastDirty = s.doc.dirty
  })

  const recents = parseRecents(await io.readRecents())
  appState.set({ recents })

  await recover()

  wireStatusMode()
  wireMenu()
  wireHotkeys()
  wireWindowFocus()
  wireCloseGuard()
  renderRecents()
}
