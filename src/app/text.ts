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

/**
 * Strip a trailing query (`?...`) and fragment (`#...`) suffix from a relative
 * src, then URL-decode `%XX` escapes (a stray `%` keeps the raw string via the
 * try/catch fallback). Shared by {@link normalizeRelSrc} and
 * {@link resolveAgainstDocDir} so `pic.png?v=2`, `pic.png#frag` and
 * `my%20pic.png` all resolve to the on-disk file.
 */
function stripQueryAndDecode(rel: string): string {
  const cut = rel.search(/[?#]/)
  let clean = cut === -1 ? rel : rel.slice(0, cut)
  try {
    clean = decodeURIComponent(clean)
  } catch {
    // Stray "%" (e.g. "100%.png") — decodeURIComponent throws, keep raw.
  }
  return clean
}

/**
 * P1 — canonicalize a relative image/link src WITHOUT a doc directory:
 * strips query/fragment, URL-decodes `%XX`, and resolves `.`/`..` segments
 * lexically (splitting on both `/` and `\`). The separator flavor follows the
 * input (backslash when the input contains one, forward slash otherwise); a
 * leading rooted separator is preserved.
 */
export function normalizeRelSrc(src: string): string {
  const clean = stripQueryAndDecode(src)
  const sep = clean.includes('\\') ? '\\' : '/'
  const rooted = /^[\\/]/.test(clean)
  const out: string[] = []
  for (const seg of clean.split(/[/\\]/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop()
      } else if (!rooted) {
        out.push('..')
      }
    } else {
      out.push(seg)
    }
  }
  return (rooted ? sep : '') + out.join(sep)
}

/** Resolve a relative link/image src against the document's directory. */
export function resolveAgainstDocDir(docPath: string, rel: string): string {
  const { dir, sep } = docDir(docPath)
  const out: string[] = dir === '' ? [] : dir.split(/[/\\]/)
  for (const seg of stripQueryAndDecode(rel).split(/[/\\]/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      const last = out[out.length - 1]
      if (out.length > 0 && last !== '' && last !== '..' && !/^[A-Za-z]:$/.test(last ?? '')) {
        out.pop()
      } else if (out.length === 0) {
        out.push('..')
      }
      // ".." above a filesystem root or drive letter is dropped lexically.
    } else {
      out.push(seg)
    }
  }
  return out.join(sep)
}
