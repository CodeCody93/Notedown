// @vitest-environment jsdom
// Graph builder modal tests (src/app/graphDialog.ts): Insert/Cancel settle the
// promise, validation gates the Insert button, and each tab composes a tag
// that re-parses via parseGraphTag. Uses real timers; the dialog settles its
// promise synchronously so awaiting the openGraphBuilder() promise is enough.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openGraphBuilder, isGraphBuilderOpen, GRAPH_MODAL_ROOT_ID } from '../src/app/graphDialog'
import { parseGraphTag } from '../src/app/graph'

/** Strip the outer `%% … %%` so the inner source can go through parseGraphTag. */
function strip(tag: string): string {
  return tag.slice(2, -2).trim()
}

function insertButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.graph-confirm')
}

function cancelButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.graph-cancel')
}

function tabButton(tab: 'pie' | 'bar' | 'line'): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button.graph-tab[data-tab="${tab}"]`)
}

const tick = (): Promise<void> => new Promise<void>((resolve) => {
  setTimeout(resolve, 0)
})

beforeEach(() => {
  // Mirror index.html so the dialog mounts into its dedicated root.
  if (document.getElementById(GRAPH_MODAL_ROOT_ID) === null) {
    const root = document.createElement('div')
    root.id = GRAPH_MODAL_ROOT_ID
    document.body.appendChild(root)
  }
})

afterEach(async () => {
  // Safety net: settle any dialog a test left open. The DOM itself is kept so
  // the next open() reuses it (open() resets state and re-renders).
  if (isGraphBuilderOpen()) {
    cancelButton()?.click()
    await tick()
  }
})

describe('graph builder', () => {
  it('Insert resolves the default pie tag', async () => {
    const promise = openGraphBuilder()
    expect(isGraphBuilderOpen()).toBe(true)
    expect(insertButton()?.disabled).toBe(false)

    insertButton()?.click()
    const tag = await promise
    expect(tag ?? '').toMatch(/%% pie/)
    expect(tag ?? '').toContain('Apples')
    expect(parseGraphTag(strip(tag ?? '')).ok).toBe(true)
    expect(isGraphBuilderOpen()).toBe(false)
  })

  it('Cancel resolves null and closes the builder', async () => {
    const promise = openGraphBuilder()
    expect(isGraphBuilderOpen()).toBe(true)

    cancelButton()?.click()
    await expect(promise).resolves.toBeNull()
    expect(isGraphBuilderOpen()).toBe(false)
  })

  it('an invalid cell disables Insert with an error; fixing it re-enables', async () => {
    const promise = openGraphBuilder()
    const valueInput = document.querySelector<HTMLInputElement>('input[data-k="rowValue"][data-kind="pie"]')
    expect(valueInput).toBeTruthy()

    valueInput!.value = 'abc'
    valueInput!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(insertButton()?.disabled).toBe(true)
    const errors = document.querySelector<HTMLElement>('.graph-errors')
    expect(errors?.hidden).toBe(false)
    expect(errors?.textContent).toContain('Invalid value')

    valueInput!.value = '30'
    valueInput!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(insertButton()?.disabled).toBe(false)
    expect(document.querySelector<HTMLElement>('.graph-errors')?.hidden).toBe(true)

    cancelButton()?.click()
    await expect(promise).resolves.toBeNull()
    expect(isGraphBuilderOpen()).toBe(false)
  })

  it('Bar tab generates a bar tag that re-parses', async () => {
    const promise = openGraphBuilder()
    tabButton('bar')?.click()
    expect(tabButton('bar')?.getAttribute('aria-selected')).toBe('true')
    expect(insertButton()?.disabled).toBe(false)

    insertButton()?.click()
    const tag = await promise
    expect(tag ?? '').toMatch(/%% bar/)
    expect(parseGraphTag(strip(tag ?? '')).ok).toBe(true)
    expect(isGraphBuilderOpen()).toBe(false)
  })

  it('Line tab generates a line tag with series SiteA that re-parses', async () => {
    const promise = openGraphBuilder()
    tabButton('line')?.click()
    expect(tabButton('line')?.getAttribute('aria-selected')).toBe('true')
    expect(insertButton()?.disabled).toBe(false)

    insertButton()?.click()
    const tag = await promise
    expect(tag ?? '').toMatch(/%% line/)
    expect(tag ?? '').toContain('SiteA')
    const parsed = parseGraphTag(strip(tag ?? ''))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.spec.points.some((p) => p.series === 'SiteA')).toBe(true)
    }
    expect(isGraphBuilderOpen()).toBe(false)
  })
})
