/**
 * Theme handling for the embeddable editor.
 *
 * The packaged stylesheet (`src/styles/embed-theme.css`) exposes light tokens on
 * `.notedown-editor-root` and switches to dark tokens through
 * `[data-theme="dark"]`. This module owns that attribute:
 *
 * - `light` / `dark` — set `data-theme` directly.
 * - `system` — resolve through `matchMedia('(prefers-color-scheme: dark)')` and
 *   keep the attribute in sync while the OS scheme changes.
 * - `inherit` — remove `data-theme` entirely (the host page supplies the
 *   variables/attribute) and never subscribe.
 */

/** Theme names accepted by the public embed API. */
export type EmbedTheme = 'light' | 'dark' | 'system' | 'inherit'

/** Small controller returned by {@link createEmbedTheme}. */
export interface EmbedThemeController {
  /** Apply a theme (and replace any active system-scheme subscription). */
  apply(theme: EmbedTheme): void
  /** Theme most recently applied. */
  get(): EmbedTheme
  /** Remove the system-scheme listener. Safe to call repeatedly. */
  destroy(): void
}

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

/**
 * Applies `initial` immediately and returns a handle for later changes and
 * cleanup. `matchMedia` is optional (jsdom/older webviews); without it `system`
 * resolves to light and simply never updates.
 */
export function createEmbedTheme(root: HTMLElement, initial: EmbedTheme): EmbedThemeController {
  const media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DARK_SCHEME_QUERY)
      : null

  let current: EmbedTheme = initial
  let listener: ((event: MediaQueryListEvent) => void) | null = null

  const removeListener = (): void => {
    if (media === null || listener === null) return
    if (typeof media.removeEventListener === 'function') {
      media.removeEventListener('change', listener)
    } else {
      media.removeListener(listener)
    }
    listener = null
  }

  const apply = (theme: EmbedTheme): void => {
    removeListener()
    current = theme

    if (theme === 'inherit') {
      root.removeAttribute('data-theme')
      return
    }

    if (theme === 'system') {
      root.setAttribute('data-theme', media !== null && media.matches ? 'dark' : 'light')
      if (media !== null) {
        listener = (event: MediaQueryListEvent): void => {
          if (current !== 'system') return
          root.setAttribute('data-theme', event.matches ? 'dark' : 'light')
        }
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', listener)
        } else {
          media.addListener(listener)
        }
      }
      return
    }

    root.setAttribute('data-theme', theme)
  }

  apply(initial)

  return {
    apply,
    get: (): EmbedTheme => current,
    destroy: (): void => {
      removeListener()
    },
  }
}
