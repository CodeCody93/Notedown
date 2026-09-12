/**
 * Help content (P4): one entry per formatting command id plus the core
 * file/app features. All strings are PLAIN text — the help modal renders them
 * via textContent, never innerHTML, so there is no injection surface.
 *
 * hotkeyId must be a SHORTCUTS id or null. The modal resolves it through
 * labelFor(), so displayed hints always match the real keymap.
 */

export interface HelpEntry {
  id: string
  title: string
  example: string
  syntax: string
  hotkeyId: string | null
}

/** 2–3 sentence app summary rendered at the top of the Help modal. */
export const HELP_SUMMARY: string =
  'Notedown is a Markdown note-taking app with live preview and source modes. ' +
  'Use the toolbar or keyboard shortcuts to format text, and the File menu to manage documents. ' +
  'This guide lists every formatting command with its syntax and shortcut.'

export const HELP_ENTRIES: HelpEntry[] = [
  // --- inline formatting ---
  { id: 'bold', title: 'Bold', example: 'Make text bold', syntax: '**text**', hotkeyId: 'bold' },
  { id: 'italic', title: 'Italic', example: 'Emphasize text', syntax: '*text*', hotkeyId: 'italic' },
  { id: 'underline', title: 'Underline', example: 'Underline text', syntax: '__text__', hotkeyId: 'underline' },
  {
    id: 'strikethrough',
    title: 'Strikethrough',
    example: 'Strike through text',
    syntax: '~~text~~',
    hotkeyId: 'strikethrough',
  },
  // --- headings ---
  {
    id: 'header-cycle',
    title: 'Cycle heading',
    example: 'Cycle paragraph through heading levels',
    syntax: '# text',
    hotkeyId: 'header-cycle',
  },
  { id: 'header-0', title: 'Paragraph', example: 'Clear heading back to paragraph', syntax: 'text', hotkeyId: 'header-0' },
  { id: 'header-1', title: 'Heading 1', example: 'Top-level heading', syntax: '# text', hotkeyId: 'header-1' },
  { id: 'header-2', title: 'Heading 2', example: 'Section heading', syntax: '## text', hotkeyId: 'header-2' },
  { id: 'header-3', title: 'Heading 3', example: 'Subsection heading', syntax: '### text', hotkeyId: 'header-3' },
  { id: 'header-4', title: 'Heading 4', example: 'Minor heading', syntax: '#### text', hotkeyId: 'header-4' },
  { id: 'header-5', title: 'Heading 5', example: 'Small heading', syntax: '##### text', hotkeyId: 'header-5' },
  { id: 'header-6', title: 'Heading 6', example: 'Smallest heading', syntax: '###### text', hotkeyId: 'header-6' },
  // --- lists ---
  { id: 'list', title: 'Bulleted list', example: 'Start a bulleted list', syntax: '- item', hotkeyId: 'list' },
  {
    id: 'list-unordered',
    title: 'Unordered list',
    example: 'Insert an unordered list item',
    syntax: '- item',
    // No dedicated SHORTCUTS id — shares the List menu hotkey.
    hotkeyId: 'list',
  },
  {
    id: 'list-ordered',
    title: 'Ordered list',
    example: 'Insert an ordered list item',
    syntax: '1. item',
    hotkeyId: 'list-ordered',
  },
  {
    id: 'list-task',
    title: 'Task list item',
    example: 'Insert a task checkbox item',
    syntax: '-[] item',
    // No dedicated SHORTCUTS id — shares the Task list menu hotkey.
    hotkeyId: 'task-list',
  },
  // --- blocks ---
  { id: 'blockquote', title: 'Blockquote', example: 'Quote a paragraph', syntax: '> quote', hotkeyId: 'blockquote' },
  { id: 'inline-code', title: 'Inline code', example: 'Mark inline code', syntax: '`code`', hotkeyId: 'inline-code' },
  {
    id: 'code-block',
    title: 'Code block',
    example: 'Insert a fenced code block',
    syntax: '```\ncode\n```',
    hotkeyId: 'code-block',
  },
  { id: 'link', title: 'Link', example: 'Insert a link', syntax: '[text](url)', hotkeyId: 'link' },
  { id: 'image', title: 'Image', example: 'Insert an image', syntax: '![alt](image.png)', hotkeyId: 'image' },
  { id: 'table', title: 'Table', example: 'Insert a table', syntax: '| Col 1 | Col 2 |', hotkeyId: 'table' },
  { id: 'hr', title: 'Horizontal rule', example: 'Insert a divider', syntax: '---', hotkeyId: 'hr' },
  { id: 'footnote', title: 'Footnote', example: 'Insert a footnote', syntax: '[^1]', hotkeyId: 'footnote' },
  { id: 'task-list', title: 'Task list', example: 'Toggle a task list', syntax: '- [ ] item', hotkeyId: 'task-list' },
  { id: 'emoji', title: 'Emoji', example: 'Insert an emoji', syntax: ':smile:', hotkeyId: 'emoji' },
  {
    id: 'heading-id',
    title: 'Heading ID',
    example: 'Add a custom ID to a heading',
    syntax: '# Title {#custom-id}',
    hotkeyId: 'heading-id',
  },
  {
    id: 'def-list',
    title: 'Definition list',
    example: 'Insert a definition list',
    syntax: 'Term\n: Definition',
    hotkeyId: 'def-list',
  },
  { id: 'sub', title: 'Subscript', example: 'Subscript text', syntax: '~text~', hotkeyId: 'sub' },
  { id: 'sup', title: 'Superscript', example: 'Superscript text', syntax: '^text^', hotkeyId: 'sup' },
  { id: 'highlight', title: 'Highlight', example: 'Highlight text', syntax: '==text==', hotkeyId: 'highlight' },
  { id: 'spoiler', title: 'Spoiler', example: 'Hide spoiler text', syntax: '||text||', hotkeyId: 'spoiler' },
  { id: 'dropdown', title: 'Dropdown', example: 'Insert a collapsible block', syntax: '>>> Title', hotkeyId: 'dropdown' },
  { id: 'graph', title: 'Graph', example: 'Open the graph builder (or insert a chart tag)', syntax: '%% pie "Title" (Apples, 30) (Bananas, 45) %% / %% bar "Title" Units (Jan, 120) (Feb, 200) %% / %% line "Title" (Week, Mon, Tue) (Hits, 0, 100) (SiteA, 120, 200) %%', hotkeyId: 'graph' },
  { id: 'pie-graph', title: 'Pie chart', example: 'Insert a pie chart', syntax: '%% pie "Title" (Apples, 30) (Bananas, 45) %%', hotkeyId: null },
  { id: 'bar-graph', title: 'Bar chart', example: 'Insert a bar chart', syntax: '%% bar "Title" Units (Jan, 120) (Feb, 200) %%', hotkeyId: null },
  { id: 'line-graph', title: 'Line chart', example: 'Insert a multi-series line chart', syntax: '%% line "Title" (Week, Mon, Tue) (Hits, 0, 100) (SiteA, 120, 200) %%', hotkeyId: null },
  // --- file / app features (no markdown syntax — syntax stays '') ---
  { id: 'new', title: 'New', example: 'Start a new document', syntax: '', hotkeyId: 'new' },
  { id: 'open', title: 'Open', example: 'Open a Markdown file', syntax: '', hotkeyId: 'open' },
  { id: 'open-recent', title: 'Open recent', example: 'Reopen a recent file', syntax: '', hotkeyId: 'open-recent' },
  { id: 'save', title: 'Save', example: 'Save the current file', syntax: '', hotkeyId: 'save' },
  { id: 'save-as', title: 'Save as', example: 'Save under a new name', syntax: '', hotkeyId: 'save-as' },
  { id: 'export', title: 'Export', example: 'Export the document as TXT, HTML, PDF, Word (.docx), or RTF', syntax: '', hotkeyId: 'export' },
  { id: 'import', title: 'Import', example: 'Import a file into the editor', syntax: '', hotkeyId: null },
  { id: 'settings', title: 'Settings', example: 'Open app settings', syntax: '', hotkeyId: 'settings' },
  {
    id: 'toggle-mode',
    title: 'Toggle live/source',
    example: 'Switch between live preview and source',
    syntax: '',
    hotkeyId: 'toggle-mode',
  },
]

/**
 * Returns the ids in `allIds` that have no HELP_ENTRIES entry.
 * Used by tests to guard coverage of FORMATTING_COMMANDS keys.
 */
export function missingHelpIds(allIds: string[]): string[] {
  const have = new Set(HELP_ENTRIES.map((e) => e.id))
  return allIds.filter((id) => !have.has(id))
}
