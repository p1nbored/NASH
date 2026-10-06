import { beforeEach, describe, expect, it, vi } from 'vitest'

// D-017: with no NASH release feed (APP_IDENTITY.updateFeed is null) every module that could dial an
// update host must refuse before any network call. Only electron's net is faked, so a stray fetch
// or a credential lookup for a release API shows up as a spy call.
const { netFetchMock, requestMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  requestMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock, request: requestMock },
  app: { getVersion: () => '1.0.0', isPackaged: true }
}))

const globalFetchMock = vi.fn()

function expectNoNetworkCall(): void {
  expect(netFetchMock).not.toHaveBeenCalled()
  expect(requestMock).not.toHaveBeenCalled()
  expect(globalFetchMock).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetModules()
  netFetchMock.mockReset()
  requestMock.mockReset()
  globalFetchMock.mockReset()
  vi.stubGlobal('fetch', globalFetchMock)
})

describe('release feed modules with no NASH feed', () => {
  it('fetchNudge returns no campaign without calling the update website', async () => {
    const { fetchNudge } = await import('./updater-nudge')

    await expect(fetchNudge()).resolves.toBeNull()

    expectNoNetworkCall()
  })

  it('fetchChangelog returns no changelog without calling the update website', async () => {
    const { fetchChangelog } = await import('./updater-changelog')

    await expect(fetchChangelog('1.0.1', '1.0.0')).resolves.toBeNull()

    expectNoNetworkCall()
  })

  it('refuses to build a release download url', async () => {
    const { getReleaseDownloadUrl } = await import('./updater-prerelease-feed')

    expect(() => getReleaseDownloadUrl('v1.0.1')).toThrow(/no release feed/i)
  })

  it.each([false, true])(
    'reports the release atom feed unavailable without a request (includePrerelease=%s)',
    async (includePrerelease) => {
      const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')

      const result = await fetchNewerReleaseTagsWithReadiness('1.0.0', 1, { includePrerelease })

      expect(result).toMatchObject({ tags: [], state: 'unavailable' })
      expectNoNetworkCall()
    }
  )

  it.each(['stable', 'rc', 'hourly', 'daily', 'adhoc'] as const)(
    'refuses to list %s builds before it asks for any credential or request',
    async (channel) => {
      const { listReleaseBuilds } = await import('./updater-release-builds')

      await expect(listReleaseBuilds(channel, 'win32')).rejects.toThrow(/no release feed/i)

      expectNoNetworkCall()
    }
  )

  it('refuses to resolve a pinned build to a feed url', async () => {
    const { resolveTargetBuild } = await import('./updater-release-builds')

    expect(() => resolveTargetBuild('hourly', 'v1.4.160-hourly.202607281400')).toThrow(
      /no release feed/i
    )
  })

  it('loads no electron-updater module', async () => {
    const { loadElectronAutoUpdater } = await import('./electron-updater-loader')

    // Why a specific error: an un-gated loader would fail differently (electron-updater cannot load outside Electron).
    expect(() => loadElectronAutoUpdater()).toThrow(/no release feed/i)
  })
})
