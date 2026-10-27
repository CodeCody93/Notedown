import { describe, expect, it } from 'vitest'
import { parseOutline, type OutlineHeading } from '../src/app/outline'

function flatten(headings: OutlineHeading[]): OutlineHeading[] {
  return headings.flatMap((heading) => [heading, ...flatten(heading.children)])
}

describe('parseOutline', () => {
  it('parses ATX levels, text, 1-based lines and nesting', () => {
    const source = [
      '# Title',
      '',
      'Intro',
      '',
      '## Section A',
      '',
      '### Sub A1',
      '',
      '## Section B',
    ].join('\n')

    const outline = parseOutline(source)

    expect(outline).toHaveLength(1)
    expect(outline[0]).toMatchObject({ level: 1, text: 'Title', line: 1 })
    expect(outline[0].children.map((heading) => heading.text)).toEqual([
      'Section A',
      'Section B',
    ])
    expect(outline[0].children[0]).toMatchObject({
      level: 2,
      text: 'Section A',
      line: 5,
    })
    expect(outline[0].children[0].children).toHaveLength(1)
    expect(outline[0].children[0].children[0]).toMatchObject({
      level: 3,
      text: 'Sub A1',
      line: 7,
    })
    expect(outline[0].children[1]).toMatchObject({
      level: 2,
      text: 'Section B',
      line: 9,
    })
  })

  it('ignores headings inside fenced and indented code blocks', () => {
    const fence = '```'
    const source = [
      '# Real',
      '',
      fence,
      '# Not a heading',
      fence,
      '',
      '    # Also not a heading',
      '',
      '## Also real',
    ].join('\n')

    expect(flatten(parseOutline(source)).map((heading) => heading.text)).toEqual([
      'Real',
      'Also real',
    ])
  })

  it('parses setext headings at levels 1 and 2', () => {
    const source = [
      'Setext One',
      '==========',
      '',
      'Setext Two',
      '----------',
    ].join('\n')

    const outline = parseOutline(source)

    expect(outline).toHaveLength(1)
    expect(outline[0]).toMatchObject({ level: 1, text: 'Setext One', line: 1 })
    expect(outline[0].children).toHaveLength(1)
    expect(outline[0].children[0]).toMatchObject({
      level: 2,
      text: 'Setext Two',
      line: 4,
    })
  })

  it('strips inline markdown from the visible text', () => {
    const outline = parseOutline(
      '## **Bold** and [link](https://x) and `code`',
    )

    expect(outline[0].text).toBe('Bold and link and code')
  })

  it('uses a custom {#id} anchor and hides it from the visible text', () => {
    const outline = parseOutline('# Title {#custom}')

    expect(outline[0].text).toBe('Title')
    expect(outline[0].anchor).toBe('custom')
    expect(outline[0].key).toBe('custom')
  })

  it('makes duplicate anchors and keys unique', () => {
    const source = [
      '# Intro',
      '',
      '## Notes',
      '',
      '## Notes',
      '',
      '## Notes',
    ].join('\n')

    const all = flatten(parseOutline(source))

    expect(all.map((heading) => heading.anchor)).toEqual([
      'intro',
      'notes',
      'notes-2',
      'notes-3',
    ])
    expect(all.map((heading) => heading.key)).toEqual([
      'intro',
      'notes',
      'notes-2',
      'notes-3',
    ])
    expect(new Set(all.map((heading) => heading.key)).size).toBe(all.length)
  })

  it('deduplicates repeated custom ids', () => {
    const all = flatten(
      parseOutline('# One {#dup}\n\n# Two {#dup}\n\n# Three {#dup}'),
    )

    expect(all.map((heading) => heading.anchor)).toEqual([
      'dup',
      'dup-2',
      'dup-3',
    ])
    expect(all.map((heading) => heading.key)).toEqual([
      'dup',
      'dup-2',
      'dup-3',
    ])
  })

  it('nests a skipped heading level under the nearest lower-level heading', () => {
    const outline = parseOutline('# Top\n\n### Deep')

    expect(outline).toHaveLength(1)
    expect(outline[0].children).toHaveLength(1)
    expect(outline[0].children[0]).toMatchObject({
      level: 3,
      text: 'Deep',
      line: 3,
    })
    expect(outline[0].children[0].children).toEqual([])
  })

  it('falls back to a non-empty label for empty headings', () => {
    const outline = parseOutline('#\n\nBody text')

    expect(outline[0].text).toBe('(Untitled heading)')
    expect(outline[0].text.length).toBeGreaterThan(0)
    expect(outline[0].anchor).toBe('untitled-heading')
    expect(outline[0].key).toBe('untitled-heading')
  })

  it('reports 1-based line numbers for CRLF input', () => {
    const outline = parseOutline(['# One', '', '## Two'].join('\r\n'))

    expect(outline[0].line).toBe(1)
    expect(outline[0].children[0].line).toBe(3)
  })
})
