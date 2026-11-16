/**
 * Update checks (GitHub releases, not `tauri-plugin-updater`): look up the
 * latest published release, compare its semver tag against the bundled app
 * version, and pick the matching platform installer asset. The app never
 * downloads or installs anything itself — the UI opens a validated
 * `https://github.com/CodeCody93/Notedown/releases/...` URL through the
 * platform layer (OS installer, with release-page fallback).
 *
 * Dependency-free (only package.json) and DOM-free apart from the
 * `navigator.userAgent` sniff, so it is unit-testable in Node. Module-level
 * state, no classes: at most one in-flight check, a single observable snapshot
 * for the UI, and no auth token (public GitHub API).
 */
import pkg from '../../package.json'

export type UpdatePlatform = 'windows' | 'macos' | 'linux' | 'other'

export interface ReleaseAsset {
  name: string
  browserDownloadUrl: string
}

export interface LatestRelease {
  tagName: string
  htmlUrl: string
  name: string
  publishedAt: string | null
  assets: ReleaseAsset[]
}

export interface UpdateDownload {
  fileName: string
  url: string
  label: string
}

export type UpdateErrorKind = 'network' | 'timeout' | 'rate-limit' | 'not-found' | 'http' | 'invalid-response'

export type UpdateResult =
  | {
      status: 'up-to-date'
      currentVersion: string
      latestVersion: string
      releaseUrl: string
      checkedAt: number
    }
  | {
      status: 'available'
      currentVersion: string
      latestVersion: string
      releaseUrl: string
      download: UpdateDownload | null
      checkedAt: number
    }
  | {
      status: 'error'
      kind: UpdateErrorKind
      message: string
      releaseUrl: string
      checkedAt: number
    }

export interface UpdateState {
  phase: 'idle' | 'checking' | 'done'
  result: UpdateResult | null
  lastCheckedAt: number | null
}

export interface CheckForUpdatesOptions {
  /** Bypass the short-lived result cache (manual "check now" actions). */
  force?: boolean
  /** Override platform detection when the caller already knows the target. */
  platform?: UpdatePlatform
  /** Override `navigator.userAgent` (tests/shells without a navigator). */
  userAgent?: string
  /** Injectable fetch (tests); defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Injectable clock (tests); defaults to `Date.now`. */
  now?: () => number
}

/** Version shown in the UI, read from the root package.json so it can never drift from the release. */
export const APP_VERSION: string = pkg.version

export const UPDATE_REPO = 'CodeCody93/Notedown'
export const RELEASES_API_URL = 'https://api.github.com/repos/CodeCody93/Notedown/releases/latest'
export const RELEASES_PAGE_URL = 'https://github.com/CodeCody93/Notedown/releases'

/** Silent startup check throttle (auto-check is opt-in in settings). */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** How long a successful result is reused before the next non-forced check hits the network. */
export const UPDATE_CACHE_MS = 5 * 60 * 1000

/** GitHub API request timeout; aborting makes `fetch` reject with AbortError. */
const REQUEST_TIMEOUT_MS = 8000

const TRUSTED_RELEASE_PATH = '/codecody93/notedown/releases/'

interface ParsedVersion {
  numbers: [number, number, number]
  prerelease: string[] | null
}

/**
 * Parse `v0.7.6` / `0.7.6` (optional `-prerelease` and `+build`). Returns null
 * for anything that is not exactly three numeric parts, so callers treat
 * malformed tags as invalid rather than guessing.
 */
export function parseVersion(value: string): ParsedVersion | null {
  const match = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
    value.trim(),
  )
  if (match === null) return null
  const numbers: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (!numbers.every((n) => Number.isFinite(n))) return null
  const prerelease = typeof match[4] === 'string' ? match[4].split('.') : null
  return { numbers, prerelease }
}

/** Semver prerelease precedence: numeric identifiers compare numerically, numeric < alphanumeric, release > prerelease. */
function comparePrerelease(a: string[] | null, b: string[] | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    const ai = a[i]
    const bi = b[i]
    const aNumeric = /^\d+$/.test(ai)
    const bNumeric = /^\d+$/.test(bi)
    if (aNumeric && bNumeric) {
      const an = Number(ai)
      const bn = Number(bi)
      if (an !== bn) return an < bn ? -1 : 1
    } else if (aNumeric) {
      return -1
    } else if (bNumeric) {
      return 1
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1
    }
  }
  if (a.length === b.length) return 0
  return a.length < b.length ? -1 : 1
}

/** Compare two versions (-1 / 0 / 1), or null when either one is invalid. */
export function compareVersions(a: string, b: string): number | null {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (va === null || vb === null) return null
  for (let i = 0; i < 3; i++) {
    if (va.numbers[i] !== vb.numbers[i]) return va.numbers[i] < vb.numbers[i] ? -1 : 1
  }
  return comparePrerelease(va.prerelease, vb.prerelease)
}

/** True only when both versions parse and `latest` is strictly newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) === 1
}

/**
 * Map a user agent to the installer family to offer. Mobile and everything
 * unknown fall back to 'other' (the UI then opens the release page instead of
 * an asset). Android/iOS are checked first because their UAs also mention Linux
 * or Mac OS X.
 */
export function detectUpdatePlatform(userAgent?: string): UpdatePlatform {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'other'
  if (/Windows/i.test(ua)) return 'windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'other'
}

/**
 * Anything the app opens with `openExternal` must be an https github.com URL
 * inside this repository's releases subtree — never an attacker-controlled
 * host from a compromised API response.
 */
export function isTrustedReleaseUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname.toLowerCase() === 'github.com' &&
    parsed.pathname.toLowerCase().startsWith(TRUSTED_RELEASE_PATH)
  )
}

interface DownloadCandidate {
  suffix: string
  label: string
}

function pickDownload(assets: ReleaseAsset[], candidates: DownloadCandidate[]): UpdateDownload | null {
  for (const candidate of candidates) {
    for (const asset of assets) {
      const name = asset.name.toLowerCase()
      // Signature files accompany the installers but are not installers.
      if (name.endsWith('.sig')) continue
      if (!name.endsWith(candidate.suffix)) continue
      if (!isTrustedReleaseUrl(asset.browserDownloadUrl)) continue
      return { fileName: asset.name, url: asset.browserDownloadUrl, label: candidate.label }
    }
  }
  return null
}

/**
 * Pick the platform installer from a release's assets. Linux prefers
 * AppImage over .deb; unknown platforms get no download (release page only).
 */
export function selectDownloadAsset(assets: ReleaseAsset[], platform: UpdatePlatform): UpdateDownload | null {
  switch (platform) {
    case 'windows':
      return pickDownload(assets, [{ suffix: '.msi', label: 'Windows installer' }])
    case 'macos':
      return pickDownload(assets, [{ suffix: '.dmg', label: 'macOS disk image' }])
    case 'linux':
      return pickDownload(assets, [
        { suffix: '.appimage', label: 'Linux AppImage' },
        { suffix: '.deb', label: 'Debian package' },
      ])
    default:
      return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Defensive parse of the GitHub "/releases/latest" payload. Required fields are
 * tag_name and html_url; optional fields fall back so a partial response can
 * still drive an "up to date" result. Malformed asset entries are dropped.
 */
export function parseLatestRelease(json: unknown): LatestRelease | null {
  const data = asRecord(json)
  if (data === null) return null
  const tagName = data.tag_name
  const htmlUrl = data.html_url
  if (!nonEmptyString(tagName) || !nonEmptyString(htmlUrl)) return null

  const assets: ReleaseAsset[] = []
  if (Array.isArray(data.assets)) {
    for (const entry of data.assets) {
      const asset = asRecord(entry)
      if (asset === null) continue
      const name = asset.name
      const url = asset.browser_download_url
      if (!nonEmptyString(name) || !nonEmptyString(url)) continue
      assets.push({ name, browserDownloadUrl: url })
    }
  }

  return {
    tagName,
    htmlUrl,
    name: nonEmptyString(data.name) ? data.name : tagName,
    publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
    assets,
  }
}

function errorResult(kind: UpdateErrorKind, message: string, checkedAt: number, releaseUrl = RELEASES_PAGE_URL): UpdateResult {
  return { status: 'error', kind, message, releaseUrl, checkedAt }
}

/**
 * Turn a parsed release into the result the UI consumes. Invalid versions
 * surface as an error (never as a false "available"), and an untrusted
 * html_url is replaced by the canonical releases page.
 */
export function evaluateLatestRelease(
  release: LatestRelease,
  currentVersion: string,
  platform: UpdatePlatform,
  checkedAt: number,
): UpdateResult {
  const releaseUrl = isTrustedReleaseUrl(release.htmlUrl) ? release.htmlUrl : RELEASES_PAGE_URL
  const comparison = compareVersions(release.tagName, currentVersion)
  if (comparison === null) {
    return {
      status: 'error',
      kind: 'invalid-response',
      message: 'GitHub returned an unexpected release version.',
      releaseUrl,
      checkedAt,
    }
  }
  if (comparison <= 0) {
    return {
      status: 'up-to-date',
      currentVersion,
      latestVersion: release.tagName,
      releaseUrl,
      checkedAt,
    }
  }
  return {
    status: 'available',
    currentVersion,
    latestVersion: release.tagName,
    releaseUrl,
    download: selectDownloadAsset(release.assets, platform),
    checkedAt,
  }
}

/** True when the opt-in startup check should run (never checked, or older than the interval). */
export function shouldAutoCheck(
  lastCheckedAt: number | null,
  now: number = Date.now(),
  intervalMs: number = AUTO_CHECK_INTERVAL_MS,
): boolean {
  if (lastCheckedAt === null || !Number.isFinite(lastCheckedAt)) return true
  return now - lastCheckedAt >= intervalMs
}

// --- module-level state (one in-flight check, one observable snapshot) ---

let updateState: UpdateState = { phase: 'idle', result: null, lastCheckedAt: null }
const listeners = new Set<(state: UpdateState) => void>()
let inFlight: Promise<UpdateResult> | null = null

function snapshot(): UpdateState {
  return { phase: updateState.phase, result: updateState.result, lastCheckedAt: updateState.lastCheckedAt }
}

function setState(next: UpdateState): void {
  updateState = next
  for (const listener of Array.from(listeners)) {
    try {
      listener(snapshot())
    } catch (error) {
      // A failing UI listener must never turn an update check into a rejection.
      console.error('[updates] state listener failed', error)
    }
  }
}

export function getUpdateState(): UpdateState {
  return snapshot()
}

/** Subscribe to state changes; returns an unsubscribe function. */
export function subscribeUpdateState(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

type FetchOutcome = { ok: true; response: Response } | { ok: false; result: UpdateResult }

async function sendRequest(
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  checkedAt: number,
): Promise<FetchOutcome> {
  try {
    const response = await fetchImpl(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal,
    })
    return { ok: true, response }
  } catch (error) {
    return {
      ok: false,
      result: isAbortError(error)
        ? errorResult('timeout', 'The update check timed out.', checkedAt)
        : errorResult('network', "Couldn't reach GitHub.", checkedAt),
    }
  }
}

async function fetchLatestRelease(
  platform: UpdatePlatform,
  fetchImpl: typeof fetch,
  checkedAt: number,
): Promise<UpdateResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const outcome = await sendRequest(fetchImpl, controller.signal, checkedAt)
    if (!outcome.ok) return outcome.result
    const response = outcome.response

    if (response.status === 404) return errorResult('not-found', 'No published releases were found.', checkedAt)
    if (response.status === 403 || response.status === 429) {
      return errorResult('rate-limit', 'GitHub rate limit reached. Try again later.', checkedAt)
    }
    if (!response.ok) return errorResult('http', `GitHub returned HTTP ${response.status}.`, checkedAt)

    try {
      const payload: unknown = await response.json()
      const release = parseLatestRelease(payload)
      if (release === null) return errorResult('invalid-response', 'GitHub returned an unexpected response.', checkedAt)
      return evaluateLatestRelease(release, APP_VERSION, platform, checkedAt)
    } catch (error) {
      return isAbortError(error)
        ? errorResult('timeout', 'The update check timed out.', checkedAt)
        : errorResult('invalid-response', 'GitHub returned an unexpected response.', checkedAt)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Check GitHub for the latest release. Concurrent calls share one request, and
 * a recent successful result is reused unless `force` is set. Always resolves
 * with an UpdateResult (never rejects) and leaves the observable state at
 * phase 'done'.
 */
export function checkForUpdates(opts: CheckForUpdatesOptions = {}): Promise<UpdateResult> {
  if (inFlight !== null) return inFlight

  const now = opts.now ?? Date.now
  const checkedAt = now()
  const cached = updateState.result
  if (
    opts.force !== true &&
    cached !== null &&
    cached.status !== 'error' &&
    updateState.lastCheckedAt !== null &&
    checkedAt - updateState.lastCheckedAt < UPDATE_CACHE_MS
  ) {
    return Promise.resolve(cached)
  }

  const platform = opts.platform ?? detectUpdatePlatform(opts.userAgent)
  const fetchImpl = opts.fetchImpl ?? fetch
  setState({ phase: 'checking', result: updateState.result, lastCheckedAt: updateState.lastCheckedAt })

  const promise = fetchLatestRelease(platform, fetchImpl, checkedAt)
    .then((result) => {
      setState({ phase: 'done', result, lastCheckedAt: result.checkedAt })
      return result
    })
    .finally(() => {
      inFlight = null
    })
  inFlight = promise
  return promise
}

/** Test helper: return to the initial idle state and notify current listeners. */
export function resetUpdateState(): void {
  setState({ phase: 'idle', result: null, lastCheckedAt: null })
}
