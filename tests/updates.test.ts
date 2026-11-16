// Update checks: semver comparison, platform/asset selection, defensive GitHub
// payload parsing, and the observable check flow (cache, dedupe, error kinds).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_VERSION,
  AUTO_CHECK_INTERVAL_MS,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
  UPDATE_CACHE_MS,
  checkForUpdates,
  compareVersions,
  detectUpdatePlatform,
  evaluateLatestRelease,
  getUpdateState,
  isNewerVersion,
  isTrustedReleaseUrl,
  parseLatestRelease,
  parseVersion,
  resetUpdateState,
  selectDownloadAsset,
  shouldAutoCheck,
  subscribeUpdateState,
} from '../src/app/updates'
import type { LatestRelease, ReleaseAsset, UpdateState } from '../src/app/updates'

// --- helpers ---

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function makeFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(handler)
}

function asFetch(mock: ReturnType<typeof makeFetch>): typeof fetch {
  return mock as unknown as typeof fetch
}

function githubAssetUrl(name: string, tag = 'v9.9.9'): string {
  return `https://github.com/CodeCody93/Notedown/releases/download/${tag}/${name}`
}

function releasePayload(tag: string, assets: Array<{ name: string; url: string }> = []) {
  return {
    tag_name: tag,
    html_url: `https://github.com/CodeCody93/Notedown/releases/tag/${tag}`,
    name: `Notedown ${tag}`,
    published_at: '2026-01-01T00:00:00Z',
    assets: assets.map((asset) => ({ name: asset.name, browser_download_url: asset.url })),
  }
}

function makeRelease(overrides: Partial<LatestRelease> = {}): LatestRelease {
  return {
    tagName: 'v9.9.9',
    htmlUrl: 'https://github.com/CodeCody93/Notedown/releases/tag/v9.9.9',
    name: 'Notedown 9.9.9',
    publishedAt: null,
    assets: [],
    ...overrides,
  }
}

describe('parseVersion', () => {
  it('accepts an optional v prefix and exactly three numeric parts', () => {
    expect(parseVersion('0.7.6')).toEqual({ numbers: [0, 7, 6], prerelease: null })
    expect(parseVersion('v0.7.6')).toEqual({ numbers: [0, 7, 6], prerelease: null })
    expect(parseVersion('14.2.30')).toEqual({ numbers: [14, 2, 30], prerelease: null })
  })

  it('parses prerelease and ignores build metadata', () => {
    expect(parseVersion('1.2.3-beta.1+build.5')).toEqual({
      numbers: [1, 2, 3],
      prerelease: ['beta', '1'],
    })
    expect(parseVersion('v2.0.0-rc.1')).toEqual({ numbers: [2, 0, 0], prerelease: ['rc', '1'] })
  })

  it('rejects malformed versions', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('v')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('1.2.3.4')).toBeNull()
    expect(parseVersion('1.2.x')).toBeNull()
    expect(parseVersion('not-a-version')).toBeNull()
    expect(parseVersion('1.2.3-')).toBeNull()
    expect(parseVersion('1.2.3+')).toBeNull()
  })
})

describe('compareVersions / isNewerVersion', () => {
  it('treats a v prefix as equal and compares numerically, not lexically', () => {
    expect(compareVersions('v0.7.6', '0.7.6')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.9.9', '0.10.0')).toBe(-1)
  })

  it('orders prereleases with semver rules', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    // numeric identifiers sort below alphanumeric ones
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
    // a release outranks its prereleases
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1)
    // build metadata has no precedence
    expect(compareVersions('1.0.0+build.1', '1.0.0')).toBe(0)
  })

  it('returns null when either version is invalid', () => {
    expect(compareVersions('nope', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.0', 'nope')).toBeNull()
    expect(isNewerVersion('nope', '1.0.0')).toBe(false)
  })

  it('isNewerVersion is true only for a strictly newer valid version', () => {
    expect(isNewerVersion('v1.2.4', '1.2.3')).toBe(true)
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
    expect(isNewerVersion('1.2.2', '1.2.3')).toBe(false)
    expect(isNewerVersion('1.2.3-beta', '1.2.3')).toBe(false)
  })
})

describe('detectUpdatePlatform', () => {
  it('maps desktop user agents', () => {
    expect(
      detectUpdatePlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ),
    ).toBe('windows')
    expect(
      detectUpdatePlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      ),
    ).toBe('macos')
    expect(
      detectUpdatePlatform('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0'),
    ).toBe('linux')
  })

  it('maps mobile and unknown agents to other', () => {
    expect(
      detectUpdatePlatform(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('other')
    expect(
      detectUpdatePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe('other')
    expect(detectUpdatePlatform('curl/8.5.0')).toBe('other')
    expect(detectUpdatePlatform()).toBe('other')
  })
})

describe('isTrustedReleaseUrl', () => {
  it('accepts real release and asset URLs on github.com', () => {
    expect(isTrustedReleaseUrl('https://github.com/CodeCody93/Notedown/releases/tag/v0.7.6')).toBe(true)
    expect(isTrustedReleaseUrl(githubAssetUrl('Notedown_0.7.6_x64-setup.msi', 'v0.7.6'))).toBe(true)
    expect(isTrustedReleaseUrl('https://github.com/codecody93/notedown/releases/latest')).toBe(true)
  })

  it('rejects other schemes, hosts, and paths', () => {
    expect(isTrustedReleaseUrl('http://github.com/CodeCody93/Notedown/releases/tag/v0.7.6')).toBe(false)
    expect(isTrustedReleaseUrl('https://evil.example/CodeCody93/Notedown/releases/tag/v0.7.6')).toBe(false)
    expect(isTrustedReleaseUrl('https://github.com.evil.example/CodeCody93/Notedown/releases/tag/v0.7.6')).toBe(false)
    expect(isTrustedReleaseUrl('https://github.com/CodeCody93/Notedown/issues')).toBe(false)
    expect(isTrustedReleaseUrl('https://github.com/Other/Repo/releases/tag/v0.7.6')).toBe(false)
    expect(isTrustedReleaseUrl('not a url')).toBe(false)
  })
})

describe('selectDownloadAsset', () => {
  const assets: ReleaseAsset[] = [
    { name: 'Notedown_0.7.6_x64-setup.msi', browserDownloadUrl: githubAssetUrl('Notedown_0.7.6_x64-setup.msi') },
    { name: 'Notedown_0.7.6_x64-setup.msi.sig', browserDownloadUrl: githubAssetUrl('Notedown_0.7.6_x64-setup.msi.sig') },
    { name: 'Notedown_0.7.6_x64.dmg', browserDownloadUrl: githubAssetUrl('Notedown_0.7.6_x64.dmg') },
    { name: 'Notedown_0.7.6_amd64.deb', browserDownloadUrl: githubAssetUrl('Notedown_0.7.6_amd64.deb') },
    { name: 'Notedown_0.7.6_amd64.AppImage', browserDownloadUrl: githubAssetUrl('Notedown_0.7.6_amd64.AppImage') },
  ]

  it('picks the installer per platform', () => {
    expect(selectDownloadAsset(assets, 'windows')).toEqual({
      fileName: 'Notedown_0.7.6_x64-setup.msi',
      url: githubAssetUrl('Notedown_0.7.6_x64-setup.msi'),
      label: 'Windows installer',
    })
    expect(selectDownloadAsset(assets, 'macos')).toMatchObject({
      fileName: 'Notedown_0.7.6_x64.dmg',
      label: 'macOS disk image',
    })
    // AppImage is preferred over .deb even when the deb asset comes first.
    expect(selectDownloadAsset(assets, 'linux')).toMatchObject({
      fileName: 'Notedown_0.7.6_amd64.AppImage',
      label: 'Linux AppImage',
    })
    expect(selectDownloadAsset(assets, 'other')).toBeNull()
  })

  it('falls back to the .deb when no AppImage exists', () => {
    const debOnly = assets.filter((asset) => !asset.name.toLowerCase().endsWith('.appimage'))
    expect(selectDownloadAsset(debOnly, 'linux')).toMatchObject({
      fileName: 'Notedown_0.7.6_amd64.deb',
      label: 'Debian package',
    })
  })

  it('ignores .sig files and untrusted asset URLs', () => {
    const untrusted: ReleaseAsset[] = [
      { name: 'Notedown_0.7.6_x64-setup.msi', browserDownloadUrl: 'https://evil.example/setup.msi' },
      { name: 'Notedown_0.7.6_x64-setup.msi.sig', browserDownloadUrl: githubAssetUrl('setup.msi.sig') },
    ]
    expect(selectDownloadAsset(untrusted, 'windows')).toBeNull()
    expect(selectDownloadAsset([], 'windows')).toBeNull()
    expect(selectDownloadAsset([{ name: 'readme.txt', browserDownloadUrl: githubAssetUrl('readme.txt') }], 'linux')).toBeNull()
  })
})

describe('parseLatestRelease', () => {
  it('maps a valid GitHub release payload', () => {
    const parsed = parseLatestRelease({
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/CodeCody93/Notedown/releases/tag/v1.2.3',
      name: 'Notedown 1.2.3',
      published_at: '2026-01-02T03:04:05Z',
      assets: [
        { name: 'Notedown.msi', browser_download_url: githubAssetUrl('Notedown.msi', 'v1.2.3') },
        { name: 'missing-url' },
        null,
        { browser_download_url: githubAssetUrl('missing-name.msi', 'v1.2.3') },
      ],
    })
    expect(parsed).toEqual({
      tagName: 'v1.2.3',
      htmlUrl: 'https://github.com/CodeCody93/Notedown/releases/tag/v1.2.3',
      name: 'Notedown 1.2.3',
      publishedAt: '2026-01-02T03:04:05Z',
      assets: [{ name: 'Notedown.msi', browserDownloadUrl: githubAssetUrl('Notedown.msi', 'v1.2.3') }],
    })
  })

  it('falls back for optional fields and returns null for malformed payloads', () => {
    const parsed = parseLatestRelease({
      tag_name: 'v1.0.0',
      html_url: 'https://github.com/CodeCody93/Notedown/releases/tag/v1.0.0',
      published_at: 123,
      assets: 'nope',
    })
    expect(parsed).toEqual({
      tagName: 'v1.0.0',
      htmlUrl: 'https://github.com/CodeCody93/Notedown/releases/tag/v1.0.0',
      name: 'v1.0.0',
      publishedAt: null,
      assets: [],
    })

    expect(parseLatestRelease(null)).toBeNull()
    expect(parseLatestRelease('v1.0.0')).toBeNull()
    expect(parseLatestRelease([])).toBeNull()
    expect(parseLatestRelease({})).toBeNull()
    expect(parseLatestRelease({ tag_name: 'v1.0.0' })).toBeNull()
    expect(parseLatestRelease({ html_url: 'https://github.com/CodeCody93/Notedown/releases' })).toBeNull()
    expect(parseLatestRelease({ tag_name: '', html_url: 'https://github.com/CodeCody93/Notedown/releases' })).toBeNull()
  })
})

describe('evaluateLatestRelease', () => {
  it('reports up-to-date when the release is not newer', () => {
    const result = evaluateLatestRelease(
      makeRelease({
        tagName: `v${APP_VERSION}`,
        htmlUrl: `https://github.com/CodeCody93/Notedown/releases/tag/v${APP_VERSION}`,
      }),
      APP_VERSION,
      'windows',
      42,
    )
    expect(result).toEqual({
      status: 'up-to-date',
      currentVersion: APP_VERSION,
      latestVersion: `v${APP_VERSION}`,
      releaseUrl: `https://github.com/CodeCody93/Notedown/releases/tag/v${APP_VERSION}`,
      checkedAt: 42,
    })
  })

  it('reports an available release with the matching download', () => {
    const result = evaluateLatestRelease(
      makeRelease({
        tagName: 'v9.9.9',
        assets: [{ name: 'Notedown_9.9.9_amd64.AppImage', browserDownloadUrl: githubAssetUrl('Notedown_9.9.9_amd64.AppImage') }],
      }),
      APP_VERSION,
      'linux',
      7,
    )
    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.latestVersion).toBe('v9.9.9')
    expect(result.download).toEqual({
      fileName: 'Notedown_9.9.9_amd64.AppImage',
      url: githubAssetUrl('Notedown_9.9.9_amd64.AppImage'),
      label: 'Linux AppImage',
    })
  })

  it('falls back to the releases page for an untrusted html_url', () => {
    const result = evaluateLatestRelease(makeRelease({ htmlUrl: 'https://evil.example/releases/tag/v9.9.9' }), APP_VERSION, 'windows', 1)
    expect(result.releaseUrl).toBe(RELEASES_PAGE_URL)
  })

  it('returns an invalid-response error for unparsable versions', () => {
    const result = evaluateLatestRelease(makeRelease({ tagName: 'banana' }), APP_VERSION, 'windows', 1)
    expect(result).toMatchObject({
      status: 'error',
      kind: 'invalid-response',
      message: 'GitHub returned an unexpected release version.',
      checkedAt: 1,
    })
    expect(result.releaseUrl).toBe('https://github.com/CodeCody93/Notedown/releases/tag/v9.9.9')

    const badCurrent = evaluateLatestRelease(makeRelease(), 'not-a-version', 'windows', 2)
    expect(badCurrent).toMatchObject({ status: 'error', kind: 'invalid-response' })
  })
})

describe('checkForUpdates', () => {
  beforeEach(() => {
    resetUpdateState()
  })

  it('returns an available result for a newer release (correct asset and request)', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(
        200,
        releasePayload('v9.9.9', [
          { name: 'Notedown_9.9.9_x64_en-US.msi', url: githubAssetUrl('Notedown_9.9.9_x64_en-US.msi') },
        ]),
      ),
    )
    const result = await checkForUpdates({ fetchImpl: asFetch(fetchImpl), platform: 'windows', force: true })

    expect(result).toMatchObject({
      status: 'available',
      currentVersion: APP_VERSION,
      latestVersion: 'v9.9.9',
      download: { fileName: 'Notedown_9.9.9_x64_en-US.msi', label: 'Windows installer' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(RELEASES_API_URL)
    const init = fetchImpl.mock.calls[0]?.[1]
    expect(init?.headers).toEqual({ Accept: 'application/vnd.github+json' })
    expect(init?.cache).toBe('no-store')
    expect(init?.signal).toBeDefined()

    const state = getUpdateState()
    expect(state.phase).toBe('done')
    expect(state.lastCheckedAt).toBe(result.checkedAt)
    expect(state.result).toEqual(result)
  })

  it('reports up-to-date when the latest tag matches the app version', async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(200, releasePayload(`v${APP_VERSION}`)))
    const result = await checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true })
    expect(result).toMatchObject({
      status: 'up-to-date',
      currentVersion: APP_VERSION,
      latestVersion: `v${APP_VERSION}`,
    })
  })

  it('maps 404 to not-found', async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(404, { message: 'Not Found' }))
    const result = await checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true })
    expect(result).toMatchObject({
      status: 'error',
      kind: 'not-found',
      message: 'No published releases were found.',
      releaseUrl: RELEASES_PAGE_URL,
    })
  })

  it('maps 403/429 to rate-limit and other statuses to http', async () => {
    for (const [status, kind] of [
      [403, 'rate-limit'],
      [429, 'rate-limit'],
      [500, 'http'],
    ] as const) {
      resetUpdateState()
      const fetchImpl = makeFetch(async () => jsonResponse(status, {}))
      const result = await checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true })
      expect(result.status).toBe('error')
      if (result.status !== 'error') throw new Error('expected error')
      expect(result.kind).toBe(kind)
      expect(result.message).toBe(
        kind === 'rate-limit' ? 'GitHub rate limit reached. Try again later.' : 'GitHub returned HTTP 500.',
      )
    }
  })

  it('maps a rejected fetch to network', async () => {
    const fetchImpl = makeFetch(async () => {
      throw new TypeError('network down')
    })
    const result = await checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true })
    expect(result).toMatchObject({
      status: 'error',
      kind: 'network',
      message: "Couldn't reach GitHub.",
      releaseUrl: RELEASES_PAGE_URL,
    })
    expect(getUpdateState().phase).toBe('done')
  })

  it('maps malformed JSON and unexpected payloads to invalid-response', async () => {
    const badJson = makeFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    }) as unknown as Response)
    const badJsonResult = await checkForUpdates({ fetchImpl: asFetch(badJson), force: true })
    expect(badJsonResult).toMatchObject({
      status: 'error',
      kind: 'invalid-response',
      message: 'GitHub returned an unexpected response.',
    })

    resetUpdateState()
    const badShape = makeFetch(async () => jsonResponse(200, { message: 'not a release' }))
    const badShapeResult = await checkForUpdates({ fetchImpl: asFetch(badShape), force: true })
    expect(badShapeResult).toMatchObject({ status: 'error', kind: 'invalid-response' })
  })

  it('dedupes concurrent calls into a single request', async () => {
    let resolveResponse!: (response: Response) => void
    const fetchImpl = makeFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        }),
    )
    const first = checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true })
    const second = checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true })

    expect(second).toBe(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    resolveResponse(jsonResponse(200, releasePayload(`v${APP_VERSION}`)))
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(a.status).toBe('up-to-date')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reuses a recent successful result unless forced', async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(200, releasePayload(`v${APP_VERSION}`)))
    const first = await checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true, now: () => 1_000 })
    const cached = await checkForUpdates({ fetchImpl: asFetch(fetchImpl), now: () => 1_000 + UPDATE_CACHE_MS - 1 })
    expect(cached).toBe(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const forcedAt = 1_000 + UPDATE_CACHE_MS - 1
    await checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true, now: () => forcedAt })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // At exactly the cache window the result is stale again (strict <).
    await checkForUpdates({ fetchImpl: asFetch(fetchImpl), now: () => forcedAt + UPDATE_CACHE_MS })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('notifies subscribers through checking/done, unsubscribes, and resets to idle', async () => {
    const seen: UpdateState[] = []
    const unsubscribe = subscribeUpdateState((state) => seen.push(state))
    const fetchImpl = makeFetch(async () => jsonResponse(200, releasePayload(`v${APP_VERSION}`)))

    await checkForUpdates({ fetchImpl: asFetch(fetchImpl), force: true })
    expect(seen.map((state) => state.phase)).toEqual(['checking', 'done'])
    expect(seen[0].result).toBeNull()
    expect(seen[1].result?.status).toBe('up-to-date')
    unsubscribe()

    const after = vi.fn()
    const unsubscribeAfter = subscribeUpdateState(after)
    resetUpdateState()
    expect(getUpdateState()).toEqual({ phase: 'idle', result: null, lastCheckedAt: null })
    expect(after).toHaveBeenCalledWith({ phase: 'idle', result: null, lastCheckedAt: null })
    unsubscribeAfter()

    expect(seen).toHaveLength(2)
  })
})

describe('shouldAutoCheck', () => {
  it('checks when never checked before', () => {
    expect(shouldAutoCheck(null)).toBe(true)
  })

  it('skips a recent check and checks again after the interval', () => {
    const checkedAt = 1_000
    expect(shouldAutoCheck(checkedAt, checkedAt + 60_000)).toBe(false)
    expect(shouldAutoCheck(checkedAt, checkedAt + AUTO_CHECK_INTERVAL_MS - 1)).toBe(false)
    expect(shouldAutoCheck(checkedAt, checkedAt + AUTO_CHECK_INTERVAL_MS)).toBe(true)
    expect(shouldAutoCheck(checkedAt, checkedAt + AUTO_CHECK_INTERVAL_MS + 1)).toBe(true)
  })

  it('honours a custom interval', () => {
    expect(shouldAutoCheck(0, 999, 1_000)).toBe(false)
    expect(shouldAutoCheck(0, 1_000, 1_000)).toBe(true)
  })
})
