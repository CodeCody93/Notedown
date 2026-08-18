import type { Settings } from './settings'
import { DEFAULT_SETTINGS } from './settings'

export interface CurrentDoc {
  path: string | null
  name: string
  content: string
  /** The content as last saved (or the baseline when the doc was created/recovered). `dirty` is derived by comparing against this. */
  savedContent: string
  dirty: boolean
  lineEnding: 'LF' | 'CRLF'
  encoding: string
}

export interface RecentEntry {
  path: string
  name: string
  lastOpened: number
}

export interface AppState {
  doc: CurrentDoc
  mode: 'live' | 'source'
  settings: Settings
  recents: RecentEntry[]
}

export interface Store<T> {
  get(): T
  set(patch: Partial<T>): void
  subscribe(fn: (state: T) => void): () => void
}

// Minimal hand-rolled observable store: shallow-merge patches, notify synchronously.
export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const subscribers = new Set<(state: T) => void>()

  return {
    get() {
      return state
    },
    set(patch: Partial<T>) {
      state = { ...state, ...patch }
      for (const fn of subscribers) fn(state)
    },
    subscribe(fn) {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },
  }
}

export const appState: Store<AppState> = createStore<AppState>({
  doc: {
    path: null,
    name: 'untitled.md',
    content: '',
    savedContent: '',
    dirty: false,
    lineEnding: 'LF',
    encoding: 'utf-8',
  },
  mode: 'live',
  settings: DEFAULT_SETTINGS,
  recents: [],
})
