/**
 * Unit tests for the pure formatting transforms (src/app/formatting.ts), M3.
 *
 * Runs in a plain node environment (no DOM): each test builds an `EditorState` with the
 * markdown language, applies a transform's `TransactionSpec` via `state.update(spec)`,
 * and asserts the exact resulting document + caret placement.
 */
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { TransactionSpec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  FORMATTING_COMMANDS,
  continueListSpec,
  cycleHeadingSpec,
  insertDefListSpec,
  insertDropdownSpec,
  insertFootnoteSpec,
  insertBarGraphSpec,
  insertHeadingIdSpec,
  insertHrSpec,
  insertImageSpec,
  insertLineGraphSpec,
  insertLinkSpec,
  insertPieGraphSpec,
  insertTableSpec,
  insertTextSpec,
  markdownListKeymap,
  setHeadingSpec,
  toggleBlockquoteSpec,
  toggleBoldSpec,
  toggleCodeBlockSpec,
  toggleHighlightSpec,
  toggleInlineCodeSpec,
  toggleItalicSpec,
  toggleListSpec,
  toggleSpoilerSpec,
  toggleStrikethroughSpec,
  toggleSubscriptSpec,
  toggleSuperscriptSpec,
  toggleUnderlineSpec,
} from '../src/app/formatting'

function stateOf(doc: string, anchor: number, head?: number): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown()],
    selection: head === undefined ? { anchor } : { anchor, head },
  })
}

function apply(state: EditorState, spec: TransactionSpec): { doc: string; head: number } {
  const tr = state.update(spec)
  return { doc: tr.state.doc.toString(), head: tr.state.selection.main.head }
}

function applyTo(doc: string, anchor: number, head: number | undefined, spec: TransactionSpec) {
  return apply(stateOf(doc, anchor, head), spec)
}

describe('bold', () => {
  it('wraps a selection', () => {
    expect(applyTo('b', 0, 1, toggleBoldSpec(stateOf('b', 0, 1)))).toEqual({ doc: '**b**', head: 3 })
  })

  it('unwraps when already wrapped', () => {
    expect(applyTo('**b**', 0, 5, toggleBoldSpec(stateOf('**b**', 0, 5)))).toEqual({ doc: 'b', head: 1 })
  })

  it('empty selection inserts **** with the caret between the pairs', () => {
    expect(applyTo('ab', 1, undefined, toggleBoldSpec(stateOf('ab', 1)))).toEqual({ doc: 'a****b', head: 3 })
  })

  it('unwraps via the syntax tree when the selection is strictly inside the node', () => {
    const state = stateOf('xx **bold** yy', 5, 9)
    const tr = state.update(toggleBoldSpec(state))
    expect(tr.state.doc.toString()).toBe('xx bold yy')
    expect(tr.state.selection.main.anchor).toBe(3)
    expect(tr.state.selection.main.head).toBe(7)
  })

  it('unwraps with an empty caret inside the node (E1)', () => {
    expect(applyTo('xx **bold** yy', 6, undefined, toggleBoldSpec(stateOf('xx **bold** yy', 6)))).toEqual({
      doc: 'xx bold yy',
      head: 4,
    })
  })

  it('does NOT touch __-marked emphasis — underline owns it (E4)', () => {
    const state = stateOf('xx __und__ yy', 6)
    const tr = state.update(toggleBoldSpec(state))
    expect(tr.state.doc.toString()).toBe('xx __und__ yy')
    expect(tr.state.selection.main.head).toBe(6)
  })

  it('wrapping still works when the selection is NOT inside an existing node', () => {
    expect(applyTo('ab', 0, 2, toggleBoldSpec(stateOf('ab', 0, 2)))).toEqual({ doc: '**ab**', head: 4 })
  })
})

describe('italic', () => {
  it('wraps a selection', () => {
    expect(applyTo('b', 0, 1, toggleItalicSpec(stateOf('b', 0, 1)))).toEqual({ doc: '*b*', head: 2 })
  })

  it('unwraps when already wrapped', () => {
    expect(applyTo('*b*', 0, 3, toggleItalicSpec(stateOf('*b*', 0, 3)))).toEqual({ doc: 'b', head: 1 })
  })

  it('empty selection inserts ** with the caret between', () => {
    expect(applyTo('ab', 1, undefined, toggleItalicSpec(stateOf('ab', 1)))).toEqual({ doc: 'a**b', head: 2 })
  })

  it('unwraps via the syntax tree with a caret strictly inside the node', () => {
    expect(applyTo('*it*', 2, undefined, toggleItalicSpec(stateOf('*it*', 2)))).toEqual({ doc: 'it', head: 1 })
  })
})

describe('underline', () => {
  it('wraps a selection in __ (E3)', () => {
    expect(applyTo('b', 0, 1, toggleUnderlineSpec(stateOf('b', 0, 1)))).toEqual({ doc: '__b__', head: 3 })
  })

  it('unwraps when already wrapped', () => {
    expect(applyTo('__b__', 0, 5, toggleUnderlineSpec(stateOf('__b__', 0, 5)))).toEqual({ doc: 'b', head: 1 })
  })

  it('empty selection inserts ____ with the caret between the pairs', () => {
    expect(applyTo('ab', 1, undefined, toggleUnderlineSpec(stateOf('ab', 1)))).toEqual({
      doc: 'a____b',
      head: 3,
    })
  })

  it('unwraps with an empty caret inside __-emphasis (E1/E3)', () => {
    expect(applyTo('xx __und__ yy', 6, undefined, toggleUnderlineSpec(stateOf('xx __und__ yy', 6)))).toEqual({
      doc: 'xx und yy',
      head: 4,
    })
  })

  it('does NOT touch **-marked emphasis — bold owns it (E4)', () => {
    const state = stateOf('xx **bold** yy', 6)
    const tr = state.update(toggleUnderlineSpec(state))
    expect(tr.state.doc.toString()).toBe('xx **bold** yy')
    expect(tr.state.selection.main.head).toBe(6)
  })

  it('unwraps a literal __ pair that lezer does not parse as emphasis', () => {
    expect(applyTo('a__run__b', 4, undefined, toggleUnderlineSpec(stateOf('a__run__b', 4)))).toEqual({
      doc: 'arunb',
      head: 2,
    })
  })
})

describe('strikethrough', () => {
  it('wraps a selection', () => {
    expect(applyTo('b', 0, 1, toggleStrikethroughSpec(stateOf('b', 0, 1)))).toEqual({ doc: '~~b~~', head: 3 })
  })

  it('unwraps when already wrapped', () => {
    expect(applyTo('~~b~~', 0, 5, toggleStrikethroughSpec(stateOf('~~b~~', 0, 5)))).toEqual({ doc: 'b', head: 1 })
  })

  it('empty selection inserts ~~~~ with the caret between the pairs', () => {
    expect(applyTo('ab', 1, undefined, toggleStrikethroughSpec(stateOf('ab', 1)))).toEqual({ doc: 'a~~~~b', head: 3 })
  })

  it('unwraps via the syntax tree with a caret strictly inside the node (GFM)', () => {
    const gfmState = EditorState.create({
      doc: '~~gone~~',
      extensions: [markdown({ base: markdownLanguage })],
      selection: { anchor: 4 },
    })
    const tr = gfmState.update(toggleStrikethroughSpec(gfmState))
    expect(tr.state.doc.toString()).toBe('gone')
    expect(tr.state.selection.main.head).toBe(2)
  })
})

describe('setHeading', () => {
  it('paragraph → H2', () => {
    expect(applyTo('x', 0, undefined, setHeadingSpec(stateOf('x', 0), 2))).toEqual({ doc: '## x', head: 3 })
  })

  it('H3 → paragraph (level 0)', () => {
    expect(applyTo('### x', 4, undefined, setHeadingSpec(stateOf('### x', 4), 0))).toEqual({ doc: 'x', head: 0 })
  })

  it('multi-line mixed selection (paragraph + H3 → H2)', () => {
    expect(applyTo('a\n### b', 0, 7, setHeadingSpec(stateOf('a\n### b', 0, 7), 2))).toEqual({
      doc: '## a\n## b',
      head: 9,
    })
  })

  it('a line already at the target level is left unchanged', () => {
    expect(applyTo('## x', 3, undefined, setHeadingSpec(stateOf('## x', 3), 2))).toEqual({ doc: '## x', head: 3 })
  })
})

describe('cycleHeading', () => {
  it('paragraph → H1', () => {
    expect(applyTo('x', 0, undefined, cycleHeadingSpec(stateOf('x', 0)))).toEqual({ doc: '# x', head: 2 })
  })

  it('H6 → paragraph', () => {
    expect(applyTo('###### x', 0, undefined, cycleHeadingSpec(stateOf('###### x', 0)))).toEqual({ doc: 'x', head: 0 })
  })
})

describe('toggleList', () => {
  it('adds unordered markers to every selected line', () => {
    expect(applyTo('a\nb', 0, 3, toggleListSpec(stateOf('a\nb', 0, 3), 'unordered'))).toEqual({
      doc: '- a\n- b',
      head: 7,
    })
  })

  it('adds ordered markers with sequential numbers', () => {
    expect(applyTo('a\nb\nc', 0, 5, toggleListSpec(stateOf('a\nb\nc', 0, 5), 'ordered'))).toEqual({
      doc: '1. a\n2. b\n3. c',
      head: 14,
    })
  })

  it('adds task markers with the default -[] form (Other #4)', () => {
    expect(applyTo('a', 0, 1, toggleListSpec(stateOf('a', 0, 1), 'task'))).toEqual({ doc: '-[] a', head: 5 })
  })

  it('toggles off when every selected line already has the marker', () => {
    expect(applyTo('- a\n- b', 0, 7, toggleListSpec(stateOf('- a\n- b', 0, 7), 'unordered'))).toEqual({
      doc: 'a\nb',
      head: 3,
    })
  })

  it('unordered toggle removes the whole task marker, checkbox included (E7)', () => {
    for (const marker of ['- [ ] ', '-[] ', '- [ ]', '-[]']) {
      const doc = marker + 'task'
      expect(applyTo(doc, 1, undefined, toggleListSpec(stateOf(doc, 1), 'unordered'))).toEqual({
        doc: 'task',
        head: 0,
      })
    }
  })

  it('task toggle-off removes the whole marker on every spelling (Other #4)', () => {
    for (const marker of ['- [ ] ', '-[] ', '- [ ] ', '-[ ] ']) {
      const doc = marker + 'task'
      expect(applyTo(doc, 1, undefined, toggleListSpec(stateOf(doc, 1), 'task'))).toEqual({
        doc: 'task',
        head: 0,
      })
    }
  })

  it('operates on the caret line when the selection is empty', () => {
    expect(applyTo('a\nb', 3, undefined, toggleListSpec(stateOf('a\nb', 3), 'unordered'))).toEqual({
      doc: 'a\n- b',
      head: 5,
    })
  })
})

describe('toggleBlockquote', () => {
  it('prefixes every selected line', () => {
    expect(applyTo('a\nb', 0, 3, toggleBlockquoteSpec(stateOf('a\nb', 0, 3)))).toEqual({ doc: '> a\n> b', head: 7 })
  })

  it('removes one > from every quoted line', () => {
    expect(applyTo('> a', 0, 3, toggleBlockquoteSpec(stateOf('> a', 0, 3)))).toEqual({ doc: 'a', head: 1 })
  })
})

describe('toggleInlineCode', () => {
  it('wraps a selection in backticks', () => {
    expect(applyTo('b', 0, 1, toggleInlineCodeSpec(stateOf('b', 0, 1)))).toEqual({ doc: '`b`', head: 2 })
  })

  it('unwraps a single-backtick wrapping', () => {
    expect(applyTo('`b`', 0, 3, toggleInlineCodeSpec(stateOf('`b`', 0, 3)))).toEqual({ doc: 'b', head: 1 })
  })

  it('uses double backticks when the selection contains a backtick', () => {
    expect(applyTo('a`b', 0, 3, toggleInlineCodeSpec(stateOf('a`b', 0, 3)))).toEqual({ doc: '``a`b``', head: 5 })
  })

  it('empty selection inserts `` with the caret between', () => {
    expect(applyTo('ab', 1, undefined, toggleInlineCodeSpec(stateOf('ab', 1)))).toEqual({ doc: 'a``b', head: 2 })
  })

  it('unwraps with an empty caret inside a code span (E9)', () => {
    expect(applyTo('xx `code` yy', 6, undefined, toggleInlineCodeSpec(stateOf('xx `code` yy', 6)))).toEqual({
      doc: 'xx code yy',
      head: 5,
    })
  })

  it('unwraps with a selection inside a code span (E9)', () => {
    expect(applyTo('xx `code` yy', 5, 8, toggleInlineCodeSpec(stateOf('xx `code` yy', 5, 8)))).toEqual({
      doc: 'xx code yy',
      head: 7,
    })
  })

  it('unwraps a double-backtick span with both delimiter pairs', () => {
    expect(applyTo('a ``b`` c', 4, undefined, toggleInlineCodeSpec(stateOf('a ``b`` c', 4)))).toEqual({
      doc: 'a b c',
      head: 2,
    })
  })
})

describe('toggleCodeBlock', () => {
  it('wraps a selection in a fence', () => {
    expect(applyTo('code', 0, 4, toggleCodeBlockSpec(stateOf('code', 0, 4)))).toEqual({
      doc: '```\ncode\n```',
      head: 4,
    })
  })

  it('empty selection inserts a template with the caret on the middle line', () => {
    expect(applyTo('x', 1, undefined, toggleCodeBlockSpec(stateOf('x', 1)))).toEqual({
      doc: 'x```\n\n```',
      head: 5,
    })
  })

  it('removes fences when the selection already spans a fenced block', () => {
    expect(applyTo('```\ncode\n```', 0, 12, toggleCodeBlockSpec(stateOf('```\ncode\n```', 0, 12)))).toEqual({
      doc: '\ncode\n',
      head: 6,
    })
  })

  it('removes the WHOLE fenced block with an empty caret inside (E10)', () => {
    expect(applyTo('```\ncode\n```', 5, undefined, toggleCodeBlockSpec(stateOf('```\ncode\n```', 5)))).toEqual({
      doc: 'code',
      head: 1,
    })
  })
})

describe('insertLink', () => {
  it('wraps a selection and selects the url for typing', () => {
    const result = applyTo('sel', 0, 3, insertLinkSpec(stateOf('sel', 0, 3)))
    expect(result.doc).toBe('[sel](url)')
    expect(result.head).toBe(9)
  })

  it('empty selection inserts [text](url) with text selected', () => {
    const result = applyTo('', 0, undefined, insertLinkSpec(stateOf('', 0)))
    expect(result.doc).toBe('[text](url)')
    expect(result.head).toBe(5)
  })

  it('re-invoking on the untouched template deletes it (E11)', () => {
    const result = applyTo('[text](url)', 11, undefined, insertLinkSpec(stateOf('[text](url)', 11)))
    expect(result.doc).toBe('')
    expect(result.head).toBe(0)
  })

  it('a caret inside an existing link replaces it with its text (E11)', () => {
    const result = applyTo('see [link](url) end', 8, undefined, insertLinkSpec(stateOf('see [link](url) end', 8)))
    expect(result.doc).toBe('see link end')
    expect(result.head).toBe(7)
  })

  it('a selection inside an existing link replaces it with its text (E11)', () => {
    const result = applyTo('[link](url)', 1, 5, insertLinkSpec(stateOf('[link](url)', 1, 5)))
    expect(result.doc).toBe('link')
    expect(result.head).toBe(4)
  })
})

describe('insertImage', () => {
  it('wraps a selection and selects the filename for typing', () => {
    const result = applyTo('sel', 0, 3, insertImageSpec(stateOf('sel', 0, 3)))
    expect(result.doc).toBe('![sel](image.png)')
    expect(result.head).toBe(16)
  })

  it('empty selection inserts ![alt](image.png) with alt selected', () => {
    const result = applyTo('', 0, undefined, insertImageSpec(stateOf('', 0)))
    expect(result.doc).toBe('![alt](image.png)')
    expect(result.head).toBe(5)
  })

  it('re-invoking on the untouched template deletes it (E12)', () => {
    const result = applyTo('![alt](image.png)', 17, undefined, insertImageSpec(stateOf('![alt](image.png)', 17)))
    expect(result.doc).toBe('')
    expect(result.head).toBe(0)
  })

  it('a caret inside an existing image replaces it with its alt text (E12)', () => {
    const result = applyTo('![alt](image.png)', 4, undefined, insertImageSpec(stateOf('![alt](image.png)', 4)))
    expect(result.doc).toBe('alt')
    expect(result.head).toBe(2)
  })
})

describe('insertTable', () => {
  it('inserts the 3×3 GFM template and puts the caret in the first body cell', () => {
    const result = applyTo('', 0, undefined, insertTableSpec(stateOf('', 0)))
    expect(result.doc).toBe('\n| Col 1 | Col 2 | Col 3 |\n| ----- | ----- | ----- |\n|  |  |  |\n|  |  |  |\n|  |  |  |\n')
    expect(result.head).toBe(55)
  })

  it('clamps rows/cols to at least 1', () => {
    const result = applyTo('', 0, undefined, insertTableSpec(stateOf('', 0), 0, 0))
    expect(result.doc).toBe('\n| Col 1 |\n| ----- |\n|  |\n')
  })
})

describe('insertHr', () => {
  it('inserts --- on its own line with blank lines around', () => {
    expect(applyTo('Hello world', 5, undefined, insertHrSpec(stateOf('Hello world', 5)))).toEqual({
      doc: 'Hello\n\n---\n\n world',
      head: 12,
    })
  })

  it('adds only the leading blank line when the caret is at the end of the doc', () => {
    expect(applyTo('x', 1, undefined, insertHrSpec(stateOf('x', 1)))).toEqual({ doc: 'x\n\n---', head: 6 })
  })
})

describe('insertFootnote', () => {
  it('inserts a [^1] marker at the caret and appends a definition', () => {
    expect(applyTo('', 0, undefined, insertFootnoteSpec(stateOf('', 0)))).toEqual({
      doc: '[^1]\n\n[^1]: ',
      head: 4,
    })
  })

  it('increments the number when [^1] already exists', () => {
    expect(applyTo('[^1]', 4, undefined, insertFootnoteSpec(stateOf('[^1]', 4)))).toEqual({
      doc: '[^1][^2]\n\n[^2]: ',
      head: 8,
    })
  })
})

describe('insertHeadingId', () => {
  it('appends {#custom-id} to a heading and puts the caret after it', () => {
    const result = applyTo('# Hello', 3, undefined, insertHeadingIdSpec(stateOf('# Hello', 3)))
    expect(result.doc).toBe('# Hello {#custom-id}')
    expect(result.head).toBe(20)
  })

  it('replaces an existing {#...} id', () => {
    const result = applyTo('# Hello {#foo}', 3, undefined, insertHeadingIdSpec(stateOf('# Hello {#foo}', 3)))
    expect(result.doc).toBe('# Hello {#custom-id}')
    expect(result.head).toBe(20)
  })

  it('leaves a non-heading line untouched', () => {
    expect(applyTo('Hello', 0, undefined, insertHeadingIdSpec(stateOf('Hello', 0)))).toEqual({
      doc: 'Hello',
      head: 0,
    })
  })
})

describe('insertDefList', () => {
  it('inserts Term\\n: Definition with Term selected', () => {
    const result = applyTo('', 0, undefined, insertDefListSpec(stateOf('', 0)))
    expect(result.doc).toBe('Term\n: Definition')
    expect(result.head).toBe(4)
  })
})

describe('sub/sup/highlight', () => {
  it('sub wraps, unwraps and handles empty selection', () => {
    expect(applyTo('b', 0, 1, toggleSubscriptSpec(stateOf('b', 0, 1)))).toEqual({ doc: '~b~', head: 2 })
    expect(applyTo('<sub>b</sub>', 0, 12, toggleSubscriptSpec(stateOf('<sub>b</sub>', 0, 12)))).toEqual({
      doc: 'b',
      head: 1,
    })
    expect(applyTo('ab', 1, undefined, toggleSubscriptSpec(stateOf('ab', 1)))).toEqual({ doc: 'a~~b', head: 2 })
  })

  it('sup wraps, unwraps and handles empty selection', () => {
    expect(applyTo('b', 0, 1, toggleSuperscriptSpec(stateOf('b', 0, 1)))).toEqual({ doc: '^b^', head: 2 })
    expect(applyTo('<sup>b</sup>', 0, 12, toggleSuperscriptSpec(stateOf('<sup>b</sup>', 0, 12)))).toEqual({
      doc: 'b',
      head: 1,
    })
    expect(applyTo('ab', 1, undefined, toggleSuperscriptSpec(stateOf('ab', 1)))).toEqual({ doc: 'a^^b', head: 2 })
  })

  it('highlight wraps, unwraps and handles empty selection', () => {
    expect(applyTo('b', 0, 1, toggleHighlightSpec(stateOf('b', 0, 1)))).toEqual({ doc: '==b==', head: 3 })
    expect(applyTo('==b==', 0, 5, toggleHighlightSpec(stateOf('==b==', 0, 5)))).toEqual({ doc: 'b', head: 1 })
    expect(applyTo('ab', 1, undefined, toggleHighlightSpec(stateOf('ab', 1)))).toEqual({ doc: 'a====b', head: 3 })
  })

  it('sub unwraps with an empty caret inside the tags (E18)', () => {
    expect(applyTo('a<sub>x</sub>b', 5, undefined, toggleSubscriptSpec(stateOf('a<sub>x</sub>b', 5)))).toEqual({
      doc: 'axb',
      head: 1,
    })
  })

  it('sup unwraps with an empty caret inside the tags (E19)', () => {
    expect(applyTo('a<sup>x</sup>b', 5, undefined, toggleSuperscriptSpec(stateOf('a<sup>x</sup>b', 5)))).toEqual({
      doc: 'axb',
      head: 1,
    })
  })

  it('highlight unwraps with an empty caret inside the pair (E20)', () => {
    expect(applyTo('a==hi==b', 4, undefined, toggleHighlightSpec(stateOf('a==hi==b', 4)))).toEqual({
      doc: 'ahib',
      head: 2,
    })
  })
})

describe('insertText', () => {
  it('replaces the selection and puts the caret after', () => {
    expect(applyTo('hello world', 0, 5, insertTextSpec(stateOf('hello world', 0, 5), 'X'))).toEqual({
      doc: 'X world',
      head: 1,
    })
  })

  it('inserts at the caret when the selection is empty', () => {
    expect(applyTo('ab', 1, undefined, insertTextSpec(stateOf('ab', 1), 'X'))).toEqual({ doc: 'aXb', head: 2 })
  })
})

describe('continueList', () => {
  it('on a non-empty - item inserts a newline + the same marker', () => {
    expect(continueListSpec(stateOf('- item', 6))).toEqual({
      changes: { from: 6, to: 6, insert: '\n- ' },
      selection: { anchor: 9 },
    })
  })

  it('on an empty - item removes the marker (line becomes empty)', () => {
    expect(continueListSpec(stateOf('- ', 2))).toEqual({
      changes: { from: 0, to: 2, insert: '' },
      selection: { anchor: 0 },
    })
  })

  it('on a plain paragraph line returns null', () => {
    expect(continueListSpec(stateOf('hello', 5))).toBeNull()
  })

  it('ordered items continue the sequence number', () => {
    expect(continueListSpec(stateOf('1. item', 7))).toEqual({
      changes: { from: 7, to: 7, insert: '\n2. ' },
      selection: { anchor: 11 },
    })
  })

  it('task items keep the - [ ] marker', () => {
    expect(continueListSpec(stateOf('- [ ] item', 10))).toEqual({
      changes: { from: 10, to: 10, insert: '\n- [ ] ' },
      selection: { anchor: 17 },
    })
  })

  it('task items keep the -[] marker form (Other #4)', () => {
    expect(continueListSpec(stateOf('-[] item', 7))).toEqual({
      changes: { from: 8, to: 8, insert: '\n-[] ' },
      selection: { anchor: 13 },
    })
  })

  it('an unordered * item keeps its own marker style', () => {
    expect(continueListSpec(stateOf('* item', 6))).toEqual({
      changes: { from: 6, to: 6, insert: '\n* ' },
      selection: { anchor: 9 },
    })
  })
})

describe('markdownListKeymap', () => {
  it('returns a non-null extension', () => {
    const ext = markdownListKeymap()
    expect(ext).toBeTruthy()
  })
})

describe('spoiler', () => {
  it('wraps a selection', () => {
    expect(applyTo('secret', 0, 6, toggleSpoilerSpec(stateOf('secret', 0, 6)))).toEqual({ doc: '||secret||', head: 8 })
  })

  it('unwraps when already wrapped', () => {
    expect(applyTo('||secret||', 0, 10, toggleSpoilerSpec(stateOf('||secret||', 0, 10)))).toEqual({ doc: 'secret', head: 6 })
  })

  it('empty selection inserts |||| with the caret between the pairs', () => {
    expect(applyTo('text', 2, undefined, toggleSpoilerSpec(stateOf('text', 2)))).toEqual({ doc: 'te||||xt', head: 4 })
  })
})

describe('dropdown', () => {
  it('inserts a dropdown block template', () => {
    const result = applyTo('content', 0, undefined, insertDropdownSpec(stateOf('content', 0)))
    expect(result.doc).toBe('>>> Title\n\n>>>content')
    expect(result.head).toBe(9)
  })

  it('inserts with selected title', () => {
    const result = applyTo('content', 0, undefined, insertDropdownSpec(stateOf('content', 0)))
    expect(result.doc).toContain('>>> Title')
  })
})

describe('graph inserts', () => {
  it('inserts a pie starter with the title selected', () => {
    const result = applyTo('content', 0, undefined, insertPieGraphSpec(stateOf('content', 0)))
    expect(result.doc).toContain('%% pie "Title" (Apples, 30) (Bananas, 45) %%')
  })

  it('inserts a bar starter with the title selected', () => {
    const result = applyTo('content', 0, undefined, insertBarGraphSpec(stateOf('content', 0)))
    expect(result.doc).toContain('%% bar "Title" Units (Jan, 120) (Feb, 200) %%')
  })

  it('inserts a line starter with the title selected', () => {
    const result = applyTo('content', 0, undefined, insertLineGraphSpec(stateOf('content', 0)))
    expect(result.doc).toContain('%% line "Title" (Week, Mon, Tue) (Hits, 0, 100) (SiteA, 120, 200) %%')
  })

  it('graph alias inserts the bar starter', () => {
    const viaAlias = applyTo('content', 0, undefined, FORMATTING_COMMANDS['graph'](stateOf('content', 0)))
    const viaBar = applyTo('content', 0, undefined, insertBarGraphSpec(stateOf('content', 0)))
    expect(viaAlias.doc).toBe(viaBar.doc)
  })
})

describe('FORMATTING_COMMANDS', () => {
  it('exposes every locked action id', () => {
    const expected = [
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'header-cycle',
      'header-0',
      'header-1',
      'header-2',
      'header-3',
      'header-4',
      'header-5',
      'header-6',
      'list',
      'list-unordered',
      'list-ordered',
      'list-task',
      'blockquote',
      'inline-code',
      'code-block',
      'link',
      'image',
      'table',
      'hr',
      'footnote',
      'task-list',
      'heading-id',
      'def-list',
      'sub',
      'sup',
      'highlight',
      'spoiler',
      'dropdown',
      'pie-graph',
      'bar-graph',
      'line-graph',
      'graph',
    ]
    for (const id of expected) {
      expect(typeof FORMATTING_COMMANDS[id]).toBe('function')
    }
    expect(Object.keys(FORMATTING_COMMANDS).sort()).toEqual(expected.slice().sort())
  })

  it('each entry is a function of state returning a TransactionSpec', () => {
    for (const id of Object.keys(FORMATTING_COMMANDS)) {
      const spec = FORMATTING_COMMANDS[id](stateOf('x', 0))
      expect(spec).toBeTruthy()
    }
  })
})
