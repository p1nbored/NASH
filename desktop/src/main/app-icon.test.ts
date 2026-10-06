import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  browserWindowGetAllWindowsMock,
  createFromPathMock,
  dockSetIconMock,
  isMock,
  windowSetIconMock
} = vi.hoisted(() => ({
  browserWindowGetAllWindowsMock: vi.fn(),
  createFromPathMock: vi.fn(),
  dockSetIconMock: vi.fn(),
  isMock: { dev: false },
  windowSetIconMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { dock: { setIcon: dockSetIconMock } },
  BrowserWindow: { getAllWindows: browserWindowGetAllWindowsMock },
  nativeImage: { createFromPath: createFromPathMock }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: isMock
}))

vi.mock('../../resources/icon.png?asset', () => ({
  default: 'classic-icon'
}))

vi.mock('../../resources/icon-dev.png?asset', () => ({
  default: 'classic-dev-icon'
}))

import { applyAppIcon, getAppIconPath, persistMacDockIcon } from './app-icon'

function waitForQueuedPersistence(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function waitForQueuedPersistenceMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createMockChildProcess(): EventEmitter & { kill: ReturnType<typeof vi.fn> } {
  const childProcess = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> }
  childProcess.kill = vi.fn(() => {
    childProcess.emit('exit')
    return true
  })
  return childProcess
}

describe('app icon selection', () => {
  beforeEach(() => {
    browserWindowGetAllWindowsMock.mockReset()
    createFromPathMock.mockReset()
    dockSetIconMock.mockReset()
    windowSetIconMock.mockReset()
    isMock.dev = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves every saved icon id, including Orca variants, to the NASH icon', () => {
    expect(getAppIconPath('classic')).toBe('classic-icon')
    expect(getAppIconPath('watercolor')).toBe('classic-icon')
    expect(getAppIconPath('blue')).toBe('classic-icon')
    expect(getAppIconPath('missing')).toBe('classic-icon')
  })

  it('applies the selected icon to the dock and live windows', () => {
    const image = { isEmpty: () => false }
    createFromPathMock.mockReturnValue(image)
    browserWindowGetAllWindowsMock.mockReturnValue([
      { isDestroyed: () => false, setIcon: windowSetIconMock },
      { isDestroyed: () => true, setIcon: vi.fn() }
    ])

    applyAppIcon('classic')

    expect(createFromPathMock).toHaveBeenCalledWith('classic-icon')
    if (process.platform === 'darwin') {
      expect(dockSetIconMock).toHaveBeenCalledWith(image)
    } else {
      expect(dockSetIconMock).not.toHaveBeenCalled()
    }
    expect(windowSetIconMock).toHaveBeenCalledWith(image)
  })

  it('clears the AppKit icon and Finder metadata a former custom Dock icon left behind', async () => {
    const execFile = vi.fn(
      (
        _file: string,
        _args: string[],
        optionsOrCallback: unknown,
        callback?: (error: Error | null) => void
      ) => {
        const onComplete =
          typeof optionsOrCallback === 'function'
            ? (optionsOrCallback as (error: Error | null) => void)
            : callback
        onComplete?.(null)
      }
    )

    persistMacDockIcon('classic', {
      appBundlePath: '/Applications/Orca.app',
      execFile,
      isDevApp: false,
      platform: 'darwin'
    })
    await waitForQueuedPersistence()

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      '/usr/bin/osascript',
      expect.arrayContaining([
        '-e',
        expect.stringContaining('setIcon:(missing value) forFile:appPath')
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          ORCA_APP_BUNDLE_PATH: '/Applications/Orca.app'
        }),
        timeout: 10_000
      }),
      expect.any(Function)
    )
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xattr',
      ['-d', 'com.apple.FinderInfo', '/Applications/Orca.app'],
      expect.objectContaining({
        timeout: 10_000
      }),
      expect.any(Function)
    )
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xattr',
      ['-d', 'com.apple.ResourceFork', '/Applications/Orca.app'],
      expect.objectContaining({
        timeout: 10_000
      }),
      expect.any(Function)
    )
  })

  it('warns for non-benign failures when clearing Finder custom icon metadata', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const execFile = vi.fn(
      (
        file: string,
        args: string[],
        optionsOrCallback: unknown,
        callback?: (error: Error | null) => void
      ) => {
        const onComplete =
          typeof optionsOrCallback === 'function'
            ? (optionsOrCallback as (error: Error | null) => void)
            : callback
        if (file !== '/usr/bin/xattr') {
          onComplete?.(null)
          return
        }
        onComplete?.(new Error(args[1] === 'com.apple.FinderInfo' ? 'No such xattr' : 'EACCES'))
      }
    )

    persistMacDockIcon('classic', {
      appBundlePath: '/Applications/Orca.app',
      execFile,
      isDevApp: false,
      platform: 'darwin'
    })
    await waitForQueuedPersistence()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[app-icon] failed to clear macOS dock icon metadata com.apple.ResourceFork:',
      expect.any(Error)
    )

    warnSpy.mockRestore()
  })

  it('warns when the AppKit classic icon reset fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const execFile = vi.fn(
      (
        file: string,
        _args: string[],
        optionsOrCallback: unknown,
        callback?: (error: Error | null) => void
      ) => {
        const onComplete =
          typeof optionsOrCallback === 'function'
            ? (optionsOrCallback as (error: Error | null) => void)
            : callback
        onComplete?.(file === '/usr/bin/osascript' ? new Error('reset denied') : null)
      }
    )

    persistMacDockIcon('classic', {
      appBundlePath: '/Applications/Orca.app',
      execFile,
      isDevApp: false,
      platform: 'darwin'
    })
    await waitForQueuedPersistence()

    expect(warnSpy).toHaveBeenCalledWith(
      '[app-icon] failed to clear macOS dock icon:',
      expect.any(Error)
    )

    warnSpy.mockRestore()
  })

  it('collapses rapid macOS dock icon resets so a stale request is skipped', async () => {
    const pendingCallbacks: (() => void)[] = []
    const execFile = vi.fn(
      (
        _file: string,
        _args: string[],
        optionsOrCallback: unknown,
        callback?: (error: Error | null) => void
      ) => {
        const onComplete =
          typeof optionsOrCallback === 'function'
            ? (optionsOrCallback as (error: Error | null) => void)
            : callback
        pendingCallbacks.push(() => onComplete?.(null))
      }
    )

    const options = {
      appBundlePath: '/Applications/Orca.app',
      execFile,
      isDevApp: false,
      platform: 'darwin' as const
    }

    persistMacDockIcon('classic', options)
    await waitForQueuedPersistence()

    persistMacDockIcon('classic', options)
    persistMacDockIcon('classic', options)

    // The first reset's AppKit call is in flight; the next two wait in the queue.
    expect(execFile).toHaveBeenCalledTimes(1)

    pendingCallbacks.shift()?.()
    await waitForQueuedPersistence()

    expect(execFile).toHaveBeenCalledTimes(3)
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      '/usr/bin/xattr',
      ['-d', 'com.apple.FinderInfo', '/Applications/Orca.app'],
      expect.objectContaining({
        timeout: 10_000
      }),
      expect.any(Function)
    )
    expect(execFile).toHaveBeenNthCalledWith(
      3,
      '/usr/bin/xattr',
      ['-d', 'com.apple.ResourceFork', '/Applications/Orca.app'],
      expect.objectContaining({
        timeout: 10_000
      }),
      expect.any(Function)
    )

    pendingCallbacks.shift()?.()
    pendingCallbacks.shift()?.()
    await waitForQueuedPersistence()

    // The stale second request is skipped; only the latest one runs.
    expect(execFile).toHaveBeenCalledTimes(4)
    expect(execFile).toHaveBeenNthCalledWith(
      4,
      '/usr/bin/osascript',
      expect.arrayContaining([
        '-e',
        expect.stringContaining('setIcon:(missing value) forFile:appPath')
      ]),
      expect.objectContaining({
        timeout: 10_000
      }),
      expect.any(Function)
    )

    // Why: drain every command, including ones started by earlier completions, so the
    // module-level persistence queue is idle for the next test.
    while (pendingCallbacks.length > 0) {
      pendingCallbacks.shift()?.()
      await waitForQueuedPersistence()
    }
  })

  it('continues macOS dock icon resets when a command never completes', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hungChildProcess = createMockChildProcess()
    const execFile = vi.fn(
      (
        _file: string,
        _args: string[],
        optionsOrCallback: unknown,
        callback?: (error: Error | null) => void
      ) => {
        if (execFile.mock.calls.length === 1) {
          return hungChildProcess
        }
        const onComplete =
          typeof optionsOrCallback === 'function'
            ? (optionsOrCallback as (error: Error | null) => void)
            : callback
        onComplete?.(null)
        return undefined
      }
    )

    const options = {
      appBundlePath: '/Applications/Orca.app',
      execFile,
      isDevApp: false,
      platform: 'darwin' as const
    }

    persistMacDockIcon('classic', options)
    await waitForQueuedPersistenceMicrotasks()

    persistMacDockIcon('classic', options)

    expect(execFile).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    await waitForQueuedPersistenceMicrotasks()

    expect(hungChildProcess.kill).not.toHaveBeenCalled()
    expect(execFile).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    for (let round = 0; round < 20; round += 1) {
      await Promise.resolve()
    }

    expect(warnSpy).toHaveBeenCalledWith('[app-icon] timed out clearing macOS dock icon')
    expect(hungChildProcess.kill).toHaveBeenCalledTimes(1)
    // The hung reset gives up, finishes its metadata cleanup, then the queued request runs.
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      '/usr/bin/xattr',
      ['-d', 'com.apple.FinderInfo', '/Applications/Orca.app'],
      expect.objectContaining({ timeout: 10_000 }),
      expect.any(Function)
    )
    expect(execFile).toHaveBeenNthCalledWith(
      4,
      '/usr/bin/osascript',
      expect.arrayContaining([
        '-e',
        expect.stringContaining('setIcon:(missing value) forFile:appPath')
      ]),
      expect.objectContaining({ timeout: 10_000 }),
      expect.any(Function)
    )

    warnSpy.mockRestore()
  })
})
