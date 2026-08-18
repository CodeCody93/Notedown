/**
 * Preview mode (PLAN §14): a full-document rendered view of the current doc,
 * toggled from the View menu / eye icon / Ctrl+Shift+P. Reuses export.ts's
 * markdown-it pipeline (renderMarkdown is DOMPurify-sanitized), injects the
 * result into the static #preview-pane, and keeps the two views in sync with a
 * ~150ms debounce plus a "Rendering…" stale indicator while a render is pending.
 *
 * External links are opened with the OS default handler via FileIO.openExternal
 * (never window.open); relative links are resolved against the document's
 * directory. Local image srcs are exposed to the webview via
 * FileIO.exposeImage (data URLs in Tauri; browser dev mode cannot read sibling
 * files and leaves them as-is).
 *
 * Module-level state, no classes. Deliberately dependency-free of CM6 and of
 * app.ts (app.ts imports this module, never the reverse).
 */
import { HLJS_CSS_DARK, HLJS_CSS_LIGHT, MARKDOWN_BODY_CSS, renderMarkdown } from './export'
import { appState } from './state'
import type { AppState } from './state'
import type { FileIO } from '../platform/types'

const PREVIEW_DEBOUNCE_MS = 150

let io: FileIO
let wired = false // subscription installed at most once (wirePreview is re-callable to swap io)
let renderedContent: string | null = null // null = never rendered → always render on entry
let lastTheme: string | null = null // last effective theme ('dark'|'light') synced into the style element
let staleTimer: number | null = null
let appliedView: 'edit' | 'preview' | null = null

function byId(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Missing element #${id}`)
  return node
}

/** Effective theme from the <html data-theme> attribute (set by settings.applyTheme). */
function currentTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/**
 * The shared <style id="preview-style"> element: MARKDOWN_BODY_CSS typography
 * plus the highlight.js theme matching the current effective theme. Created
 * once; syncTheme() later rewrites just the hljs portion by rebuilding the
 * whole textContent.
 */
function ensureStyleElement(): void {
  if (document.getElementById('preview-style') !== null) return
  const style = document.createElement('style')
  style.id = 'preview-style'
  style.textContent = MARKDOWN_BODY_CSS + (currentTheme() === 'dark' ? HLJS_CSS_DARK : HLJS_CSS_LIGHT)
  document.head.appendChild(style)
}

function syncTheme(): void {
  const theme = currentTheme()
  if (theme === lastTheme) return
  ensureStyleElement()
  const style = document.getElementById('preview-style')
  if (style !== null) {
    style.textContent = MARKDOWN_BODY_CSS + (theme === 'dark' ? HLJS_CSS_DARK : HLJS_CSS_LIGHT)
  }
  lastTheme = theme
}

/** Show/hide the panes according to appState.view. Both elements always exist. */
function applyView(): void {
  const view = appState.get().view
  byId('preview-pane').hidden = view !== 'preview'
  byId('editor').hidden = view === 'preview'
}

/**
 * Debounce a re-render: show the stale indicator and arm the timer. A pending
 * timer is replaced so only the latest content is ever rendered.
 */
function scheduleRender(): void {
  byId('preview-stale').hidden = false
  if (staleTimer !== null) {
    clearTimeout(staleTimer)
  }
  staleTimer = window.setTimeout(() => {
    staleTimer = null
    renderNow()
  }, PREVIEW_DEBOUNCE_MS)
}

/** Render the current doc content into #preview-body, then resolve images + theme. */
function renderNow(): void {
  if (staleTimer !== null) {
    clearTimeout(staleTimer)
    staleTimer = null
  }
  const content = appState.get().doc.content
  renderedContent = content
  byId('preview-body').innerHTML = renderMarkdown(content)
  byId('preview-stale').hidden = true
  void resolveImages()
  syncTheme()
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

/**
 * Open an href in the OS default handler. Blocks javascript:/data:/vbscript:
 * schemes outright (defense in depth — DOMPurify already strips them); absolute
 * http(s)/mailto links go straight to io.openExternal; relative links resolve
 * against the doc directory (the OS opener handles local paths). Never throws.
 */
async function openExternalHref(href: string): Promise<void> {
  const scheme = (href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] ?? '').toLowerCase()
  if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript') {
    console.warn(`Blocked unsafe link scheme: ${scheme}:`)
    return
  }
  try {
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      await io.openExternal(href)
      return
    }
    const docPath = appState.get().doc.path
    if (docPath === null) {
      console.warn(`Cannot open relative link "${href}": document has no path`)
      return
    }
    await io.openExternal(resolveAgainstDocDir(docPath, href))
  } catch (err) {
    console.warn('Failed to open link', err)
  }
}

/**
 * One delegated click listener on #preview-body. In-page anchors (#…) keep
 * their default behavior (no-op in a standalone pane); everything else is
 * intercepted and opened externally.
 */
function onPreviewBodyClick(ev: MouseEvent): void {
  const target = ev.target
  if (!(target instanceof Element)) return
  const anchor = target.closest('a')
  if (anchor === null) return
  const href = anchor.getAttribute('href')
  if (href === null || href === '') return
  if (href.startsWith('#')) return
  ev.preventDefault()
  void openExternalHref(href)
}

/**
 * Resolve relative image srcs to renderable URLs (data URLs in Tauri). Runs
 * AFTER innerHTML assignment so the <img> elements exist. Relative here means:
 * not http(s), data:, blob:, asset:, '/' (absolute) or '#' (fragment). When the
 * doc has no path — or exposeImage rejects (browser dev mode) — the src is left
 * as-is.
 */
async function resolveImages(): Promise<void> {
  const docPath = appState.get().doc.path
  if (docPath === null) return
  const imgs = byId('preview-body').querySelectorAll('img')
  for (const img of imgs) {
    const src = img.getAttribute('src')
    if (src === null || src === '') continue
    if (/^(https?:|data:|blob:|asset:|\/|#)/i.test(src)) continue
    try {
      img.src = await io.exposeImage(resolveAgainstDocDir(docPath, src))
    } catch {
      // Leave as-is (browser dev mode cannot read sibling files).
    }
  }
}

/**
 * Single appState subscriber installed by wirePreview. Re-applies the pane
 * visibility on view changes; schedules a debounced render while in preview
 * whenever the content differs from what was last rendered; drops the cache
 * when leaving preview. A theme SETTING change re-renders immediately (theme
 * switches are rare — no debounce). The 'system' setting resolves to the
 * effective theme via syncTheme on the next render, so it must not trigger the
 * immediate path (it would re-render on every keystroke).
 */
function onStateChange(s: AppState): void {
  if (s.view !== appliedView) {
    appliedView = s.view
    applyView()
  }
  if (s.view === 'preview') {
    if (renderedContent !== s.doc.content) {
      scheduleRender()
    }
  } else {
    renderedContent = null
  }
  if (s.settings.theme !== 'system' && s.settings.theme !== lastTheme && s.view === 'preview') {
    renderNow()
  }
}

/**
 * Attach preview mode to the app. Sets the FileIO instance; the first call
 * installs the single appState subscription, the shared style element and the
 * delegated link listener. Re-calls only swap the FileIO (idempotent: the
 * listener registration is deduped by the DOM, the style element and
 * subscription are created at most once) and re-apply the current view.
 */
export function wirePreview(fileIo: FileIO): void {
  io = fileIo
  ensureStyleElement()
  byId('preview-body').addEventListener('click', onPreviewBodyClick)
  if (!wired) {
    wired = true
    appState.subscribe(onStateChange)
  }
  applyView()
}

/** Single state-driven path to switch views; the subscriber does the DOM work. */
export function setView(next: 'edit' | 'preview'): void {
  appState.set({ view: next })
}

/** Flip between edit and preview. */
export function togglePreview(): void {
  setView(appState.get().view === 'edit' ? 'preview' : 'edit')
}