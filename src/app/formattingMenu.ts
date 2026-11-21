// Shared formatting menu data — the single source of truth for the app
// menubar/toolbar (src/app/menu.ts) and the embeddable toolbar.
//
// This module is pure data (icons are static SVG strings) and performs no DOM
// access at module top level, so it is safe to import from the embed bundle
// without pulling in the app-shell menu renderer.
//
// The action ids are LOCKED: app.ts's dispatcher consumes the `data-action`
// attribute on every rendered button/menu-item, so renaming any id here breaks
// menu clicks.

import { ICON } from './icons'

/** One row of the shared formatting menu/toolbar data. */
export interface FormattingMenuEntry {
  /** LOCKED action id → becomes the button's data-action attribute (consumed by app.ts's dispatcher). */
  id: string
  /** Human label shown in the menu row / tooltip. */
  label: string
  /** Inline SVG inner markup for a stroke-based 16×16 icon, OR undefined. */
  icon?: string
  /** Text glyph shown instead of an icon (e.g. 'H', '⋯', 'H1'). */
  glyph?: string
  /** Shortcut id (a SHORTCUTS id) whose label renders as the right-aligned hotkey hint. */
  hotkey?: string
  /** Submenu entries (shown for Header, List, Graph). */
  children?: FormattingMenuEntry[]
}

/** Paragraph/Heading 1–6 submenu rows (shared by the app toolbar and embed presets). */
export const HEADER_ITEMS: FormattingMenuEntry[] = [
  { id: 'header-0', label: 'Paragraph', glyph: '¶', hotkey: 'header-0' },
  { id: 'header-1', label: 'Heading 1', glyph: 'H1', hotkey: 'header-1' },
  { id: 'header-2', label: 'Heading 2', glyph: 'H2', hotkey: 'header-2' },
  { id: 'header-3', label: 'Heading 3', glyph: 'H3', hotkey: 'header-3' },
  { id: 'header-4', label: 'Heading 4', glyph: 'H4', hotkey: 'header-4' },
  { id: 'header-5', label: 'Heading 5', glyph: 'H5', hotkey: 'header-5' },
  { id: 'header-6', label: 'Heading 6', glyph: 'H6', hotkey: 'header-6' },
]

/** Unordered / ordered / task list submenu rows (shared by the app toolbar and embed presets). */
export const LIST_ITEMS: FormattingMenuEntry[] = [
  { id: 'list-unordered', label: 'Unordered', hotkey: 'list' },
  { id: 'list-ordered', label: 'Ordered (1, 2, 3)', hotkey: 'list-ordered' },
  { id: 'list-ordered-alpha', label: 'Ordered (a, b, c)' },
  { id: 'list-ordered-roman', label: 'Ordered (i, ii, iii)' },
  { id: 'list-task', label: 'Task', hotkey: 'task-list' },
]

export const EXTRA_MENU: FormattingMenuEntry[] = [
  { id: 'blockquote', label: 'Blockquote', hotkey: 'blockquote', icon: ICON.blockquote },
  { id: 'inline-code', label: 'Inline code', hotkey: 'inline-code', icon: ICON.inlineCode },
  { id: 'code-block', label: 'Code block', hotkey: 'code-block', icon: ICON.codeBlock },
  { id: 'link', label: 'Link', hotkey: 'link', icon: ICON.link },
  { id: 'image', label: 'Image', hotkey: 'image', icon: ICON.image },
  { id: 'table', label: 'Table', hotkey: 'table', icon: ICON.table },
  { id: 'hr', label: 'Horizontal rule', hotkey: 'hr', icon: ICON.hr },
  { id: 'footnote', label: 'Footnote', hotkey: 'footnote', icon: ICON.footnote },
  { id: 'task-list', label: 'Task list', hotkey: 'task-list', icon: ICON.taskList },
  { id: 'emoji', label: 'Emoji picker', hotkey: 'emoji', icon: ICON.emoji },
  { id: 'heading-id', label: 'Heading ID', hotkey: 'heading-id', icon: ICON.headingId },
  { id: 'def-list', label: 'Definition list', hotkey: 'def-list', icon: ICON.defList },
  { id: 'sub', label: 'Subscript', hotkey: 'sub', icon: ICON.sub },
  { id: 'sup', label: 'Superscript', hotkey: 'sup', icon: ICON.sup },
  { id: 'highlight', label: 'Highlight', hotkey: 'highlight', icon: ICON.highlight },
  { id: 'spoiler', label: 'Spoiler', hotkey: 'spoiler', icon: ICON.spoiler },
  { id: 'dropdown', label: 'Dropdown', hotkey: 'dropdown', icon: ICON.dropdown },
  {
    id: 'graph',
    label: 'Graph',
    hotkey: 'graph',
    icon: ICON.graph,
    children: [
      { id: 'pie-graph', label: 'Pie chart' },
      { id: 'bar-graph', label: 'Bar chart' },
      { id: 'line-graph', label: 'Line chart' },
    ],
  },
]

/** Inline formatting group (bold…strikethrough + Header/List dropdowns). */
export const INLINE_TOOLBAR_ITEMS: FormattingMenuEntry[] = [
  { id: 'bold', label: 'Bold', hotkey: 'bold', icon: ICON.bold },
  { id: 'italic', label: 'Italic', hotkey: 'italic', icon: ICON.italic },
  { id: 'underline', label: 'Underline', hotkey: 'underline', icon: ICON.underline },
  { id: 'strikethrough', label: 'Strikethrough', hotkey: 'strikethrough', icon: ICON.strikethrough },
  { id: 'header', label: 'Header', hotkey: 'header-cycle', glyph: 'H', children: HEADER_ITEMS },
  { id: 'list', label: 'List', hotkey: 'list', icon: ICON.list, children: LIST_ITEMS },
]

export const EXTRA_TOOLBAR_ITEM: FormattingMenuEntry = {
  id: 'extra',
  label: 'Extra',
  glyph: '⋯',
  children: EXTRA_MENU,
}

/** Formatting-only toolbar groups shared by the app toolbar and the embed toolbar. */
export const FORMATTING_TOOLBAR_GROUPS: FormattingMenuEntry[][] = [
  INLINE_TOOLBAR_ITEMS,
  [EXTRA_TOOLBAR_ITEM],
]
