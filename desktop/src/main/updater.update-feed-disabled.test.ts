import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

// D-017: a build explicitly configured without a release feed, so a packaged
// build must never check, download or install, and must not reach Orca's releases or website.
// The real changelog, nudge, prerelease-feed and release-list modules run here (only electron's net
// is faked), so any code path that dials out is caught by the fetch spies.
const { netFetchMock } = vi.hoisted(() => ({ netFetchMock: vi.fn() }))

const {
  appMock,
  autoUpdaterMock,
  powerMonitorOnMock,
  chooseLocalBuildMock,
  startLocalBuildFeedMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => ({ ...moduleFactories.electron(), net: { fetch: netFetchMock } }))
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

warmUpdaterModule()

const globalFetchMock = vi.fn()
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

function expectNothingDialedOut(): void {
  expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
  expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
  expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  expect(chooseLocalBuildMock).not.toHaveBeenCalled()
  expect(startLocalBuildFeedMock).not.toHaveBeenCalled()
  expect(netFetchMock).not.toHaveBeenCalled()
  expect(globalFetchMock).not.toHaveBeenCalled()
}

describe('updater with no release feed (APP_IDENTITY.updateFeed is null)', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    netFetchMock.mockReset()
    globalFetchMock.mockReset()
    vi.stubGlobal('fetch', globalFetchMock)
    vi.useFakeTimers()
  })

  it('configures nothing, registers no listeners and arms no timers at startup', async () => {
    const sendMock = vi.fn()
    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater({ webContents: { send: sendMock } } as never, {
      getLastUpdateCheckAt: () => null
    })
    await vi.advanceTimersByTimeAsync(THREE_DAYS_MS)

    expectNothingDialedOut()
    expect(autoUpdaterMock.on).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalled()
    expect(appMock.on).not.toHaveBeenCalledWith('browser-window-focus', expect.anything())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not launch a background check', async () => {
    const { setupAutoUpdater, checkForUpdates } = await loadUpdaterModule()
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never)

    checkForUpdates()
    await vi.advanceTimersByTimeAsync(THREE_DAYS_MS)

    expectNothingDialedOut()
  })

  it.each([
    ['a routine check', undefined],
    ['an RC check', { includePrerelease: true }],
    ['a perf check', { includePerfPrerelease: true }],
    ['a local build switch', { localBuild: true }],
    ['a pinned hourly build', { channel: 'hourly', targetTag: 'v1.4.160-hourly.202607281400' }],
    ['a pinned stable build', { channel: 'stable', targetTag: 'v1.4.160' }]
  ] as const)('answers %s from the menu without launching it', async (_name, options) => {
    const sendMock = vi.fn()
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater({ webContents: { send: sendMock } } as never)

    checkForUpdatesFromMenu(options ? { ...options } : undefined)
    await vi.advanceTimersByTimeAsync(THREE_DAYS_MS)

    expectNothingDialedOut()
    expect(sendMock).toHaveBeenCalledWith('updater:status', {
      state: 'not-available',
      userInitiated: true
    })
    expect(sendMock).not.toHaveBeenCalledWith(
      'updater:status',
      expect.objectContaining({ state: 'checking' })
    )
  })

  it('refuses to download or install anything', async () => {
    const { setupAutoUpdater, downloadUpdate, quitAndInstall, isQuittingForUpdate } =
      await loadUpdaterModule()
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never)

    downloadUpdate()
    quitAndInstall()
    await vi.advanceTimersByTimeAsync(THREE_DAYS_MS)

    expectNothingDialedOut()
    expect(appMock.quit).not.toHaveBeenCalled()
    expect(isQuittingForUpdate()).toBe(false)
  })

  it.each(['stable', 'rc', 'hourly', 'daily', 'adhoc'] as const)(
    'lists no %s builds and never contacts a release host',
    async (channel) => {
      const { listAvailableReleaseBuilds } = await loadUpdaterModule()

      await expect(listAvailableReleaseBuilds(channel)).rejects.toThrow(/no release feed/i)

      expectNothingDialedOut()
    }
  )

  it('reports the server updater as unavailable and refuses remote update requests', async () => {
    const { setupAutoUpdater, getRemoteServerUpdateSupport, checkForRemoteServerUpdate } =
      await loadUpdaterModule()
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never)

    expect(getRemoteServerUpdateSupport()).toMatchObject({
      automatic: false,
      reason: 'updater-unavailable'
    })
    expect(() => checkForRemoteServerUpdate('runtime-1')).toThrow('remote_update_manual_required')
    expectNothingDialedOut()
  })
})

vi.mock('../shared/app-identity-constants', async (importOriginal) => {
  const actual = await importOriginal<{ APP_IDENTITY: object }>()
  return { ...actual, APP_IDENTITY: { ...actual.APP_IDENTITY, updateFeed: null } }
})
