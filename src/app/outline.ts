/**
 * Notedown — pure markdown outline parser.
 *
 * Turns markdown into a nested heading tree for the navigator pane. No DOM
 * access, no side effects, no async. Markdown is parsed with the same
 * markdown-it + markdown-it-attrs dialect used elsewhere, so ATX/setext
 * headings, `{#custom}` ids and fenced/indented code behavior match the
 * renderer.
 */
import MarkdownIt from 'markdown-it'
import attrs from 'markdown-it-attrs'

export interface OutlineHeading {
  /** 1–6 */
  level: number
  /** Visible heading text, markdown formatting stripped, whitespace collapsed. Never empty (fallback label). */
  text: string
  /** 1-based source line of the heading. */
  line: number
  /** Custom `{#id}` anchor when present, otherwise a generated slug. Unique across the outline. */
  anchor: string
  /** Unique stable key for UI collapse state (anchor plus a duplicate suffix when needed). */
  key: string
  children: OutlineHeading[]
}

const EMPTY_HEADING_LABEL = '(Untitled heading)'

const md = new MarkdownIt({ html: true })
md.use(attrs)

type OutlineToken = ReturnType<typeof md.parse>[number]

function collectVisible(tokens: OutlineToken[], parts: string[]): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'code_inline':
      case 'emoji':
        parts.push(token.content)
        break
      case 'image':
        if (token.children && token.children.length > 0) {
          collectVisible(token.children, parts)
        } else {
          parts.push(token.content)
        }
        break
      case 'softbreak':
      case 'hardbreak':
        parts.push(' ')
        break
      default:
        break
    }
  }
}

function visibleText(tokens: OutlineToken[] | null | undefined): string {
  if (!tokens) return ''
  const parts: string[] = []
  collectVisible(tokens, parts)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

function uniqueAnchor(base: string, used: Set<string>): string {
  let anchor = base
  let suffix = 2
  while (used.has(anchor)) {
    anchor = `${base}-${suffix}`
    suffix += 1
  }
  used.add(anchor)
  return anchor
}

function customAnchor(token: OutlineToken): string | null {
  const id = token.attrGet('id')
  if (typeof id === 'string' && id.trim() !== '') return id
  return null
}

/** Parse markdown into a nested heading tree. */
export function parseOutline(markdown: string): OutlineHeading[] {
  const tokens = md.parse(markdown, {})
  const roots: OutlineHeading[] = []
  const stack: OutlineHeading[] = []
  const used = new Set<string>()

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type !== 'heading_open') continue

    const inline = tokens[i + 1]
    const text =
      visibleText(inline?.type === 'inline' ? inline.children : null) ||
      EMPTY_HEADING_LABEL
    const anchor = uniqueAnchor(customAnchor(token) ?? slugify(text), used)

    const heading: OutlineHeading = {
      level: Number(token.tag.slice(1)),
      text,
      line: (token.map?.[0] ?? 0) + 1,
      anchor,
      key: anchor,
      children: [],
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop()
    }
    if (stack.length === 0) {
      roots.push(heading)
    } else {
      stack[stack.length - 1].children.push(heading)
    }
    stack.push(heading)
  }

  return roots
}
