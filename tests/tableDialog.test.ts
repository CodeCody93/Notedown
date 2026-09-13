// @vitest-environment jsdom
// Table builder modal tests (src/app/tableDialog.ts): Insert/Cancel settle the
// promise, balanced nested `<table>` HTML typed into a cell passes through
// raw (unbalanced tags fail validation), preload opts prefill the grid from
// pipe or HTML tables, output is always single-line HTML, each grid row
// carries its own header toggle, and the generated source sits collapsed in
// a closed <details>. Uses real timers; the dialog settles its promise
// synchronously so awaiting the openTableBuilder() promise is enough.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  openTableBuilder,
  isTableBuilderOpen,
  TABLE_MODAL_ROOT_ID,
  serializeHtmlTable,
  parseGfmTable,
  parseHtmlTable,
  findBalancedTableSpans,
} from '../src/app/tableDialog'

function insertButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.table-confirm')
}

function cancelButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.table-cancel')
}

function sourceText(): string {
  return document.querySelector<HTMLElement>('.table-source code')?.textContent ?? ''
}

const tick = (): Promise<void> => new Promise<void>((resolve) => {
  setTimeout(resolve, 0)
})

beforeEach(() => {
  // Mirror index.html so the dialog mounts into its dedicated root.
  if (document.getElementById(TABLE_MODAL_ROOT_ID) === null) {
    const root = document.createElement('div')
    root.id = TABLE_MODAL_ROOT_ID
    document.body.appendChild(root)
  }
})

afterEach(async () => {
  // Safety net: settle any dialog a test left open. The DOM itself is kept so
  // the next open() reuses it (open() resets state and re-renders).
  if (isTableBuilderOpen()) {
    cancelButton()?.click()
    await tick()
  }
})

describe('table builder', () => {
  it('Insert resolves the default table as single-line HTML and closes', async () => {
    const promise = openTableBuilder()
    expect(isTableBuilderOpen()).toBe(true)
    expect(insertButton()?.disabled).toBe(false)

    insertButton()?.click()
    const result = await promise
    expect(result?.text ?? '').toContain('<table>')
    expect(result?.text ?? '').toContain('Col 1')
    expect(result?.text ?? '').not.toContain('\n')
    expect(result?.startLine).toBeNull()
    expect(result?.endLine).toBeNull()
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('Cancel resolves null and closes the builder', async () => {
    const promise = openTableBuilder()
    expect(isTableBuilderOpen()).toBe(true)

    cancelButton()?.click()
    await expect(promise).resolves.toBeNull()
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('balanced nested table markup in a cell passes through raw', async () => {
    const promise = openTableBuilder()
    const cell = document.querySelector<HTMLInputElement>('input[data-k="cell"][data-r="0"][data-c="0"]')
    expect(cell).toBeTruthy()

    cell!.value = '<table><tr><td>oops</td></tr></table>'
    cell!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(insertButton()?.disabled).toBe(false)
    expect(document.querySelector<HTMLElement>('.table-errors')?.hidden).toBe(true)

    insertButton()?.click()
    const result = await promise
    expect(result?.text ?? '').toContain('<table><tr><td>oops</td></tr></table>')
    expect(result?.text ?? '').not.toContain('&lt;table&gt;')
    expect(result?.text ?? '').not.toContain('\n')
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('balanced nested cell passes validation with raw nested output kept single-line', async () => {
    const promise = openTableBuilder()
    const cell = document.querySelector<HTMLInputElement>('input[data-k="cell"][data-r="1"][data-c="1"]')
    expect(cell).toBeTruthy()

    cell!.value = 'a <table><tr><td>nested</td></tr></table> b'
    cell!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(insertButton()?.disabled).toBe(false)

    insertButton()?.click()
    const result = await promise
    expect(result?.text ?? '').toContain('<table><tr><td>nested</td></tr></table>')
    expect(result?.text ?? '').toContain('a ')
    expect(result?.text ?? '').not.toContain('\n')
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('unbalanced table tags disable Insert with an Unbalanced error and mark the cell', async () => {
    const promise = openTableBuilder()
    const cell = document.querySelector<HTMLInputElement>('input[data-k="cell"][data-r="1"][data-c="0"]')
    expect(cell).toBeTruthy()

    cell!.value = '<table><tr><td>oops'
    cell!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(insertButton()?.disabled).toBe(true)
    const errors = document.querySelector<HTMLElement>('.table-errors')
    expect(errors?.hidden).toBe(false)
    expect(errors?.textContent ?? '').toContain('Unbalanced')
    expect(errors?.textContent ?? '').toContain('row 2 column 1')
    expect(cell!.classList.contains('table-cell-error')).toBe(true)

    cancelButton()?.click()
    await expect(promise).resolves.toBeNull()
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('unbalanced header cell reports a header column label', async () => {
    const promise = openTableBuilder()
    const cell = document.querySelector<HTMLInputElement>('input[data-k="cell"][data-r="0"][data-c="1"]')
    expect(cell).toBeTruthy()

    cell!.value = '<TABLE><tr><td>x</td></tr>'
    cell!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(insertButton()?.disabled).toBe(true)
    expect(document.querySelector<HTMLElement>('.table-errors')?.textContent ?? '').toContain(
      'header column 2'
    )

    cancelButton()?.click()
    await expect(promise).resolves.toBeNull()
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('preload pipe opts prefill the grid and settle the replaced range', async () => {
    const docText = ['# Doc', '', '| Name | Age |', '| --- | --- |', '| Ada | 36 |', '', 'more'].join('\n')
    const promise = openTableBuilder({ docText, caretLine: 5 })
    expect(document.querySelector<HTMLElement>('#table-modal-title')?.textContent).toBe('Edit table')
    const firstCell = document.querySelector<HTMLInputElement>('input[data-k="cell"][data-r="0"][data-c="0"]')
    expect(firstCell?.value).toBe('Name')
    // The converted header row is marked via its per-row toggle.
    const headToggles = document.querySelectorAll<HTMLInputElement>('.table-row-head')
    expect(headToggles.length).toBe(2)
    expect(headToggles[0]?.checked).toBe(true)
    expect(headToggles[1]?.checked).toBe(false)

    insertButton()?.click()
    const result = await promise
    expect(result?.text ?? '').toContain('<th>Name</th>')
    expect(result?.text ?? '').toContain('Ada')
    expect(result?.startLine).toBe(3)
    expect(result?.endLine).toBe(5)
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('has no Full HTML toggle or alignment UI — output is always single-line HTML', async () => {
    const promise = openTableBuilder()
    expect(document.querySelector<HTMLInputElement>('input[data-k="html"]')).toBeNull()
    expect(document.querySelector('select[data-k="align"]')).toBeNull()

    insertButton()?.click()
    const result = await promise
    expect(result?.text ?? '').toContain('<table>')
    expect(result?.text ?? '').not.toContain('\n')
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('per-row header toggles move rows between thead and tbody without losing focus', async () => {
    const promise = openTableBuilder()
    const toggles = document.querySelectorAll<HTMLInputElement>('.table-row-head')
    expect(toggles.length).toBe(3)
    expect(toggles[0]?.checked).toBe(true)
    expect(toggles[1]?.checked).toBe(false)
    expect(toggles[0]?.getAttribute('aria-label')).toBe('Row 1 header')

    // Unmark the first row: thead disappears, its cells become <td>.
    toggles[0]!.checked = false
    toggles[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(document.activeElement).toBe(toggles[0])
    expect(sourceText()).not.toContain('<thead>')
    expect(sourceText()).toContain('<td>Col 1</td>')

    // Mark the second (empty) row: its cells render as <th> inside <tbody>.
    toggles[1]!.checked = true
    toggles[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(document.activeElement).toBe(toggles[1])
    expect(sourceText()).toContain('<th></th>')
    expect(insertButton()?.disabled).toBe(false)

    cancelButton()?.click()
    await expect(promise).resolves.toBeNull()
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('generated source is collapsed in a closed <details> below an always-visible preview', async () => {
    const promise = openTableBuilder()
    const details = document.querySelector<HTMLDetailsElement>('details.table-source')
    expect(details).toBeTruthy()
    expect(details!.open).toBe(false)
    expect(details!.querySelector('summary')?.textContent).toBe('Generated source')
    expect(details!.querySelector('code')?.textContent).toContain('<table>')
    // The rendered preview stays visible above the collapsed source.
    expect(document.querySelector<HTMLElement>('.table-preview')?.innerHTML).toContain('<table')

    cancelButton()?.click()
    await expect(promise).resolves.toBeNull()
    expect(isTableBuilderOpen()).toBe(false)
  })

  it('prefers an HTML table block over a pipe block when the caret is inside the HTML', async () => {
    const docText = [
      '| P | Q |',
      '| --- | --- |',
      '| x | y |',
      '',
      '<table>',
      '<tr><th>H</th></tr><tr><td>V</td></tr>',
      '</table>',
    ].join('\n')
    const promise = openTableBuilder({ docText, caretLine: 6 })
    expect(document.querySelector<HTMLElement>('#table-modal-title')?.textContent).toBe('Edit table')
    const firstCell = document.querySelector<HTMLInputElement>('input[data-k="cell"][data-r="0"][data-c="0"]')
    expect(firstCell?.value).toBe('H')

    insertButton()?.click()
    const result = await promise
    expect(result?.text ?? '').toContain('<th>H</th>')
    expect(result?.text ?? '').toContain('<td>V</td>')
    expect(result?.startLine).toBe(5)
    expect(result?.endLine).toBe(7)
    expect(isTableBuilderOpen()).toBe(false)
  })
})

describe('serializeHtmlTable', () => {
  it('puts leading header rows in thead and keeps marked rows as th inside tbody', () => {
    const html = serializeHtmlTable({
      rows: [
        ['H1', 'H2'],
        ['a', 'b'],
        ['c', 'd'],
      ],
      headerRows: [true, false, true],
    })
    expect(html).toBe(
      '<table><thead><tr><th>H1</th><th>H2</th></tr></thead>' +
        '<tbody><tr><td>a</td><td>b</td></tr><tr><th>c</th><th>d</th></tr></tbody></table>'
    )
  })

  it('escapes all cell text and stays single-line', () => {
    const html = serializeHtmlTable({ rows: [['<i>x</i>&"q"\nline']], headerRows: [false] })
    expect(html).not.toContain('\n')
    expect(html).toContain('&lt;i&gt;x&lt;/i&gt;&amp;&quot;q&quot;<br>line')
  })

  it('passes balanced nested tables through raw while escaping surrounding text', () => {
    const html = serializeHtmlTable({
      rows: [['a <table><tr><td>n</td></tr></table> b']],
      headerRows: [false],
    })
    expect(html).not.toContain('\n')
    expect(html).toContain('<table><tr><td>n</td></tr></table>')
    expect(html).toContain('a ')
  })

  it('strips newlines from nested spans so output stays single-line', () => {
    const html = serializeHtmlTable({
      rows: [['<table>\n<tr><td>n</td></tr>\n</table>']],
      headerRows: [false],
    })
    expect(html).not.toContain('\n')
    expect(html).toContain('<table><tr><td>n</td></tr></table>')
  })

  it('escapes unbalanced table tags instead of passing them through', () => {
    const html = serializeHtmlTable({ rows: [['<table><tr><td>oops']], headerRows: [false] })
    expect(html).toContain('&lt;table&gt;')
  })
})

describe('parseHtmlTable', () => {
  it('preserves nested table HTML in cell source and keeps document row order with thead detection', () => {
    const html =
      '<table><thead><tr><th>H1</th><th>H2</th></tr></thead>' +
      '<tbody><tr><td>a</td><td><table><tr><td>nested</td></tr></table></td></tr>' +
      '<tr><td>c</td><td>d</td></tr></tbody></table>'
    const model = parseHtmlTable(html)
    // Document order: thead row first, then tbody rows in order.
    expect(model?.rows.length).toBe(3)
    expect(model?.rows[0]).toEqual(['H1', 'H2'])
    expect(model?.rows[1]?.[0]).toBe('a')
    expect(model?.rows[2]).toEqual(['c', 'd'])
    expect(model?.headerRows).toEqual([true, false, false])
    // Nested table HTML survives raw (parser may inject <tbody>) and single-line.
    const nested = model?.rows[1]?.[1] ?? ''
    expect(nested).toContain('<table')
    expect(nested).toContain('nested')
    expect(nested).not.toContain('\n')
  })

  it('strips newlines from nested cell HTML and maps br to newlines', () => {
    const html =
      '<table><tr><td><table>\n<tr><td>x</td></tr>\n</table></td></tr>' +
      '<tr><td>a<br>b</td></tr></table>'
    const model = parseHtmlTable(html)
    const nested = model?.rows[0]?.[0] ?? ''
    expect(nested).toContain('<table')
    expect(nested).toContain('x')
    expect(nested).not.toContain('\n')
    expect(model?.rows[1]?.[0]).toBe('a\nb')
    expect(model?.headerRows).toEqual([false, false])
  })

  it('returns null when there are no rows', () => {
    expect(parseHtmlTable('<div>no table</div>')).toBeNull()
    expect(parseHtmlTable('<table></table>')).toBeNull()
    expect(parseHtmlTable('')).toBeNull()
  })
})

describe('parseGfmTable', () => {
  it('converts a pipe table to rows with the header row marked', () => {
    expect(parseGfmTable('| Name | Age |\n| --- | --- |\n| Ada | 36 |')).toEqual({
      rows: [
        ['Name', 'Age'],
        ['Ada', '36'],
      ],
      headerRows: [true, false],
    })
  })

  it('returns null for non-tables', () => {
    expect(parseGfmTable('| A |\n| xxx |\n| 1 |')).toBeNull()
    expect(parseGfmTable('| A |')).toBeNull()
  })
})

describe('findBalancedTableSpans', () => {
  it('returns one outer span for nested tables (never truncated at the inner close)', () => {
    const inner = '<table><tr><td>n</td></tr></table>'
    const value = `a ${inner} b`
    const spans = findBalancedTableSpans(value)
    expect(spans).toHaveLength(1)
    expect(value.slice(spans[0].start, spans[0].end)).toBe(inner)
  })

  it('returns sibling spans separately and nothing for unbalanced input', () => {
    const value = '<table><tr><td>a</td></tr></table> x <table><tr><td>b</td></tr></table>'
    expect(findBalancedTableSpans(value)).toHaveLength(2)
    expect(findBalancedTableSpans('plain text')).toHaveLength(0)
    expect(findBalancedTableSpans('<table><tr><td>oops')).toHaveLength(0)
    expect(findBalancedTableSpans('x </table> y')).toHaveLength(0)
  })
})

describe('model preload (inner-table editing)', () => {
  it('openTableBuilder({model}) prefills the grid and resolves null lines', async () => {
    const promise = openTableBuilder({
      model: { rows: [['H'], ['v']], headerRows: [true, false] },
    })
    expect(document.querySelector<HTMLElement>('#table-modal-title')?.textContent).toBe('Edit table')
    const rowHead = document.querySelector<HTMLInputElement>('input[data-k="rowhead"][data-r="0"]')
    expect(rowHead?.checked).toBe(true)

    insertButton()?.click()
    const result = await promise
    expect(result?.text ?? '').toContain('<th>H</th>')
    expect(result?.text ?? '').toContain('<td>v</td>')
    expect(result?.startLine).toBeNull()
    expect(result?.endLine).toBeNull()
  })

  it('nested models round-trip: inner table HTML survives serialize', () => {
    const outer =
      '<table><tbody><tr><td>a</td><td><table><tbody><tr><td>n1</td></tr></tbody></table></td></tr></tbody></table>'
    const model = parseHtmlTable(outer)
    expect(model).not.toBeNull()
    const html = serializeHtmlTable(model!)
    expect(html).toContain('<td>a</td>')
    expect(html).toContain('n1')
    expect(html).not.toContain('&lt;table')
    expect(html).not.toContain('\n')
  })
})
