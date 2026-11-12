/**
 * CodeMirror 6 editor controller (M2 â€” Editor core).
 *
 * Creates the CM6 `EditorView` mounted into the `#editor` pane, wires the markdown
 * language, the live-preview extensions (via `livePreview.ts`, the only swap/fork
 * point for codemirror-live-markdown), our theme (`cmTheme.ts`), undo history + keymap,
 * a placeholder, and change/selection callbacks.
 *
 * The controller is the app-facing seam: `app.ts` / `main.ts` drive it through the
 * `EditorController` interface only â€” no CM6 types leak to the host.
 */
import { Compartment, EditorState, Prec, StateEffect, Transaction, type Extension, type TransactionSpec } from '@codemirror/state'
import { EditorView, keymap, placeholder, type Command, type KeyBinding, ViewUpdate } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { syntaxTree } from '@codemirror/language'
import { livePreviewExtensions, wireMouseSelection } from './livePreview'
import { editorThemeExtension } from './cmTheme'
import { keysFor } from '../app/shortcuts'

export interface EditorCursor {
  /** 1-based */
  line: number
  /** 1-based */
  col: number
}

export interface EditorCreateOptions {
  content?: string
  mode?: 'live' | 'source'
  wrap?: boolean
  fontSize?: number
  lineHeight?: number
  /** Resolve a markdown image src (relative path) to a webview-renderable URL, or null when unresolvable (browser dev mode, unsaved doc, http/data/absolute/rooted paths). Consumed by the live-preview image widgets. */
  imageResolver?: (src: string) => Promise<string | null>
  /** Extra CM6 keymap groups (each a KeyBinding[] — e.g. formatting hotkeys + list-Enter keymap from M3); each group is wrapped with keymap.of by the editor. */
  extraKeymaps?: KeyBinding[][]
  /** Fires when the user pastes something whose clipboard contains an image file; return nothing. Used by paste-image (M3). */
  onPasteImage?: (event: ClipboardEvent) => void
  /** Fires when a rendered link is clicked in live-preview mode. Used to open the URL externally. */
  onLinkClick?: (url: string) => void
  /** Start in read-only mode: the content is visible/selectable but not editable. Toggle at runtime with `setReadOnly`. Default false. */
  readOnly?: boolean
  /** Placeholder shown while the document is empty. */
  placeholder?: string
  /** Accessible name applied to the editor's content textbox (aria-label). */
  ariaLabel?: string
}

/** Matches a pasted URL (http/https). */
const URL_RE = /^https?:\/\/\S+$/

/** True when the paste event's clipboard holds at least one image file. */
function hasImage(e: ClipboardEvent): boolean {
  const files = e.clipboardData?.files
  if (!files) return false
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith('image/')) return true
  }
  return false
}

export interface EditorController {
  /** Programmatic replace of the whole doc. MUST NOT fire the onChange callbacks. Returns true when the content actually changed (false = no-op). */
  setContent(text: string): boolean
  getContent(): string
  focus(): void
  destroy(): void
  /** Root DOM element of the editor (anchor for popovers such as the emoji picker). */
  getDom(): HTMLElement
  setMode(mode: 'live' | 'source'): void
  setWrapping(wrap: boolean): void
  /** Sets --cm-font-size on the editor DOM (px) */
  setFontSize(px: number): void
  /** Sets --cm-line-height on the editor DOM (view.dom + view.contentDOM) */
  setLineHeight(n: number): void
  /** Clear the undo/redo history (after any full-document replace: new/open/recover). */
  resetHistory(): void
  /** Move the main selection to the given 1-based line/col (clamped to the document). */
  setCursor(line: number, col: number): void
  /** 1-based line/col of the main selection head. */
  getCursor(): EditorCursor
  /** Enable/disable native spell checking on the editable surface. */
  setSpellCheck(enabled: boolean): void
  /** Toggle read-only mode without rebuilding the editor (no-op when unchanged). */
  setReadOnly(readOnly: boolean): void
  /** Register a callback for USER edits (fires with the full new content). */
  onChange(cb: (content: string) => void): void
  /** Register a callback for cursor moves (fires on selection/doc change). */
  onCursorChange(cb: (cursor: EditorCursor) => void): void
  /** Build a transaction from the current state via `fn` and dispatch it (single undo step, selection preserved). Used by formatting commands. */
  runFormatting(fn: (state: EditorState) => TransactionSpec): void
  /** Run a CM6 command (e.g. undo/redo/copy/cut from @codemirror/commands) against the view. Returns whether it applied. */
  runCommand(cmd: Command): boolean
  /** Undo the last history step (delegates to the `undo` command from @codemirror/commands). Returns whether it applied. */
  undo(): boolean
  /** Redo the last undone history step (delegates to the `redo` command from @codemirror/commands). Returns whether it applied. */
  redo(): boolean
  /** Replace the current selection with text (used by emoji picker / paste). */
  replaceSelection(text: string): void
}

export function createEditor(mount: HTMLElement, opts?: EditorCreateOptions): EditorController {
  // Clear any stale children (e.g. the M0 `.editor-placeholder` div) from the mount.
  mount.textContent = ''

  // Per-instance state: callbacks and the change-suppression flag are owned by this
  // controller, so the update listener and extension builder live in this closure.
  let suppressChange = false
  const onChangeCbs = new Set<(content: string) => void>()
  const onCursorCbs = new Set<(cursor: EditorCursor) => void>()

  // Read-only lives in a compartment so `setReadOnly` can swap just the
  // readOnly/editable facets in place instead of rebuilding the extension
  // list (which would reset view plugins and their decorations).
  const readOnlyCompartment = new Compartment()
  let readOnly = opts?.readOnly ?? false

  const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged && !suppressChange) {
      const text = update.state.doc.toString()
      for (const cb of onChangeCbs) cb(text)
    }
    if ((update.docChanged || update.selectionSet) && onCursorCbs.size > 0) {
      const head = update.state.selection.main.head
      const line = update.state.doc.lineAt(head)
      const cursor: EditorCursor = { line: line.number, col: head - line.from + 1 }
      for (const cb of onCursorCbs) cb(cursor)
    }
  })

  // Built as a function so setMode/setWrapping can reconfigure with a fresh extension
  // list. `EditorView.lineWrapping` is included only when wrapping is enabled.
  // `includeHistory=false` drops the undo-history field (used by resetHistory to
  // wipe the stacks: the field is a module-level singleton, so reconfiguring with
  // it present would carry the old history over).
  function openReplacePanel(view: EditorView): boolean {
    openSearchPanel(view)
    // The panel DOM is created on the next update; defer focusing the
    // replace field so it actually exists.
    setTimeout(() => {
      const panel = view.dom.querySelector('.cm-search') as HTMLElement | null
      if (panel === null) return
      const replaceInput = panel.querySelector('input[name="replace"]') as HTMLInputElement | null
      if (replaceInput !== null) {
        replaceInput.focus()
        replaceInput.select()
      }
    }, 0)
    return true
  }

  function buildExtensions(mode: 'live' | 'source', wrap: boolean, includeHistory = true): Extension[] {
    const extensions: Extension[] = [
      // GFM base (markdownLanguage): the default `markdown()` uses the CommonMark
      // parser, which lacks strikethrough (`~~x~~` rendered as plain text).
      markdown({ base: markdownLanguage }),
      ...livePreviewExtensions({ collapse: mode === 'live', imageResolver: opts?.imageResolver, onLinkClick: opts?.onLinkClick }),
      // Read-only is compartmentalized: rebuilds triggered by mode/wrap/history
      // changes reuse the compartment's current content, but the tracked value
      // is used here so a fresh state (or a first build) starts in the right mode.
      readOnlyCompartment.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      editorThemeExtension(),
      ...(opts?.ariaLabel !== undefined
        ? [EditorView.contentAttributes.of({ 'aria-label': opts.ariaLabel })]
        : []),
      // Find/replace (user-results Other #8 / B19): the canonical chords are
      // derived from SHORTCUTS (find = Mod-f, replace = Mod-Shift-f) so Help
      // dialog and menu hints stay in sync with the real keymap. Mod-h stays a
      // non-canonical replace alias for muscle memory; no app shortcut uses
      // Mod-h alone (header-cycle is Mod-Alt-h, hr is Mod-Shift-h).
      // `top: true` puts the panel in .cm-panels-top so the floating-card CSS
      // (editor.css) positions it at the top instead of the default bottom
      // bar — the built-in option is cleaner than a CSS-only override against
      // a bottom container (absolute inside .cm-panels-bottom is relative to
      // the bottom sticky box, so top:8 was still visually at the bottom).
      search({ top: true }),
      // Custom search keymap at highest precedence so it beats the formatting
      // hotkey layer. The chords come from SHORTCUTS via keysFor (find =
      // Mod-f, replace = Mod-Shift-f), so Help/menu hints always match the
      // editor bindings. Mod-h remains an extra replace alias. Without this
      // layer searchKeymap would bind only Mod-f and Mod-Shift-f would fall
      // through to the formatting hotkey map. Prec.highest guarantees this
      // wins even though formattingHotkeyMap is at Prec.high via extraKeymaps.
      Prec.highest(
        keymap.of([
          ...keysFor('find').map((key): KeyBinding => ({ key, run: openSearchPanel, preventDefault: true })),
          ...keysFor('replace').map((key): KeyBinding => ({ key, run: openReplacePanel, preventDefault: true })),
          // Non-canonical alias kept for muscle memory; Help/menu hints show
          // only the canonical Mod-Shift-F chord from SHORTCUTS.
          { key: 'Mod-h', run: openReplacePanel, preventDefault: true },
        ]),
      ),
      keymap.of([
        // App-level bindings run BEFORE the base keymaps (first match wins):
        // - Mod-/ is handled at the window level (mode toggle); swallow it here so
        //   defaultKeymap's toggleComment (inserts `<!-- -->`) never fires.
        // - Mod-Shift-z: historyKeymap only binds Mod-y on Windows/Linux; bind
        //   redo for all platforms (on mac this is the same binding, earlier).
        { key: 'Mod-/', run: () => true },
        { key: 'Mod-Shift-z', run: redo },
        ...defaultKeymap,
        ...searchKeymap,
        ...(includeHistory ? historyKeymap : []),
        indentWithTab,
      ]),
      placeholder(opts?.placeholder ?? 'Start typing your markdown here'),
      updateListener,
    ]
    // The history field is a module-level singleton in @codemirror/commands, so a
    // plain reconfigure would preserve it. Dropping it entirely is the only way to
    // start a fresh (empty) undo/redo stack — see resetHistory.
    if (includeHistory) extensions.push(history())
    // Extra keymap groups (formatting hotkeys + list-Enter continuation) are
    // each wrapped individually with keymap.of and raised to HIGHEST precedence
    // (`Prec.highest`), so they are checked BEFORE both the base keymap above
    // AND lang-markdown's built-in `insertNewlineContinueMarkup` handler (which
    // is at `Prec.high`). Without this, the lang-markdown handler intercepts
    // Enter for task-list variants like "- []" and replaces the marker with a
    // plain unordered "- " instead of preserving the exact task form.
    if (opts?.extraKeymaps !== undefined && opts.extraKeymaps.length > 0) {
      extensions.push(...opts.extraKeymaps.map((bindings) => Prec.highest(keymap.of(bindings))))
    }
    // Paste interception: detect images and URLs on paste. When an image is
    // pasted and the host provided an onPasteImage callback, hand the event off
    // and block the default text paste. When a URL is pasted, auto-wrap it as a
    // markdown link `[url](url)`. Lives in buildExtensions so reconfigures
    // (setMode/setWrapping) keep it.
    extensions.push(
      EditorView.domEventHandlers({
        paste: (event: ClipboardEvent) => {
          if (hasImage(event)) {
            opts?.onPasteImage?.(event)
            return true
          }
          const text = event.clipboardData?.getData('text/plain') ?? ''
          if (URL_RE.test(text.trim())) {
            const pos = view.state.selection.main.head
            const tree = syntaxTree(view.state)
            let inLinkUrl = false
            tree.iterate({
              enter: (node) => {
                if (node.name === 'Url' && pos >= node.from && pos <= node.to) {
                  const parent = node.node.parent
                  if (parent !== null && parent.name === 'Link') {
                    inLinkUrl = true
                    return false
                  }
                }
              },
            })
            if (!inLinkUrl) {
              event.preventDefault()
              const url = text.trim()
              const insert = `[${url}](${url})`
              view.dispatch(view.state.replaceSelection(insert))
              return true
            }
          }
          return false
        },
      }),
    )
    if (wrap) extensions.push(EditorView.lineWrapping)
    return extensions
  }

  let mode: 'live' | 'source' = opts?.mode ?? 'live'
  let wrap = opts?.wrap ?? true

  const view = new EditorView({
    parent: mount,
    state: EditorState.create({
      doc: opts?.content ?? '',
      extensions: buildExtensions(mode, wrap),
    }),
  })

  // Accessible name for the contenteditable textbox. Also declared as a content
  // attribute in buildExtensions so reconfigures re-apply it; setting it here
  // covers the freshly-created DOM immediately.
  if (opts?.ariaLabel !== undefined) view.contentDOM.setAttribute('aria-label', opts.ariaLabel)

  // Apply the CSS-var sizing immediately; defaults live in cmTheme.ts.
  const setFontSize = (px: number) => view.dom.style.setProperty('--cm-font-size', `${px}px`)
  // --cm-line-height is defined on BOTH view.dom and view.contentDOM: the
  // plugin's editorTheme sets `.cm-line { line-height: 1.75 }` explicitly, so
  // cmTheme resolves the var directly on `.cm-line` — the var is looked up from
  // the nearest ancestor that defines it, and both elements are ancestors of
  // every `.cm-line`.
  const setLineHeight = (n: number) => {
    view.dom.style.setProperty('--cm-line-height', `${n}`)
    view.contentDOM.style.setProperty('--cm-line-height', `${n}`)
  }
  setFontSize(opts?.fontSize ?? 15)
  setLineHeight(opts?.lineHeight ?? 1.6)

  const cleanupMouseSelection = wireMouseSelection(view)

  return {
    setContent(text: string): boolean {
      if (text === view.state.doc.toString()) return false
      suppressChange = true
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: Transaction.addToHistory.of(false),
      })
      suppressChange = false
      return true
    },
    getContent(): string {
      return view.state.doc.toString()
    },
    focus(): void {
      view.focus()
    },
    getDom(): HTMLElement {
      return view.dom
    },
    destroy(): void {
      cleanupMouseSelection()
      view.destroy()
    },
    resetHistory(): void {
      // history() wraps a module-level singleton StateField, so reconfiguring with
      // a rebuilt extension list would KEEP the field and its undo/redo stacks.
      // Two-step: drop the history extension (field removed → stacks gone), then
      // re-add it (fresh field starts empty). Both dispatches are synchronous, so
      // no intermediate state is ever observable.
      view.dispatch({ effects: StateEffect.reconfigure.of(buildExtensions(mode, wrap, false)) })
      view.dispatch({ effects: StateEffect.reconfigure.of(buildExtensions(mode, wrap, true)) })
    },
    setCursor(line: number, col: number): void {
      const doc = view.state.doc
      const lineNo = Math.max(1, Math.min(line, doc.lines))
      const lineInfo = doc.line(lineNo)
      const pos = Math.max(lineInfo.from, Math.min(lineInfo.to, lineInfo.from + Math.max(0, col - 1)))
      view.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true })
    },
    getCursor(): EditorCursor {
      const head = view.state.selection.main.head
      const lineInfo = view.state.doc.lineAt(head)
      return { line: lineInfo.number, col: head - lineInfo.from + 1 }
    },
    setSpellCheck(enabled: boolean): void {
      const value = String(enabled)
      view.dom.setAttribute('spellcheck', value)
      view.contentDOM.setAttribute('spellcheck', value)
    },
    setReadOnly(nextReadOnly: boolean): void {
      if (nextReadOnly === readOnly) return
      readOnly = nextReadOnly
      view.dispatch({
        effects: readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
      })
    },
    setMode(nextMode: 'live' | 'source'): void {
      if (nextMode === mode) return
      mode = nextMode
      view.dispatch({ effects: StateEffect.reconfigure.of(buildExtensions(mode, wrap)) })
      // B6: Lezer's incremental parse is viewport/budget-limited — immediately
      // after reconfigure the syntaxTree may only cover the visible page
      // (~42 lines). Schedule empty transactions after the parser has had time
      // to finish so livePreview plugins can rebuild with the complete tree.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          if (mode === nextMode) view.dispatch({})
        })
      }
      setTimeout(() => {
        if (mode === nextMode) view.dispatch({})
      }, 60)
    },
    setWrapping(nextWrap: boolean): void {
      if (nextWrap === wrap) return
      wrap = nextWrap
      view.dispatch({ effects: StateEffect.reconfigure.of(buildExtensions(mode, wrap)) })
    },
    setFontSize,
    setLineHeight,
    onChange(cb: (content: string) => void): void {
      onChangeCbs.add(cb)
    },
    onCursorChange(cb: (cursor: EditorCursor) => void): void {
      onCursorCbs.add(cb)
    },
    runFormatting(fn: (state: EditorState) => TransactionSpec): void {
      view.dispatch(fn(view.state))
    },
    runCommand(cmd: Command): boolean {
      return cmd(view)
    },
    undo(): boolean {
      return undo(view)
    },
    redo(): boolean {
      return redo(view)
    },
    replaceSelection(text: string): void {
      const sel = view.state.selection.main
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
      })
    },
  }
}
