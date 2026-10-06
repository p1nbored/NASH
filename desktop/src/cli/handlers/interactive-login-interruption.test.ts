import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOGIN_PROCESS_CLOSE_FALLBACK_MS,
  LOGIN_PROCESS_POSIX_GRACE_MS,
  terminateInteractiveLoginProcess,
  terminateWindowsLoginProcessTree,
  WINDOWS_LOGIN_TREE_KILL_TIMEOUT_MS,
  withInteractiveLoginCleanup,
  type InteractiveLoginSession
} from './interactive-login-interruption'

function loginChild(pid = 4321): ChildProcess & EventEmitter {
  return Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    pid
  }) as unknown as ChildProcess & EventEmitter
}

afterEach(() => {
  vi.useRealTimers()
})

describe('terminateInteractiveLoginProcess', () => {
  it('runs bounded taskkill /T /F without a shell', async () => {
    const execFileImpl = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: { timeout?: number; windowsHide?: boolean },
        callback: (error: Error | null) => void
      ) => callback(null)
    )

    await terminateWindowsLoginProcessTree(4321, execFileImpl as never)

    expect(execFileImpl).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4321', '/T', '/F'],
      { timeout: WINDOWS_LOGIN_TREE_KILL_TIMEOUT_MS, windowsHide: true },
      expect.any(Function)
    )
  })

  it('waits for both Windows tree termination and physical wrapper close', async () => {
    const child = loginChild()
    let finishTreeKill: (() => void) | undefined
    const killWindowsTree = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTreeKill = resolve
        })
    )
    let terminated = false

    const pending = terminateInteractiveLoginProcess(child, 'SIGTERM', {
      platform: 'win32',
      killWindowsTree
    }).then(() => {
      terminated = true
    })

    expect(killWindowsTree).toHaveBeenCalledWith(4321)
    child.emit('close', 1)
    await Promise.resolve()
    expect(terminated).toBe(false)

    finishTreeKill?.()
    await pending
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('bounds Windows close waits and falls back to the direct wrapper', async () => {
    vi.useFakeTimers()
    const child = loginChild()

    const pending = terminateInteractiveLoginProcess(child, 'SIGINT', {
      platform: 'win32',
      killWindowsTree: vi.fn().mockResolvedValue(undefined)
    })
    await vi.advanceTimersByTimeAsync(LOGIN_PROCESS_CLOSE_FALLBACK_MS)
    expect(child.kill).toHaveBeenCalledOnce()
    expect(child.kill).toHaveBeenCalledWith(undefined)

    await vi.advanceTimersByTimeAsync(LOGIN_PROCESS_CLOSE_FALLBACK_MS)
    await pending
  })

  it('forwards the interrupt signal to a direct POSIX child and awaits close', async () => {
    const child = loginChild()
    let terminated = false

    const pending = terminateInteractiveLoginProcess(child, 'SIGHUP', {
      platform: 'linux'
    }).then(() => {
      terminated = true
    })

    expect(child.kill).toHaveBeenCalledWith('SIGHUP')
    await Promise.resolve()
    expect(terminated).toBe(false)

    child.emit('close', 1)
    await pending
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('force-kills an unresponsive POSIX child before the final bounded wait', async () => {
    vi.useFakeTimers()
    const child = loginChild()

    const pending = terminateInteractiveLoginProcess(child, 'SIGINT', {
      platform: 'darwin'
    })
    await vi.advanceTimersByTimeAsync(LOGIN_PROCESS_POSIX_GRACE_MS)
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGINT')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')

    await vi.advanceTimersByTimeAsync(LOGIN_PROCESS_CLOSE_FALLBACK_MS)
    await pending
  })
})

// Why identified by set difference: vitest installs its own once-wrapped SIGINT teardown.
function newSignalListener(
  signal: NodeJS.Signals,
  before: readonly unknown[]
): (signal: NodeJS.Signals) => void {
  const added = process.listeners(signal).filter((listener) => !before.includes(listener))
  if (added.length !== 1) {
    throw new Error(`Expected 1 new ${signal} listener, found ${added.length}`)
  }
  return added[0] as (signal: NodeJS.Signals) => void
}

function idleSession(): InteractiveLoginSession {
  return { child: null, registering: false, terminationPromise: null }
}

describe('withInteractiveLoginCleanup', () => {
  it('waits for in-flight cleanup when a second signal arrives', async () => {
    let releaseCleanup: (() => void) | undefined
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolvePromise) => {
          releaseCleanup = resolvePromise
        })
    )
    let finishAdd: ((value: string) => void) | undefined
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const sigintBefore = process.listeners('SIGINT')
    const sigtermBefore = process.listeners('SIGTERM')

    const pending = withInteractiveLoginCleanup(
      idleSession(),
      cleanup,
      () =>
        new Promise<string>((resolvePromise) => {
          finishAdd = resolvePromise
        })
    )
    const onSigint = newSignalListener('SIGINT', sigintBefore)
    const onSigterm = newSignalListener('SIGTERM', sigtermBefore)
    // Why: a `once` handler would let a second Ctrl-C fall through to Node's default mid-cleanup.
    expect(process.rawListeners('SIGINT')).toContain(onSigint)

    onSigint('SIGINT')
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
    onSigterm('SIGTERM')
    await new Promise<void>((resolvePromise) => {
      setImmediate(resolvePromise)
    })
    expect(exitSpy).not.toHaveBeenCalled()

    releaseCleanup?.()
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled())
    expect(cleanup).toHaveBeenCalledOnce()

    finishAdd?.('added')
    await pending
    exitSpy.mockRestore()
  })

  it('stays armed for signals until post-success cleanup finishes', async () => {
    let releaseCleanup: (() => void) | undefined
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolvePromise) => {
          releaseCleanup = resolvePromise
        })
    )
    const listenersBefore = process.listeners('SIGINT')

    const pending = withInteractiveLoginCleanup(idleSession(), cleanup, async () => 'added')
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalled())

    // Why: cleanup is still in flight here, so the guard must still be installed.
    const handler = newSignalListener('SIGINT', listenersBefore)

    releaseCleanup?.()
    await expect(pending).resolves.toBe('added')
    expect(process.listeners('SIGINT')).not.toContain(handler)
  })
})
