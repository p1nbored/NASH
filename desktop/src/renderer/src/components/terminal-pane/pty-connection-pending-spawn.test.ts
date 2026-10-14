import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushAsyncTicks, createDeferred } from './pty-connection-test-async'
import {
  createMockTransport,
  createPane,
  createManager,
  type MockTransport
} from './pty-connection-test-pane-fixtures'
import { buildPaneConnectionDeps } from './pty-connection-test-deps'
import { createInitialStoreState } from './pty-connection-test-store-fixtures'
import type { StoreState } from './pty-connection-test-store-state'
import {
  pendingSpawnByPaneKey,
  pendingSpawnGenerationByPaneKey
} from './pty-connection/pty-connect-limits'
import {
  installTerminalTestGlobals,
  restoreTerminalTestGlobals
} from './pty-connection-test-environment'

const {
  resetAndRefreshAllTerminalWebglAtlases,
  scheduleTerminalWebglAtlasRecovery,
  scheduleRuntimeGraphSync,
  shouldSeedCacheTimerOnInitialTitle,
  toastInfo,
  notifyCodexPaneBoundForStaleSweep
} = vi.hoisted(() => ({
  resetAndRefreshAllTerminalWebglAtlases: vi.fn(),
  scheduleTerminalWebglAtlasRecovery: vi.fn(),
  scheduleRuntimeGraphSync: vi.fn(),
  shouldSeedCacheTimerOnInitialTitle: vi.fn(() => false),
  toastInfo: vi.fn(),
  notifyCodexPaneBoundForStaleSweep: vi.fn()
}))

let mockStoreState: StoreState
let transportFactoryQueue: MockTransport[] = []
let createdTransportOptions: Record<string, unknown>[] = []
let storeSubscribers: ((state: StoreState) => void)[] = []

vi.mock('@/runtime/sync-runtime-graph', () => ({
  scheduleRuntimeGraphSync
}))

vi.mock('@/lib/pane-manager/pane-manager-registry', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resetAndRefreshAllTerminalWebglAtlases
}))

vi.mock('./terminal-webgl-atlas-recovery', () => ({
  scheduleTerminalWebglAtlasRecovery
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mockStoreState,
    subscribe: (listener: (state: StoreState) => void) => {
      storeSubscribers.push(listener)
      return () => {
        storeSubscribers = storeSubscribers.filter((candidate) => candidate !== listener)
      }
    }
  }
}))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const { buildAgentStatusModuleMock } = await import('./pty-connection-test-environment')
  return buildAgentStatusModuleMock(await importOriginal<Record<string, unknown>>())
})

vi.mock('./cache-timer-seeding', () => ({
  shouldSeedCacheTimerOnInitialTitle
}))

vi.mock('sonner', () => ({
  toast: {
    info: toastInfo
  }
}))

vi.mock('@/lib/codex-stale-pane-sweep', () => ({
  notifyCodexPaneBoundForStaleSweep
}))

// Why: the working→idle test invokes the real useNotificationDispatch hook outside React, so useCallback must pass through (safe suite-wide: no test here renders React).
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>()
  return {
    ...actual,
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn
  }
})

vi.mock('./pty-transport', () => ({
  createIpcPtyTransport: vi.fn((options: Record<string, unknown>) => {
    createdTransportOptions.push(options)
    const nextTransport = transportFactoryQueue.shift()
    if (!nextTransport) {
      throw new Error('No mock transport queued')
    }
    return nextTransport
  })
}))

vi.mock('./remote-runtime-pty-transport', () => ({
  createRemoteRuntimePtyTransport: vi.fn(
    (_environmentId: string, options: Record<string, unknown>) => {
      createdTransportOptions.push(options)
      const nextTransport = transportFactoryQueue.shift()
      if (!nextTransport) {
        throw new Error('No mock transport queued')
      }
      return nextTransport
    }
  )
}))

// Why: stub only getEagerPtyBufferHandle so tests can simulate a live eager buffer (adopt path) without standing up the real IPC dispatcher.
vi.mock('./pty-dispatcher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getEagerPtyBufferHandle: vi.fn(() => undefined)
  }
})

function createDeps(overrides: Record<string, unknown> = {}) {
  return buildPaneConnectionDeps(() => mockStoreState, overrides)
}

describe('connectPanePty', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    transportFactoryQueue = []
    createdTransportOptions = []
    storeSubscribers = []
    mockStoreState = createInitialStoreState(() => mockStoreState)
    await installTerminalTestGlobals()
  })

  afterEach(async () => {
    pendingSpawnByPaneKey.clear()
    pendingSpawnGenerationByPaneKey.clear()
    await restoreTerminalTestGlobals()
  })

  it('does not retain PTY connect diagnostics unless e2e debug state is enabled', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const transport = createMockTransport()
    transportFactoryQueue.push(transport)
    mockStoreState = {
      ...mockStoreState,
      tabsByWorktree: { 'wt-1': [{ id: 'tab-1', ptyId: null }] },
      ptyIdsByTabId: { 'tab-1': [] }
    }

    connectPanePty(createPane(1) as never, createManager(1) as never, createDeps() as never)
    await flushAsyncTicks()

    expect((globalThis as Record<string, unknown>).__ptyConnectDiag).toBeUndefined()
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('[pty-connect]'))
    logSpy.mockRestore()
  }, 30_000)

  it('does not hold a successor behind a canceled spawn serializer declaration', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const declaration = createDeferred<number>()
    const spawn = createDeferred<null>()
    const transport = createMockTransport()
    transport.connect.mockReturnValueOnce(spawn.promise)
    transportFactoryQueue.push(transport)
    mockStoreState = {
      ...mockStoreState,
      tabsByWorktree: { 'wt-1': [{ id: 'tab-1', ptyId: null }] },
      ptyIdsByTabId: { 'tab-1': [] }
    }
    vi.mocked(window.api.pty.declarePendingPaneSerializer).mockReturnValueOnce(declaration.promise)

    const binding = connectPanePty(
      createPane(1) as never,
      createManager(1) as never,
      createDeps() as never
    )
    await flushAsyncTicks(12)
    binding.dispose()
    spawn.resolve(null)
    await flushAsyncTicks(12)

    expect(pendingSpawnByPaneKey.size).toBe(0)
    expect(window.api.pty.clearPendingPaneSerializer).not.toHaveBeenCalled()

    declaration.resolve(7)
    await flushAsyncTicks(12)

    expect(window.api.pty.clearPendingPaneSerializer).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      7
    )
  })

  it('joins a successful pending spawn across a StrictMode remount', async () => {
    const { connectPanePty } = await import('./pty-connection')
    const pendingSpawn = createDeferred<string>()
    const firstTransport = createMockTransport()
    firstTransport.connect.mockReturnValueOnce(pendingSpawn.promise)
    const remountTransport = createMockTransport()
    transportFactoryQueue.push(firstTransport, remountTransport)
    mockStoreState = {
      ...mockStoreState,
      tabsByWorktree: { 'wt-1': [{ id: 'tab-1', ptyId: null, generation: 7 }] },
      ptyIdsByTabId: { 'tab-1': [] }
    }
    const remountDeps = createDeps()

    const firstBinding = connectPanePty(
      createPane(1) as never,
      createManager(1) as never,
      createDeps() as never
    )
    await flushAsyncTicks()
    firstBinding.dispose()
    connectPanePty(createPane(1) as never, createManager(1) as never, remountDeps as never)
    await flushAsyncTicks()

    expect(firstTransport.connect).toHaveBeenCalledOnce()
    expect(remountTransport.connect).not.toHaveBeenCalled()

    const spawnedPtyId = 'pty-strict-mode'
    pendingSpawn.resolve(spawnedPtyId)
    await flushAsyncTicks(12)

    expect(remountTransport.attach).toHaveBeenCalledWith(
      expect.objectContaining({ existingPtyId: spawnedPtyId })
    )
    expect(remountDeps.updateTabPtyId).toHaveBeenCalledWith('tab-1', spawnedPtyId)
  })
})
