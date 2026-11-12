/**
 * `@codecody93/notedown-editor` — public entry point.
 *
 * Bundling this module pulls in the packaged stylesheet (`embed.css`), the
 * editor core, and the pure formatting/outline helpers. It never touches the
 * app shell, the platform layer, or Tauri.
 */
import '../styles/embed.css'

export { createNotedownEditor } from './create'
export type {
  CreateNotedownEditorOptions,
  NotedownEditor,
  NotedownImageResolver,
  NotedownMode,
  NotedownPasteImageHandler,
} from './create'
export type { EmbedTheme, EmbedThemeController } from './theme'
export type { ToolbarItem, ToolbarOptions } from './toolbar'
export { DEFAULT_TOOLBAR_GROUPS } from './toolbar'

// Pure helpers exposed for consumers that build their own UI around the editor.
export { FORMATTING_COMMANDS } from '../app/formatting'
export { SHORTCUTS } from '../app/shortcuts'
export { parseOutline } from '../app/outline'
export type { OutlineHeading } from '../app/outline'
export type { EditorController, EditorCursor } from '../editor/editor'
