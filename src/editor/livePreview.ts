/**
 * Live preview — the ONLY swap/fork point for `codemirror-live-markdown`.
 *
 * Per PLAN §2 / §21, the pinned alpha package (`codemirror-live-markdown@0.5.1-alpha.1`)
 * is a bus-factor risk (single maintainer, v0.5.x-alpha, roadmap stalled). Everything
 * the app needs from it flows through this thin interface so the base can be swapped
 * without touching `editor.ts`, `app.ts` or `main.ts`.
 *
 * FORK NOTE (why we don't use the package's `livePreviewPlugin` as-is):
 * the pinned tarball's inline reveal calls `shouldShowSource(state, mark.from, mark.to)`
 * — i.e. it reveals a mark only when the caret intersects the MARK'S OWN chars (the `**`).
 * PLAN §1/§6A requires TRUE Typora-style: syntax re-appears faded whenever the caret is
 * INSIDE the formatting REGION (e.g. anywhere within `**bold**`). We therefore reimplement
 * the decoration builder here and pass the WHOLE parent element range to the package's
 * exported `shouldShowSource` (which is exactly what the package's own README documents).
 *
 * Reveal scope (§22.1 locked decision: default 'line'):
 * - `'line'`  — block marks (heading/list/quote) reveal on the caret's line (`activeLines`),
 *   computed from the selection ranges. Matches the locked default; no fork needed.
 * - `'block'` — would reveal whole blocks instead of just the caret line. Documented TODO.
 *
 * BEYOND THE PACKAGE — two widget families that fix user-reported M2 issues:
 * - List markers: on inactive lines the collapsed styling hides the raw `- ` / `1. `
 *   (opacity 0), so list items showed no bullet at all. We replace the mark with a
 *   stable `ListMarkerWidget` (`•` / `1.` / `☐ ` / `☑ `) instead.
 * - Images: `![alt](src)` rendered as raw markdown text in live mode. We replace the
 *   whole `Image` node with a `MarkdownImageWidget` that renders the resolved image
 *   (host-provided `imageResolver`) or falls back to the raw markdown text.
 */
import { syntaxTree } from '@codemirror/language'
import type { Extension, Range } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import {
  collapseOnSelectionFacet,
  markdownStylePlugin,
  editorTheme,
  mouseSelectingField,
  setMouseSelecting,
  shouldShowSource,
  checkUpdateAction,
} from 'codemirror-live-markdown'

export const REVEAL_SCOPE: 'line' | 'block' = 'line'

export interface LivePreviewOptions {
  /** Master on/off: true hides marks (reveal on caret), false = source mode (all marks shown). Default true. */
  collapse?: boolean
  /** Resolve a markdown image src (relative path) to a webview-renderable URL, or null when unresolvable (browser dev mode, unsaved doc, http/data/absolute/rooted paths). Consumed by the image widget in collapsed mode. */
  imageResolver?: (src: string) => Promise<string | null>
}

// ---------------------------------------------------------------------------
// Forked live-preview decoration builder (see FORK NOTE above).
// ---------------------------------------------------------------------------

const BLOCK_MARK_TYPES = new Set(['HeaderMark', 'ListMark', 'QuoteMark'])
const INLINE_MARK_TYPES = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark'])
// Marks inside these parents are left unstyled: code blocks (raw text) and
// rendered images (the image widget replaces the whole construct, so its alt
// emphasis must NOT add decorations overlapping the replacement range).
const SKIP_PARENT_TYPES = new Set(['FencedCode', 'CodeBlock', 'Image'])

function isInsideSkippedParent(parent: SyntaxNode | null): boolean {
  while (parent) {
    if (SKIP_PARENT_TYPES.has(parent.name)) return true
    parent = parent.parent
  }
  return false
}

/** Options handed to the plugin instance (via `ViewPlugin.of(...)`). */
interface LivePreviewPluginOptions {
  imageResolver?: (src: string) => Promise<string | null>
}

/**
 * Stable marker for list items on inactive lines. Replaces the raw `- ` / `1. ` /
 * `- [ ] ` markdown chars so the bullet/number stays visible while collapsed.
 */
class ListMarkerWidget extends WidgetType {
  constructor(
    readonly marker: string,
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }

  eq(o: ListMarkerWidget): boolean {
    return o.from === this.from && o.to === this.to && o.marker === this.marker
  }

  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-list-marker'
    s.textContent = this.marker
    return s
  }
}

/**
 * Rendered image for inactive lines. Replaces `![alt](src)` with an `<img>`
 * resolved through the host-provided `imageResolver`; renders the raw markdown
 * text when there is no resolver or the src is empty/unresolvable. The widget
 * is self-contained — it never touches the EditorView.
 */
class MarkdownImageWidget extends WidgetType {
  private dom: HTMLElement | null = null

  constructor(
    readonly from: number,
    readonly to: number,
    readonly text: string,
    readonly resolver?: (src: string) => Promise<string | null>,
  ) {
    super()
  }

  eq(o: MarkdownImageWidget): boolean {
    return o.from === this.from && o.to === this.to && o.text === this.text && o.resolver === this.resolver
  }

  toDOM(): HTMLElement {
    const m = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(this.text)
    const alt = m ? m[1] : ''
    const src = m ? m[2].trim() : ''
    const span = document.createElement('span')
    span.className = 'cm-image-widget'
    if (src === '' || this.resolver === undefined) {
      span.classList.add('cm-image-unresolved')
      span.textContent = this.text
      return span
    }
    const img = document.createElement('img')
    img.className = 'cm-image-widget-img'
    img.alt = alt
    span.appendChild(img)
    span.classList.add('cm-image-loading')
    this.dom = span
    // Resolve asynchronously; drop silently if the widget was rebuilt/removed
    // before the promise settled (its DOM is no longer connected).
    void Promise.resolve(this.resolver(src))
      .catch(() => null)
      .then((resolved) => {
        if (!this.dom || !this.dom.isConnected) return
        if (resolved !== null) {
          img.src = resolved
          span.classList.remove('cm-image-loading')
        } else {
          img.remove()
          span.classList.replace('cm-image-loading', 'cm-image-unresolved')
          span.textContent = this.text
        }
      })
    return span
  }
}

function buildDecorations(view: EditorView, opts: LivePreviewPluginOptions): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const { state } = view

  // Reveal scope 'line': the set of line numbers spanned by the selection.
  const activeLines = new Set<number>()
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number
    const endLine = state.doc.lineAt(range.to).number
    for (let l = startLine; l <= endLine; l++) activeLines.add(l)
  }
  const isDrag = state.field(mouseSelectingField, false)

  syntaxTree(state).iterate({
    enter: (node) => {
      // Images: on inactive lines replace the whole `![alt](src)` construct
      // with a rendered widget; while editing the line the raw markdown stays
      // visible (no decoration). The Image node spans the entire construct, so
      // no other decoration covers its range (inner alt marks are skipped via
      // SKIP_PARENT_TYPES).
      if (node.name === 'Image') {
        const lineNum = state.doc.lineAt(node.from).number
        const isActiveLine = activeLines.has(lineNum)
        if (!isActiveLine || isDrag) {
          const text = state.doc.sliceString(node.from, node.to)
          decorations.push(
            Decoration.replace({
              widget: new MarkdownImageWidget(node.from, node.to, text, opts.imageResolver),
            }).range(node.from, node.to),
          )
        }
        return
      }

      if (!BLOCK_MARK_TYPES.has(node.name) && !INLINE_MARK_TYPES.has(node.name)) return
      if (isInsideSkippedParent(node.node.parent)) return

      if (BLOCK_MARK_TYPES.has(node.name)) {
        const lineNum = state.doc.lineAt(node.from).number
        const isActiveLine = activeLines.has(lineNum)
        if (node.name === 'ListMark' && !(isActiveLine && !isDrag)) {
          // Inactive list line: show a stable bullet/number/task marker widget
          // instead of the raw markdown chars (which the collapsed styling
          // would otherwise hide entirely — the missing-bullet bug).
          const markText = state.doc.sliceString(node.from, node.to)
          // GFM task item: ListMark covers only the bullet char ('- ' → [0,1]),
          // and the '[ ] '/'[x] ' parses as a Task(TaskMarker) sibling INSIDE the
          // ListItem (verified against markdownLanguage). Replace the whole
          // '- [ ] ' head (6 chars from node.from) so the checkbox renders
          // correctly while collapsed.
          const head = state.doc.sliceString(node.from, node.from + 6)
          const taskMatch = /^[-+*] \[([ xX])\] $/.exec(head)
          if (taskMatch !== null) {
            const marker = taskMatch[1] === ' ' ? '☐ ' : '☑ '
            const to = node.from + 6
            decorations.push(Decoration.replace({ widget: new ListMarkerWidget(marker, node.from, to) }).range(node.from, to))
          } else if (/^\d+/.test(markText)) {
            // Ordered item: keep the number + period (e.g. '1.').
            const digits = /^\d+/.exec(markText)![0]
            decorations.push(Decoration.replace({ widget: new ListMarkerWidget(`${digits}.`, node.from, node.to) }).range(node.from, node.to))
          } else {
            decorations.push(Decoration.replace({ widget: new ListMarkerWidget('•', node.from, node.to) }).range(node.from, node.to))
          }
          return
        }
        const cls = isActiveLine && !isDrag ? 'cm-formatting-block cm-formatting-block-visible' : 'cm-formatting-block'
        decorations.push(Decoration.mark({ class: cls }).range(node.from, node.to))
        return
      }

      if (node.from >= node.to) return
      // FORK: reveal when the caret intersects the WHOLE formatting element (parent),
      // not just the mark chars — the package's README-documented behavior.
      const parent = node.node.parent
      const elementFrom = parent ? parent.from : node.from
      const elementTo = parent ? parent.to : node.to
      const isTouched = shouldShowSource(state, elementFrom, elementTo)
      const cls = isTouched && !isDrag ? 'cm-formatting-inline cm-formatting-inline-visible' : 'cm-formatting-inline'
      decorations.push(Decoration.mark({ class: cls }).range(node.from, node.to))
    },
  })

  return Decoration.set(decorations.sort((a, b) => a.from - b.from), true)
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    private readonly opts: LivePreviewPluginOptions

    constructor(view: EditorView, opts: LivePreviewPluginOptions) {
      this.opts = opts
      this.decorations = buildDecorations(view, opts)
    }

    update(update: ViewUpdate): void {
      if (checkUpdateAction(update) === 'rebuild') {
        this.decorations = buildDecorations(update.view, this.opts)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// ---------------------------------------------------------------------------

/**
 * Assemble the live-preview extensions from the pinned package + our fork.
 * `collapse: false` yields source mode (all marks visible); `true` hides marks and
 * reveals them only while the caret is inside the region (faded-grey via cmTheme).
 *
 * IMPORTANT: the live-preview decoration plugin is only included when `collapse: true`.
 * With `collapse: false` our inline reveal uses `shouldShowSource`, which returns false
 * and would therefore apply the HIDDEN `.cm-formatting-inline` class (opacity 0) — the
 * opposite of source mode. Excluding the plugin leaves all syntax visible while
 * `markdownStylePlugin` + `editorTheme` still provide readable styling.
 * (Verified in tests/editor.smoke.test.ts.)
 */
export function livePreviewExtensions(opts?: LivePreviewOptions): Extension[] {
  const collapse = opts?.collapse ?? true
  const extensions: Extension[] = [collapseOnSelectionFacet.of(collapse), mouseSelectingField]
  if (collapse) {
    extensions.push(livePreviewPlugin.of({ imageResolver: opts?.imageResolver }))
  }
  extensions.push(markdownStylePlugin, editorTheme)
  return extensions
}

/**
 * Track mouse drag selection so marks don't flicker during drags. Bound per README
 * quick-start: mousedown on the editor content, mouseup anywhere on the document.
 * Returns a cleanup function that removes both listeners.
 */
export function wireMouseSelection(view: EditorView): () => void {
  const onDown = () => {
    view.dispatch({ effects: setMouseSelecting.of(true) })
  }
  const onUp = () => {
    view.dispatch({ effects: setMouseSelecting.of(false) })
  }
  view.contentDOM.addEventListener('mousedown', onDown)
  document.addEventListener('mouseup', onUp)
  return () => {
    view.contentDOM.removeEventListener('mousedown', onDown)
    document.removeEventListener('mouseup', onUp)
  }
}