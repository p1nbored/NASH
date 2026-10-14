import { describe, expect, it, vi } from 'vitest'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import { EventEmitter } from 'node:events'
import {
  resolveAuthorizedPathMock,
  statMock,
  watchInWatcherProcessMock,
  watchMock
} from './orca-runtime-files-mock-registry'
import {
  createRuntimeFileCommands,
  useRuntimeFileCommandsLifecycle
} from './orca-runtime-files-test-harness'
import { awaitRuntimeFileWatcherUnsubscribes } from './orca-runtime-files'

vi.mock('fs', async () => (await import('./orca-runtime-files-mock-registry')).fsModuleMock())
vi.mock('fs/promises', async () =>
  (await import('./orca-runtime-files-mock-registry')).fsPromisesModuleMock()
)
vi.mock(
  './file-watcher-host',
  async () => (await import('./orca-runtime-files-mock-registry')).fileWatcherHostMock
)
vi.mock('../ipc/filesystem-auth', async () =>
  (await import('./orca-runtime-files-mock-registry')).filesystemAuthModuleMock()
)
vi.mock('../git/runner', async () =>
  (await import('./orca-runtime-files-mock-registry')).gitRunnerModuleMock()
)
vi.mock(
  '../ipc/local-worktree-runtime-options',
  async () => (await import('./orca-runtime-files-mock-registry')).localWorktreeRuntimeOptionsMock
)

describe('RuntimeFileCommands', () => {
  useRuntimeFileCommandsLifecycle()

  it('uses a conservative Node watcher for Windows runtime file watches', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    const watcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> }
    watcher.close = vi.fn(() => queueMicrotask(() => watcher.emit('close')))
    let listener: (() => void) | null = null
    watchMock.mockImplementation((_rootPath, _options, callback) => {
      listener = callback
      return watcher
    })
    resolveAuthorizedPathMock.mockResolvedValue('C:\\repo')
    statMock.mockResolvedValue({ isDirectory: () => true })
    const { commands } = createRuntimeFileCommands({ path: 'C:\\repo' })
    const onEvents = vi.fn()

    const unsubscribe = await commands.watchFileExplorer('id:wt-1', onEvents)

    expect(watchMock).toHaveBeenCalledWith('C:\\repo', { recursive: true }, expect.any(Function))
    const emit = listener as (() => void) | null
    expect(emit).not.toBeNull()

    emit?.()
    emit?.()
    await vi.advanceTimersByTimeAsync(149)
    expect(onEvents).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onEvents).toHaveBeenCalledTimes(1)
    expect(onEvents).toHaveBeenCalledWith([{ kind: 'overflow', absolutePath: 'C:\\repo' }])

    await unsubscribe()
    expect(watcher.close).toHaveBeenCalledTimes(1)
  })

  it('delegates local recursive watching to the watcher process', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })
    resolveAuthorizedPathMock.mockResolvedValue('/repo')
    statMock.mockResolvedValue({ isDirectory: () => true })
    const dispose = vi.fn()
    watchInWatcherProcessMock.mockResolvedValue(dispose)
    const { commands } = createRuntimeFileCommands()

    const unsubscribe = await commands.watchFileExplorer('id:wt-1', vi.fn())
    expect(watchInWatcherProcessMock).toHaveBeenCalledWith(
      '/repo',
      expect.any(Function),
      expect.any(Function),
      undefined
    )

    unsubscribe()
    await awaitRuntimeFileWatcherUnsubscribes()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('refuses an SSH runtime watch without watching this machine', async () => {
    const { commands, store } = createRuntimeFileCommands({ path: '/remote/repo' })
    store.getRepo.mockReturnValue({ connectionId: 'ssh-1' })

    await expect(commands.watchFileExplorer('id:wt-1', vi.fn())).rejects.toThrow(
      SshHostNotServedError
    )
    expect(watchInWatcherProcessMock).not.toHaveBeenCalled()
    expect(watchMock).not.toHaveBeenCalled()
  })
})
