export function detectLineEnding(text: string): 'LF' | 'CRLF' {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r') return text[i + 1] === '\n' ? 'CRLF' : 'LF'
    if (text[i] === '\n') return 'LF'
  }
  return 'LF'
}

export function stripBom(text: string): { text: string; hadBom: boolean } {
  if (text.charCodeAt(0) === 0xfeff) {
    return { text: text.slice(1), hadBom: true }
  }
  return { text, hadBom: false }
}

/**
 * Directory of a doc path, using the LAST '/' or '\' as the split point, with
 * the separator flavor matching the doc path. 'C:\a\b.md' → 'C:\a',
 * '/docs/notes.md' → '/docs'.
 */
export function docDir(docPath: string): { dir: string; sep: string } {
  const lastSlash = Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
  return {
    dir: lastSlash === -1 ? '' : docPath.slice(0, lastSlash),
    sep: docPath.includes('\\') ? '\\' : '/',
  }
}

/** Resolve a relative link/image src against the document's directory. */
export function resolveAgainstDocDir(docPath: string, rel: string): string {
  const { dir, sep } = docDir(docPath)
  const clean = rel.replace(/^\.\/|^\.\\/, '').replace(/^[\\/]+/, '')
  return `${dir}${sep}${clean}`
}
