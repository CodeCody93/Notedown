/**
 * Unit tests for the pure table model (src/app/table.ts) plus the two additive
 * table specs in src/app/formatting.ts.
 *
 * Runs in a plain node environment (no DOM).
 */
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { TransactionSpec } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import {
  alignMarker,
  buildNestedCellHtml,
  detectTableBlock,
  escapeCellContent,
  escapeHtmlTableText,
  freshTableModel,
  parseAlignMarker,
  parseGfmTable,
  serializeGfm,
  serializeHtmlTable,
  splitGfmRow,
} from '../src/app/table'
import type { TableModel } from '../src/app/table'
import { insertTableWithModelSpec, replaceLinesSpec } from '../src/app/formatting'

function stateOf(doc: string, anchor: number): EditorState {
  return EditorState.create({ doc, extensions: [markdown()], selection: { anchor } })
}

function apply(state: EditorState, spec: TransactionSpec): { doc: string; head: number } {
  const tr = state.update(spec)
  return { doc: tr.state.doc.toString(), head: tr.state.selection.main.head }
}

describe('escapeCellContent', () => {
  it('escapes pipes', () => {
    expect(escapeCellContent('a|b')).toBe('a\\|b')
  })

  it('escapes backslashes before pipes', () => {
    expect(escapeCellContent('a\\b')).toBe('a\\\\b')
    expect(escapeCellContent('a\\|b')).toBe('a\\\\\\|b')
  })

  it('strips CR and folds newlines to <br>', () => {
    expect(escapeCellContent('a\r\nb\nc')).toBe('a<br>b<br>c')
  })
})

describe('alignMarker / parseAlignMarker', () => {
  it('round-trips every alignment', () => {
    const aligns: TableModel['aligns'] = ['none', 'left', 'center', 'right']
    for (const a of aligns) expect(parseAlignMarker(alignMarker(a))).toBe(a)
  })

  it('emits the exact GFM markers', () => {
    expect(alignMarker('none')).toBe('-----')
    expect(alignMarker('left')).toBe(':----')
    expect(alignMarker('center')).toBe(':----:')
    expect(alignMarker('right')).toBe('----:')
  })

  it('accepts 1+ dashes', () => {
    expect(parseAlignMarker('-')).toBe('none')
    expect(parseAlignMarker(':-')).toBe('left')
    expect(parseAlignMarker('-:')).toBe('right')
    expect(parseAlignMarker(':-:')).toBe('center')
  })

  it('rejects non-separator cells as none', () => {
    expect(parseAlignMarker('xxx')).toBe('none')
    expect(parseAlignMarker('')).toBe('none')
    expect(parseAlignMarker(':')).toBe('none')
    expect(parseAlignMarker('--x--')).toBe('none')
  })
})

describe('serializeGfm', () => {
  it('serializes a 2x2 model with center/right markers exactly', () => {
    const model: TableModel = {
      header: true,
      aligns: ['center', 'right'],
      headers: ['A', 'B'],
      body: [
        ['1', '2'],
        ['3', '4'],
      ],
    }
    expect(serializeGfm(model)).toBe('\n| A | B |\n| :----: | ----: |\n| 1 | 2 |\n| 3 | 4 |\n')
  })

  it('escapes cell content', () => {
    const model: TableModel = {
      header: true,
      aligns: ['none'],
      headers: ['a|b'],
      body: [['c\nd']],
    }
    expect(serializeGfm(model)).toBe('\n| a\\|b |\n| ----- |\n| c<br>d |\n')
  })

  it('still emits headers + separator when header is false', () => {
    const model: TableModel = { header: false, aligns: ['none'], headers: ['H'], body: [['c']] }
    expect(serializeGfm(model)).toBe('\n| H |\n| ----- |\n| c |\n')
  })
})

describe('serializeHtmlTable', () => {
  it('emits single-line thead/tbody HTML with escaped cells', () => {
    const model: TableModel = {
      header: true,
      aligns: ['none'],
      headers: ['A&B'],
      body: [['<b>x</b>']],
    }
    expect(serializeHtmlTable(model)).toBe(
      '<table><thead><tr><th>A&amp;B</th></tr></thead><tbody><tr><td>&lt;b&gt;x&lt;/b&gt;</td></tr></tbody></table>',
    )
  })

  it('folds inner newlines to <br> and stays single-line', () => {
    const model: TableModel = { header: true, aligns: ['none'], headers: ['H'], body: [['a\nb']] }
    const html = serializeHtmlTable(model)
    expect(html).not.toContain('\n')
    expect(html).toContain('<td>a<br>b</td>')
  })

  it('uses <td> rows with no thead when header is false', () => {
    const model: TableModel = { header: false, aligns: ['none'], headers: ['H'], body: [['c']] }
    expect(serializeHtmlTable(model)).toBe(
      '<table><tbody><tr><td>H</td></tr><tr><td>c</td></tr></tbody></table>',
    )
  })

  it('buildNestedCellHtml embeds a table as single-line HTML', () => {
    const html = buildNestedCellHtml(freshTableModel(1, 1))
    expect(html.startsWith('<table>')).toBe(true)
    expect(html).not.toContain('\n')
  })
})

describe('escapeHtmlTableText', () => {
  it('escapes the 5 HTML metacharacters', () => {
    expect(escapeHtmlTableText('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('splitGfmRow', () => {
  it('splits a plain row and strips edge pipes', () => {
    expect(splitGfmRow('| a | b |')).toEqual(['a', 'b'])
    expect(splitGfmRow('a | b')).toEqual(['a', 'b'])
  })

  it('keeps escaped pipes inside one cell and unescapes them', () => {
    expect(splitGfmRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })

  it('ignores pipes inside HTML tags', () => {
    // Pipes inside a `<...>` tag span (e.g. an attribute) never split.
    // Pipes in *text* between tags are NOT protected: nested-table cell
    // text must stay pipe-free (the builder escapes `|`), because
    // markdown-it's own table rule would split them on render.
    expect(splitGfmRow('| <a href="a|b">x</a> | c |')).toEqual(['<a href="a|b">x</a>', 'c'])
    expect(splitGfmRow('| <table><tr><td>a</td></tr></table> | c |')).toEqual([
      '<table><tr><td>a</td></tr></table>',
      'c',
    ])
  })

  it('ignores pipes inside backtick code spans', () => {
    expect(splitGfmRow('| `a|b` | c |')).toEqual(['`a|b`', 'c'])
    expect(splitGfmRow('| ``a ` b|c`` | d |')).toEqual(['``a ` b|c``', 'd'])
  })

  it('treats an escaped backslash before a pipe as a delimiter', () => {
    expect(splitGfmRow('| a\\\\| b |')).toEqual(['a\\', 'b'])
  })
})

describe('parseGfmTable', () => {
  it('parses a valid table with aligns', () => {
    expect(parseGfmTable('| A | B |\n| --- | ---: |\n| 1 | 2 |\n| 3 | 4 |')).toEqual({
      header: true,
      aligns: ['none', 'right'],
      headers: ['A', 'B'],
      body: [
        ['1', '2'],
        ['3', '4'],
      ],
    })
  })

  it('pads ragged body rows', () => {
    expect(parseGfmTable('| A | B |\n| --- | --- |\n| 3 |')).toEqual({
      header: true,
      aligns: ['none', 'none'],
      headers: ['A', 'B'],
      body: [['3', '']],
    })
  })

  it('returns null for an invalid separator row', () => {
    expect(parseGfmTable('| A |\n| xxx |\n| 1 |')).toBeNull()
  })

  it('returns null for separator/header width mismatch or too few lines', () => {
    expect(parseGfmTable('| A | B |\n| --- |\n| 1 | 2 |')).toBeNull()
    expect(parseGfmTable('| A |')).toBeNull()
  })
})

describe('detectTableBlock', () => {
  const doc = '# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\ntext'

  it('finds the block from a body line', () => {
    const hit = detectTableBlock(doc, 5)
    expect(hit?.startLine).toBe(3)
    expect(hit?.endLine).toBe(5)
    expect(hit?.model).toEqual({
      header: true,
      aligns: ['none', 'none'],
      headers: ['A', 'B'],
      body: [['1', '2']],
    })
  })

  it('finds the block from the separator line', () => {
    expect(detectTableBlock(doc, 4)?.startLine).toBe(3)
  })

  it('returns null outside a table block', () => {
    expect(detectTableBlock(doc, 1)).toBeNull()
    expect(detectTableBlock(doc, 7)).toBeNull()
  })
})

describe('freshTableModel', () => {
  it('builds the default 3x3 model', () => {
    expect(freshTableModel()).toEqual({
      header: true,
      aligns: ['none', 'none', 'none'],
      headers: ['Col 1', 'Col 2', 'Col 3'],
      body: [
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
      ],
    })
  })

  it('clamps rows to 1..10 and cols to 1..8, flooring', () => {
    const small = freshTableModel(0, 0)
    expect(small.body.length).toBe(1)
    expect(small.headers.length).toBe(1)
    const big = freshTableModel(99, 99)
    expect(big.body.length).toBe(10)
    expect(big.headers.length).toBe(8)
    expect(big.headers[7]).toBe('Col 8')
    const floored = freshTableModel(2.9, 2.9)
    expect(floored.body.length).toBe(2)
    expect(floored.headers.length).toBe(2)
  })
})

describe('insertTableWithModelSpec', () => {
  it('inserts the serialized model with the caret in the first body cell', () => {
    const result = apply(stateOf('', 0), insertTableWithModelSpec(stateOf('', 0), freshTableModel(1, 1)))
    expect(result.doc).toBe('\n| Col 1 |\n| ----- |\n|  |\n')
    expect(result.head).toBe(23)
  })
})

describe('replaceLinesSpec', () => {
  it('replaces a line range and parks the caret at the end of the insert', () => {
    const result = apply(stateOf('a\nb\nc', 0), replaceLinesSpec(stateOf('a\nb\nc', 0), 2, 3, 'X'))
    expect(result.doc).toBe('a\nX')
    expect(result.head).toBe(3)
  })

  it('clamps out-of-range lines', () => {
    const result = apply(stateOf('a\nb', 0), replaceLinesSpec(stateOf('a\nb', 0), 0, 99, 'Z'))
    expect(result.doc).toBe('Z')
    expect(result.head).toBe(1)
  })
})
