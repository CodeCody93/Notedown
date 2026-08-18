import type { FileIO } from '../platform/types'

export const SESSION_KEY = '__session__'

export interface Session {
  path: string | null
  name: string
  ts: number
}

export function draftKey(path: string | null): string {
  if (path === null || path === '') return 'd:untitled'
  return 'd:' + path.replace(/[^A-Za-z0-9._-]/g, '_')
}

export function parseSession(json: string | null): Session | null {
  if (json === null) return null
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const rec = data as Partial<Session>
  if (typeof rec.name !== 'string') return null
  return {
    path: typeof rec.path === 'string' ? rec.path : null,
    name: rec.name,
    ts: typeof rec.ts === 'number' ? rec.ts : 0,
  }
}

export function shouldRecover(session: Session | null, draft: string | null): boolean {
  return session !== null && draft !== null && draft !== ''
}

export async function writeSession(io: FileIO, session: Session): Promise<void> {
  await io.writeDraft(SESSION_KEY, JSON.stringify(session))
}

export async function clearSession(io: FileIO): Promise<void> {
  await io.clearDraft(SESSION_KEY)
}

export async function saveDraft(io: FileIO, path: string | null, content: string): Promise<void> {
  await io.writeDraft(draftKey(path), content)
}

export async function clearDraft(io: FileIO, path: string | null): Promise<void> {
  await io.clearDraft(draftKey(path))
}
