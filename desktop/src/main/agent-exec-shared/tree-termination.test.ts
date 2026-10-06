import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { WindowsDescendantSnapshot } from '../windows-descendant-exit-verification'
import {
  inspectTreeAfterRootExit,
  terminateChildTree,
  type TreeTerminationDeps
} from './tree-termination'

type FakeChild = ChildProcess & { markExited: (code?: number | null) => void }

function fakeChild(options: { exited?: boolean } = {}): FakeChild {
  const emitter = new EventEmitter()
  let exitCode: number | null = options.exited === true ? 0 : null
  // Accessors, not copied values: Object.assign would freeze the getter's first result.
  Object.defineProperties(emitter, {
    pid: { value: 4242 },
    exitCode: { get: () => exitCode },
    signalCode: { get: () => null }
  })
  const child = Object.assign(emitter, {
    kill: vi.fn(() => true),
    markExited(code: number | null = 1) {
      exitCode = code
      emitter.emit('exit', code, null)
    }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test double implements only the members terminateChildTree reads (pid, exitCode, signalCode, once/off).
  return child as unknown as FakeChild
}

const FAST = { graceMs: 40, verifyMs: 40 }
const SNAPSHOT: WindowsDescendantSnapshot = {
  root: { pid: 4242, creationTimeMs: 1 },
  descendants: [{ pid: 5000, creationTimeMs: 2 }],
  unidentifiedCount: 0,
  capturedAtMs: 3
}

function deps(overrides: Partial<TreeTerminationDeps>): Partial<TreeTerminationDeps> {
  return {
    signalTree: async () => true,
    forceTree: async () => true,
    captureWindowsTree: async () => null,
    verifyWindowsTree: async () => 'unverifiable',
    groupExists: () => false,
    ...overrides
  }
}

describe('terminateChildTree on POSIX', () => {
  it('forces the group kill even when the root exits right after the first signal', async () => {
    const child = fakeChild()
    const signalTree = vi.fn(async () => {
      setTimeout(() => child.markExited(1), 5)
      return true
    })
    const forceTree = vi.fn(async () => true)
    const outcome = await terminateChildTree(child, {
      ...FAST,
      deps: deps({ platform: 'linux', signalTree, forceTree })
    })
    expect(forceTree).toHaveBeenCalledOnce()
    expect(outcome).toEqual({
      verdict: 'exited',
      method: 'posix_group_quiescence',
      rootExited: true,
      escalatedToForce: true
    })
  })

  it('does not trust a delivered SIGTERM: a descendant that survives the forced kill is unverifiable', async () => {
    const child = fakeChild()
    const signalTree = vi.fn(async () => {
      setTimeout(() => child.markExited(0), 5)
      return true
    })
    const outcome = await terminateChildTree(child, {
      ...FAST,
      deps: deps({ platform: 'linux', signalTree, forceTree: async () => false })
    })
    expect(outcome).toMatchObject({
      verdict: 'unverifiable',
      method: 'posix_group_quiescence',
      rootExited: true
    })
  })

  it('reports live when the root never exits, whatever the kill calls claim', async () => {
    const outcome = await terminateChildTree(fakeChild(), {
      ...FAST,
      deps: deps({ platform: 'linux' })
    })
    expect(outcome).toMatchObject({ verdict: 'live', rootExited: false, escalatedToForce: true })
  })

  it('treats a throwing kill primitive as unverified', async () => {
    const child = fakeChild()
    const outcome = await terminateChildTree(child, {
      ...FAST,
      deps: deps({
        platform: 'linux',
        signalTree: async () => {
          throw new Error('kill unavailable')
        },
        forceTree: async () => {
          child.markExited(1)
          throw new Error('kill unavailable')
        }
      })
    })
    expect(outcome).toMatchObject({ verdict: 'unverifiable', rootExited: true })
  })

  it('sweeps the group of a root that already exited without sending a first signal', async () => {
    const signalTree = vi.fn(async () => true)
    const forceTree = vi.fn(async () => true)
    const outcome = await terminateChildTree(fakeChild({ exited: true }), {
      ...FAST,
      deps: deps({ platform: 'linux', signalTree, forceTree })
    })
    expect(signalTree).not.toHaveBeenCalled()
    expect(forceTree).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({ verdict: 'exited', rootExited: true })
  })
})

describe('terminateChildTree on win32', () => {
  it('captures the descendants before it kills anything', async () => {
    const order: string[] = []
    const child = fakeChild()
    await terminateChildTree(child, {
      ...FAST,
      deps: deps({
        platform: 'win32',
        captureWindowsTree: async () => {
          order.push('capture')
          return SNAPSHOT
        },
        signalTree: async () => {
          order.push('kill')
          child.markExited(1)
          return true
        }
      })
    })
    expect(order).toEqual(['capture', 'kill'])
  })

  it.each([
    ['exited', 'exited'],
    ['live', 'live'],
    ['unverifiable', 'unverifiable']
  ] as const)('takes the tree verdict from the descendant snapshot: %s', async (seen, expected) => {
    const child = fakeChild()
    const verifyWindowsTree = vi.fn(async () => seen)
    const outcome = await terminateChildTree(child, {
      ...FAST,
      deps: deps({
        platform: 'win32',
        captureWindowsTree: async () => SNAPSHOT,
        signalTree: async () => {
          child.markExited(1)
          return true
        },
        verifyWindowsTree
      })
    })
    expect(verifyWindowsTree).toHaveBeenCalledWith(SNAPSHOT, FAST.verifyMs)
    expect(outcome).toEqual({
      verdict: expected,
      method: 'windows_descendant_snapshot',
      rootExited: true,
      escalatedToForce: false
    })
  })

  it('never calls the tree exited from a successful taskkill alone', async () => {
    const child = fakeChild()
    const verifyWindowsTree = vi.fn(async () => 'exited' as const)
    const outcome = await terminateChildTree(child, {
      ...FAST,
      deps: deps({
        platform: 'win32',
        captureWindowsTree: async () => null,
        signalTree: async () => {
          child.markExited(1)
          return true
        },
        verifyWindowsTree
      })
    })
    expect(verifyWindowsTree).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ verdict: 'unverifiable', method: 'root_exit_only' })
  })

  it('still kills the tree when the descendant capture throws or hangs', async () => {
    for (const captureWindowsTree of [
      async (): Promise<WindowsDescendantSnapshot | null> => {
        throw new Error('table unreadable')
      },
      (): Promise<WindowsDescendantSnapshot | null> => new Promise(() => {})
    ]) {
      const child = fakeChild()
      const signalTree = vi.fn(async () => {
        child.markExited(1)
        return true
      })
      const outcome = await terminateChildTree(child, {
        ...FAST,
        deps: deps({ platform: 'win32', captureWindowsTree, signalTree }),
        captureMs: 20
      })
      expect(signalTree).toHaveBeenCalledOnce()
      expect(outcome).toMatchObject({ verdict: 'unverifiable', method: 'root_exit_only' })
    }
  })

  it('escalates to the forced kill when the root outlives the grace period', async () => {
    const child = fakeChild()
    const forceTree = vi.fn(async () => {
      setTimeout(() => child.markExited(null), 5)
      return true
    })
    const outcome = await terminateChildTree(child, {
      ...FAST,
      deps: deps({
        platform: 'win32',
        captureWindowsTree: async () => SNAPSHOT,
        verifyWindowsTree: async () => 'exited',
        forceTree
      })
    })
    expect(forceTree).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({ verdict: 'exited', rootExited: true, escalatedToForce: true })
  })

  it('reports live when the root never exits', async () => {
    const outcome = await terminateChildTree(fakeChild(), {
      ...FAST,
      deps: deps({ platform: 'win32', captureWindowsTree: async () => SNAPSHOT })
    })
    expect(outcome).toMatchObject({ verdict: 'live', rootExited: false, escalatedToForce: true })
  })

  it('does not claim anything about the tree of a root that had already exited', async () => {
    const captureWindowsTree = vi.fn(async () => SNAPSHOT)
    const signalTree = vi.fn(async () => true)
    const outcome = await terminateChildTree(fakeChild({ exited: true }), {
      ...FAST,
      deps: deps({ platform: 'win32', captureWindowsTree, signalTree })
    })
    expect(captureWindowsTree).not.toHaveBeenCalled()
    expect(signalTree).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      verdict: 'unverifiable',
      method: 'root_exit_only',
      rootExited: true,
      escalatedToForce: false
    })
  })
})

describe('inspectTreeAfterRootExit', () => {
  it('reports a surviving POSIX process group as a helper that outlived the root', () => {
    expect(
      inspectTreeAfterRootExit(fakeChild({ exited: true }), {
        platform: 'linux',
        groupExists: () => true
      })
    ).toEqual({ helperAlive: true, proof: { verdict: 'live', method: 'posix_group_probe' } })
  })

  it('reports an empty POSIX process group as exited, with the probe as the method', () => {
    expect(
      inspectTreeAfterRootExit(fakeChild({ exited: true }), {
        platform: 'linux',
        groupExists: () => false
      })
    ).toEqual({ helperAlive: false, proof: { verdict: 'exited', method: 'posix_group_probe' } })
  })

  it('can only report root exit on win32, never a verified tree', () => {
    expect(
      inspectTreeAfterRootExit(fakeChild({ exited: true }), {
        platform: 'win32',
        groupExists: () => false
      })
    ).toEqual({ helperAlive: false, proof: { verdict: 'unverifiable', method: 'root_exit_only' } })
  })
})
