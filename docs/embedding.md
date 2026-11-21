# Embedding Notedown

`@codecody93/notedown-editor` packages Notedown's CodeMirror 6 editor and
live-preview Markdown renderer as a framework-agnostic ES module. The package
bundles its dependencies, ships scoped CSS and TypeScript declarations, and
never imports Tauri or the desktop app shell. An optional Node-only subpath,
`@codecody93/notedown-editor/render`, exposes the same Markdown pipeline for
server-side rendering.

This package is not the full application: the root entry is the editor, and
the optional `/render` subpath converts Markdown to HTML on the server. If you
want the desktop app, download the latest release; if you want the hosted web
app, open the Pages site. Both are linked from the [README](../README.md) and
[`docs/install.md`](install.md).

- Package: `@codecody93/notedown-editor`
- Server renderer: `@codecody93/notedown-editor/render` (Node 20+, optional `jsdom` peer)
- Registry: GitHub Packages (`https://npm.pkg.github.com`)
- CDN: <https://codecody93.github.io/Notedown/embed/> (browser editor only)
- License: MIT

## Installation from GitHub Packages

GitHub Packages requires authentication even though the package is public. Create
an `.npmrc` in the consuming project (or in your user config):

```ini
@codecody93:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`GITHUB_TOKEN` must be available in the environment and needs at least
`read:packages` for the account that can read the package. Then install:

```sh
npm install @codecody93/notedown-editor
```

Alternatively, authenticate with npm:

```sh
npm login --registry=https://npm.pkg.github.com --scope=@codecody93
```

Never commit `.npmrc` files containing a real token. With pnpm or Yarn, use the
same registry and auth-token keys in the corresponding configuration file.

### Peer dependencies

The published package lists `@codemirror/state` and `@codemirror/view` as peer
dependencies. The runtime bundle includes CodeMirror, but the emitted
declarations expose `EditorController`/`KeyBinding` types that reference those
packages. npm 7+ installs peers automatically; with pnpm or Yarn, add them to
the host project (or enable auto-install peers):

```sh
npm install @codemirror/state @codemirror/view
```

The `@codecody93/notedown-editor/render` subpath additionally declares `jsdom`
as an optional peer dependency; editor-only installs do not need it. See
[Server-side rendering (Node)](#server-side-rendering-node).

## CDN usage

The web build publishes the same files under the GitHub Pages site, so hosts
that cannot use GitHub Packages authentication can load them directly:

```html
<link
  rel="stylesheet"
  href="https://codecody93.github.io/Notedown/embed/notedown-editor.css"
/>
<div id="editor" style="height: 480px"></div>
<script type="module">
  import { createNotedownEditor } from "https://codecody93.github.io/Notedown/embed/notedown-editor.js";

  const editor = createNotedownEditor({
    mount: document.getElementById("editor"),
    value: "# Hello\n\nStart writing.",
  });
</script>
```

Pin a release by downloading the bundle into your own assets rather than
depending on `main` continuing to serve a compatible copy. The Pages copy is
redeployed on every push to `main` and on release tags. It contains the browser
editor bundle only; the Node renderer subpath is published on npm and is not
part of the CDN copy.

## Minimal usage

```ts
import { createNotedownEditor } from '@codecody93/notedown-editor'
import '@codecody93/notedown-editor/style.css'

const editor = createNotedownEditor({
  mount: document.querySelector<HTMLElement>('#editor')!,
  value: '# Notes\n\nHello **world**.',
  toolbar: true,
  onChange: (value) => {
    console.log('changed', value.length)
  },
  onSave: (value) => {
    // Persist however the host app wants; called on Ctrl/Cmd+S.
    void fetch('/api/notes/1', { method: 'PUT', body: value })
  },
})

// Later, when the host unmounts:
editor.destroy()
```

The mount element must be in the DOM and must have a height (see
[Height](#height)). Create the editor only in the browser; see
[SSR](#ssr-and-framework-notes).

## Options

`createNotedownEditor(options)` accepts:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mount` | `HTMLElement \| string` | — (required) | Container element or a CSS selector. Its contents are replaced by the editor root. |
| `value` | `string` | `''` | Initial Markdown content. |
| `mode` | `'live' \| 'source'` | `'live'` | Live preview or raw Markdown source. |
| `theme` | `'light' \| 'dark' \| 'system' \| 'inherit'` | `'system'` | Theme applied to the editor root. `system` follows `prefers-color-scheme`; `inherit` removes the attribute so the host supplies the variables. |
| `readOnly` | `boolean` | `false` | Visible and selectable, but not editable. |
| `placeholder` | `string` | — | Placeholder shown while the document is empty. |
| `ariaLabel` | `string` | — | Accessible name for the editor's content textbox. |
| `height` | `number \| string` | — | Height applied to the editor root. Numbers are pixels; strings are CSS lengths. Prefer sizing the mount element. |
| `fontSize` | `number` | — | Editor font size in pixels. |
| `lineHeight` | `number` | — | Editor line height multiplier. |
| `lineWrapping` | `boolean` | `true` | Wrap long lines instead of horizontal scrolling. |
| `spellCheck` | `boolean` | `true` | Enable/disable the native spell checker. |
| `toolbar` | `boolean \| ToolbarOptions` | `false` | Show the formatting toolbar. `true` (or `{}`) uses the compact default groups; `{ preset: 'full' }` shows the expanded preset; `{ items }` supplies custom groups. See [Toolbar presets](#toolbar-presets). |
| `onChange` | `(value: string) => void` | — | Fires on user edits with the full document (not on `setValue`). |
| `onCursorChange` | `(cursor: { line: number; col: number }) => void` | — | Fires when the selection moves. Line and column are 1-based. |
| `onSave` | `(value: string) => void \| Promise<void>` | — | Binds Ctrl+S / Cmd+S, prevents the browser save dialog, and calls the host to persist. |
| `onLinkClick` | `(url: string) => void` | opens safe URLs | Called when a rendered link is clicked in live preview. The default opens `http(s):`/`mailto:` in a new tab and ignores unsafe schemes. |
| `imageResolver` | `(src: string) => string \| null \| Promise<string \| null>` | allows `http(s)`, `data:image`, `blob:` | Resolve a Markdown image source to a displayable URL, or `null` to show the raw Markdown. |
| `onPasteImage` | `((file: File) => Promise<string \| null> \| string \| null) \| 'inline' \| 'none'` | `'inline'` | Paste-image policy. A function receives the pasted image `File` and returns the Markdown URL to insert (or `null` to ignore); `'inline'` embeds a `data:` URL under the size cap; `'none'` ignores pasted images. |
| `maxInlineImageBytes` | `number` | `2 * 1024 * 1024` | Maximum size for the default inline paste-image behavior. In the embed package, larger files are ignored with a `console.warn`; the web app itself shows a user-facing alert. |
| `extraKeymaps` | `KeyBinding[][]` | `[]` | Additional CodeMirror key-binding groups. They run before the built-in formatting/list keymaps but after the `onSave` `Mod-s` binding. |
| `className` | `string` | — | Extra class name(s) added to the `.notedown-editor-root` wrapper. |

### Toolbar presets

`toolbar: true` and `toolbar: {}` render the compact six-group toolbar used by
earlier releases: `[undo, redo]`, `[bold, italic, strikethrough]`, `[h1, h2]`,
`[bullet-list, ordered-list]`, `[link, inline-code]`, `[mode]`. Pass a preset or
custom groups to change it:

```ts
// Compact default — unchanged from earlier releases.
const compact = createNotedownEditor({
  mount: document.querySelector<HTMLElement>('#compact')!,
  toolbar: true,
})

// Expanded preset: inline styles, Header/List/Extra dropdowns (with a nested
// Graph menu), and the mode toggle.
const full = createNotedownEditor({
  mount: document.querySelector<HTMLElement>('#full')!,
  toolbar: { preset: 'full' },
})
```

| `toolbar` value | Result |
| --- | --- |
| `false` (default) | No toolbar. |
| `true` or `{}` | Compact `'default'` preset, identical to earlier releases. |
| `{ preset: 'default' }` | The same compact preset, stated explicitly. |
| `{ preset: 'full' }` | Expanded preset described below. |
| `{ items: [...] }` | Custom groups; overrides `preset`. |

The full preset contains:

- **History:** undo and redo.
- **Inline styles:** bold, italic, underline, and strikethrough.
- **Header ▾:** Paragraph and Heading 1–6.
- **List ▾:** bulleted, numbered (decimal, alpha, roman), and task lists.
- **Extra ▾:** blockquote, inline code, code block, link, image, table,
  horizontal rule, footnote, task list, emoji picker, heading ID, definition
  list, subscript, superscript, highlight, spoiler, and the Markdown collapsible
  block.
- **Graph ▾** (nested in Extra): pie, bar, and line chart starters.
- **Mode:** live/source toggle.

The full preset deliberately omits the navigator outline and the clipboard
actions (copy/cut/paste): the outline belongs to the app shell, and clipboard
commands are the host page's concern. `FULL_TOOLBAR_GROUPS` is exported if the
host wants to copy the preset and adjust one group instead of rebuilding it.

### Custom toolbar groups

Pass `items` to build your own groups. A `ToolbarGroup` is an array of
`ToolbarEntry` values, where an entry is either a `ToolbarItem` id or a
`ToolbarDropdown` descriptor (`{ type: 'dropdown', label, items }`). Each inner
array renders as one visually separated group.

```ts
import {
  createNotedownEditor,
  type ToolbarGroup,
} from '@codecody93/notedown-editor'

const groups: ToolbarGroup[] = [
  ['undo', 'redo'],
  ['bold', 'italic', 'underline'],
  [
    {
      type: 'dropdown',
      id: 'heading',
      label: 'Heading',
      glyph: 'H',
      items: [
        'header-0',
        'header-1',
        'header-2',
        'header-3',
        'header-4',
        'header-5',
        'header-6',
      ],
    },
  ],
  [
    {
      type: 'dropdown',
      id: 'insert',
      label: 'Insert',
      glyph: '+',
      items: [
        'link',
        'image',
        'table',
        'hr',
        'footnote',
        {
          type: 'dropdown',
          id: 'graph',
          label: 'Graph',
          glyph: 'G',
          items: ['pie-graph', 'bar-graph', 'line-graph'],
        },
      ],
    },
  ],
  ['mode'],
]

const editor = createNotedownEditor({
  mount: '#editor',
  value: '# Notes',
  toolbar: { items: groups },
})
```

`ToolbarDropdown` fields:

| Field | Type | Description |
| --- | --- | --- |
| `type` | `'dropdown'` | Required discriminator. |
| `label` | `string` | Accessible name and button text. |
| `items` | `ToolbarEntry[]` | Menu contents; dropdowns may nest. |
| `id` | `string` | Optional stable id copied to `data-*` attributes for host styling and tests. |
| `icon` | `ToolbarIconName` | Optional built-in icon name (used instead of `glyph`). |
| `glyph` | `string` | Optional short text fallback. |
| `shortcut` | `string` | Optional shortcut id used only for the tooltip hint; it does not bind a key. |

An item's label, icon, and command come from the built-in item table, so
dropdown children are plain item ids; only the dropdown itself carries a
host-supplied label.

### Toolbar items

Ids accepted by `ToolbarItem` and `items` groups:

| Category | Ids |
| --- | --- |
| History | `undo`, `redo` |
| Inline | `bold`, `italic`, `underline`, `strikethrough`, `inline-code`, `highlight`, `sub`, `sup`, `spoiler` |
| Headings | `header-0` (paragraph) through `header-6`; aliases `h1`, `h2` |
| Lists | `list-unordered` (alias `bullet-list`), `list-ordered` (alias `ordered-list`), `list-ordered-alpha`, `list-ordered-roman`, `list-task`, `task-list` |
| Blocks | `blockquote`, `code-block`, `hr`, `link`, `image`, `table`, `footnote`, `heading-id`, `def-list`, `dropdown` (Markdown collapsible block) |
| Insert | `emoji`, `pie-graph`, `bar-graph`, `line-graph` |
| Mode | `mode` |

### Toolbar behavior and limits

- **Two different "dropdowns".** The `dropdown` toolbar item inserts a Markdown
  collapsible block (`>>> Title`). A `{ type: 'dropdown', … }` entry is a
  toolbar menu that opens a panel of more items. The word is the same; the
  behavior is not.
- **Table inserts a template.** `table` runs `FORMATTING_COMMANDS.table`, which
  inserts a 3×3 GFM table at the cursor. The embed has no interactive table
  builder dialog; build one in the host if you need a grid picker.
- **Graph items insert starter syntax.** `pie-graph`, `bar-graph`, and
  `line-graph` insert starter chart blocks. The embed has no graph builder
  dialog.
- **Emoji picker.** The full preset includes a searchable emoji picker; it
  inserts the chosen emoji at the cursor.
- **Shortcut hints are informational.** Tooltips use the app's canonical chords
  from `SHORTCUTS`, but the embed only binds the formatting commands it already
  binds. App-shell chords (table builder, graph builder, emoji, mode) may not be
  bound; a `shortcut` field on a dropdown only changes the hint.
- **Build your own dialogs.** `getController()` exposes `runFormatting`,
  `replaceSelection`, the selection, and undo/redo, so a host can pair its own
  form with `FORMATTING_COMMANDS` ids — for example a table builder that
  generates Markdown and inserts it with `replaceSelection`.

### Custom chrome

`createToolbar` is exported for hosts that wire the toolbar into their own
layout instead of passing `toolbar` to `createNotedownEditor`:

```ts
import {
  createNotedownEditor,
  createToolbar,
  FORMATTING_COMMANDS,
} from '@codecody93/notedown-editor'

const editor = createNotedownEditor({ mount: '#editor', toolbar: false })

// One-off button using the same command table as the built-in toolbar:
const quote = document.createElement('button')
quote.type = 'button'
quote.textContent = 'Blockquote'
quote.addEventListener('click', () => {
  editor.getController().runFormatting(FORMATTING_COMMANDS['blockquote'])
  editor.getController().focus()
})
document.querySelector('#host-chrome')!.append(quote)

// Or a second toolbar with custom groups:
const toolbar = createToolbar({
  controller: editor.getController(),
  mode: 'live',
  items: [['bold', 'italic'], ['link']],
  onModeChange: (mode) => editor.setMode(mode),
})
editor.element.prepend(toolbar.element)

// On unmount: the editor does not own a host-created toolbar.
toolbar.destroy()
editor.destroy()
```

`createToolbar` returns `{ element, syncMode, destroy }`; call `syncMode(mode)`
after changing the editor mode outside the toolbar. Mount `element` inside the
`.notedown-editor-root` (as above) so the packaged, root-scoped toolbar and
popover styles apply; outside the root, supply equivalent CSS. The built-in
buttons prevent the default `mousedown` action so pressing them does not drop
the editor selection, and they refocus the editor after running a command.

## Methods

| Member | Description |
| --- | --- |
| `element` | Read-only `.notedown-editor-root` wrapper (for host layout/measurement). |
| `getValue()` | Current Markdown content. |
| `setValue(value)` | Replace the document. Does not fire `onChange`. |
| `focus()` | Move focus into the editor textbox. |
| `setMode(mode)` | Switch between `'live'` and `'source'` at runtime. |
| `setTheme(theme)` | Switch between `'light'`, `'dark'`, `'system'`, and `'inherit'`. |
| `setReadOnly(readOnly)` | Toggle read-only mode without rebuilding the editor. |
| `setFontSize(px)` | Change the editor font size in pixels. |
| `setLineWrapping(wrap)` | Enable or disable soft wrapping. |
| `getOutline()` | Parse the current document into a nested `OutlineHeading[]`. |
| `getController()` | Escape hatch to the underlying `EditorController` (cursor, undo/redo, formatting, selection). |
| `destroy()` | Remove the editor, toolbar, listeners, and theme subscription. Idempotent. Call once on unmount. |

The returned object is safe to keep for the lifetime of the host view. Do not
call methods after `destroy()` (except another idempotent `destroy()`).

The entry also exports pure helpers and toolbar builders for hosts that build
their own chrome: `FORMATTING_COMMANDS`, `SHORTCUTS`, `parseOutline`,
`DEFAULT_TOOLBAR_GROUPS`, `FULL_TOOLBAR_GROUPS`, `createToolbar`, and the
related TypeScript types (`CreateNotedownEditorOptions`, `NotedownEditor`,
`NotedownMode`, `NotedownImageResolver`, `NotedownPasteImageHandler`,
`EmbedTheme`, `ToolbarItem`, `ToolbarOptions`, `ToolbarPreset`,
`ToolbarDropdown`, `ToolbarEntry`, `ToolbarGroup`, `ToolbarHandle`,
`CreateToolbarOptions`, `EditorController`, `EditorCursor`,
`OutlineHeading`).

The Node-only `@codecody93/notedown-editor/render` subpath is a separate package
surface for Markdown-to-HTML rendering (see below). Importing it does not pull
in the editor entry or its CSS.

## CSS and theming

The JavaScript entry imports its scoped stylesheet, so bundlers that process
CSS imports pick it up automatically. An explicit import also works and makes
the dependency obvious:

```ts
import '@codecody93/notedown-editor/style.css'
```

or, when using a bundler with a global CSS entry:

```css
@import '@codecody93/notedown-editor/style.css';
```

With the CDN bundle, use the `<link>` shown in [CDN usage](#cdn-usage). Shell
and toolbar rules are scoped under `.notedown-editor-root`; the shared editor
rules target CodeMirror's `.cm-*` classes. Load the stylesheet once, and avoid
mixing it with another differently themed CodeMirror instance on the same page.
Toolbar menu panels are fixed-position elements rendered inside the toolbar
itself (not portalled to `document.body`), so they inherit the root's theme
variables and keep the editor selection; they close on Escape, outside click,
scroll, and resize.
The package also exposes the CSS as `@codecody93/notedown-editor/style.css` in
its `exports` map.

The theme exposes CSS custom properties on `.notedown-editor-root`:

| Variable | Purpose |
| --- | --- |
| `--bg` | Editor background |
| `--surface` | Toolbar background |
| `--surface-2` | Hover/pressed toolbar background |
| `--text` | Primary text |
| `--muted` | Secondary text |
| `--accent` | Links, focus rings, active toolbar state |
| `--border` | Borders and separators |
| `--code-bg` | Inline and block code background |
| `--selection` | Selection background |
| `--mono` | Monospace font stack |

Set `theme: 'inherit'` and override the variables on `.notedown-editor-root`
itself (for example `.host .notedown-editor-root { --bg: … }`) to match a host
design system; the packaged defaults are declared directly on that element, so
a parent-only override is not enough. Keep `--accent` and `--selection` readable
in both light and dark hosts.

### Height

The editor root uses `height: 100%` inside its mount, with a 220 px minimum.
Give the mount element an explicit height; the package cannot infer it from
content:

```css
#editor {
  height: 480px;
}
```

Alternatively, pass `height: 480` (pixels) or `height: '60vh'` to the options.
A mount inside a flex/grid layout must have a resolved height; if the editor
collapses, check that an ancestor does not have `height: auto` all the way down.

## CSP requirement

CodeMirror injects `<style>` elements at runtime for its editor styles. A host
with a Content Security Policy must allow them:

```text
style-src 'self' 'unsafe-inline';
```

A nonce-based policy works too if the nonce is configured for the page's
runtime-injected styles (`style-src 'self' 'nonce-…'`). Without `'unsafe-inline'`
(or a nonce equivalent), the editor may render unstyled or the browser may log
CSP violations. Scripts can stay strict: the bundle is a normal ES module and
does not require `eval` or `unsafe-eval`. If you load remote Markdown images,
allow the relevant image origins with `img-src`.

## Server-side rendering (Node)

The `@codecody93/notedown-editor/render` subpath converts Markdown to sanitized
HTML on the server without loading the editor. It requires Node 20 or newer;
edge runtimes are out of scope for 0.7.5.

`jsdom` is an optional peer dependency; the browser editor does not use it.
Install both:

```sh
npm install @codecody93/notedown-editor jsdom
```

Use a jsdom release compatible with your Node runtime: jsdom 30 requires Node
22.22 or newer, so Node 20 installations should use jsdom 26–29.

The subpath exports:

| Export | Description |
| --- | --- |
| `renderMarkdown(markdown)` | Sanitized HTML fragment. |
| `renderMarkdownDocument(markdown, options?)` | Complete standalone HTML page. |
| `createNotedownRenderer(sanitizeHtml)` | `renderMarkdown`/`renderMarkdownDocument` bound to a custom sanitizer/DOM. |
| `MARKDOWN_BODY_CSS` | Default typography and element styles, scoped under `.md-body`. |
| `NOTEDOWN_THEME_CSS` | Light and dark theme custom properties. |
| `HLJS_CSS_LIGHT`, `HLJS_CSS_DARK` | highlight.js themes used by the standalone document. |

`renderMarkdownDocument` options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | `'Notedown document'` | `<title>` text. |
| `lang` | `string` | `'en'` | `<html lang>` value. |
| `csp` | `string \| false` | Notedown's export CSP | CSP meta tag content. `false` omits the meta tag. |

Rendering from a file:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import {
  renderMarkdown,
  renderMarkdownDocument,
} from '@codecody93/notedown-editor/render'

const source = await readFile('notes.md', 'utf8')

// Fragment for your own page layout:
const fragment = renderMarkdown(source)

// Complete standalone page:
const page = renderMarkdownDocument(source, { title: 'Notes' })
await writeFile('notes.html', page, 'utf8')
```

`renderMarkdownDocument` mirrors File → Export HTML in the desktop and web apps:
theme variables, body CSS, light and dark highlight themes, print CSS, the CSP
meta tag, and the spoiler/copy inline script. It follows
`prefers-color-scheme`.

`renderMarkdown` returns a fragment, not a page. Wrap it in an element with the
`md-body` class and include the CSS exports yourself: `MARKDOWN_BODY_CSS` plus
`NOTEDOWN_THEME_CSS`, or the app's own equivalent. Add `HLJS_CSS_LIGHT` and/or
`HLJS_CSS_DARK` for highlighted code blocks.

Relative image and link URLs are passed through unchanged. Resolve them on the
host; the renderer deliberately has no file-reading helper, so use `node:fs` as
above.

### CSP and remote images

The standalone document's default CSP permits inline styles and scripts and
`data:`/`blob:` images. If the host owns the policy, or the document references
remote images, pass a custom policy or disable the meta tag:

```ts
renderMarkdownDocument(source, {
  csp: "default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'",
})

// Or attach your own CSP at the HTTP-header layer:
renderMarkdownDocument(source, { csp: false })
```

For the strictest policy, use `renderMarkdown` and serve the fragment inside a
host page with your own CSP. A custom policy must allow the inline styles the
document ships; allow inline scripts too if you want the spoiler and copy-code
buttons to work.

### Custom sanitizer

`createNotedownRenderer(sanitizeHtml)` is the escape hatch for a custom
DOMPurify configuration or DOM implementation. The callback receives the raw
markdown-it HTML and must return sanitized HTML:

```ts
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { createNotedownRenderer } from '@codecody93/notedown-editor/render'

const purify = DOMPurify(
  new JSDOM('').window as unknown as Parameters<typeof DOMPurify>[0],
)
const renderer = createNotedownRenderer((html) =>
  purify.sanitize(html, { ADD_ATTR: ['target'] }),
)
const fragment = renderer.renderMarkdown('# Notes')
```

Every render must still pass through DOMPurify in production; the callback
replaces the built-in sanitizer, it does not bypass sanitization.

## SSR and framework notes

- The root entry (`@codecody93/notedown-editor`) is browser-only. It expects
  `document` and `window`; importing it in a Node/SSR render is not supported.
  In Next.js, Nuxt, SvelteKit, or similar, import and call
  `createNotedownEditor` inside `onMounted`/`useEffect`/a client-only component.
- To produce Markdown HTML on the server, use the Node-only
  `@codecody93/notedown-editor/render` subpath described above. Do not import the
  editor entry on the server just to render Markdown.
- `destroy()` in the framework's unmount hook and remove any host listeners you
  added around the editor.
- The editor owns its own undo history and content state. Treat `value` as the
  initial value only; read `getValue()` or use `onChange` for the current
  content.
- The package is a pure ES module. Hosts that need a global build should import
  the CDN module directly rather than expecting a UMD/`window` global.

## Sponsor

Notedown is MIT-licensed and free to use. If it saves you time, you can
support development through GitHub Sponsors:
<https://github.com/sponsors/CodeCody93>.

## License

MIT. See the repository
[`LICENSE`](https://github.com/CodeCody93/Notedown/blob/main/LICENSE) and
[`THIRD_PARTY_NOTICES.md`](https://github.com/CodeCody93/Notedown/blob/main/THIRD_PARTY_NOTICES.md).
The published package includes a copy of both files.
