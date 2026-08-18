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
