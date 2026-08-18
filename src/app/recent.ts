export const MAX_RECENTS = 10

export interface RecentEntry {
  path: string
  name: string
  lastOpened: number
}

export function parseRecents(json: string | null): RecentEntry[] {
  if (json === null) return []
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out: RecentEntry[] = []
  for (const item of data) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as Partial<RecentEntry>
    if (typeof rec.path !== 'string') continue
    if (typeof rec.name !== 'string') continue
    out.push({
      path: rec.path,
      name: rec.name,
      lastOpened: typeof rec.lastOpened === 'number' ? rec.lastOpened : 0,
    })
  }
  return out
}

export function addRecent(recents: RecentEntry[], entry: { path: string; name: string }): RecentEntry[] {
  const next = recents.filter((r) => r.path !== entry.path)
  const fresh: RecentEntry = { path: entry.path, name: entry.name, lastOpened: Date.now() }
  return [fresh, ...next].slice(0, MAX_RECENTS)
}

export function removeRecent(recents: RecentEntry[], path: string): RecentEntry[] {
  return recents.filter((r) => r.path !== path)
}
