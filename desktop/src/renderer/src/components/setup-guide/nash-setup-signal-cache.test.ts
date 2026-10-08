import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), agents: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.rpc }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ ensureDetectedAgents: mocks.agents }) }
}))

import {
  readNashSetupSignalState,
  refreshNashSetupSignals,
  resetNashSetupSignalStateForTests,
  subscribeNashSetupSignalState
} from './nash-setup-signal-cache'

const ALL_DONE = {
  primaryCliDetected: true,
  clefConnected: true,
  dotConnected: true,
  hasWorkbenchRun: true
}

describe('NASH setup signal cache', () => {
  afterEach(() => {
    resetNashSetupSignalStateForTests()
  })

  it('starts unchecked and settles with the read values', async () => {
    const listener = vi.fn()
    subscribeNashSetupSignalState(listener)
    expect(readNashSetupSignalState().checked).toBe(false)

    await refreshNashSetupSignals({ read: async () => ALL_DONE, now: 10_000 })

    expect(readNashSetupSignalState()).toEqual({ ...ALL_DONE, checked: true })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('shares one read between callers that refresh at the same time', async () => {
    const read = vi.fn(async () => ALL_DONE)

    await Promise.all([
      refreshNashSetupSignals({ read, now: 10_000 }),
      refreshNashSetupSignals({ read, now: 10_000 }),
      refreshNashSetupSignals({ read, now: 10_001 })
    ])

    expect(read).toHaveBeenCalledOnce()
  })

  it('skips a refresh right after a read unless forced, and allows one later', async () => {
    const read = vi.fn(async () => ALL_DONE)

    await refreshNashSetupSignals({ read, now: 10_000 })
    await refreshNashSetupSignals({ read, now: 10_500 })
    expect(read).toHaveBeenCalledOnce()

    await refreshNashSetupSignals({ read, now: 10_600, force: true })
    expect(read).toHaveBeenCalledTimes(2)

    await refreshNashSetupSignals({ read, now: 20_000 })
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('settles as checked and not done when the read fails', async () => {
    await refreshNashSetupSignals({
      read: async () => {
        throw new Error('runtime unavailable')
      },
      now: 10_000
    })

    expect(readNashSetupSignalState()).toEqual({
      checked: true,
      primaryCliDetected: false,
      clefConnected: false,
      dotConnected: false,
      hasWorkbenchRun: false
    })
  })
})

describe('setup signal recovery', () => {
  afterEach(() => {
    resetNashSetupSignalStateForTests()
    vi.resetAllMocks()
  })
  it('keeps previously confirmed progress during transient RPC and agent detection failures', async () => {
    await refreshNashSetupSignals({ read: async () => ALL_DONE })
    mocks.rpc.mockRejectedValue(new Error('offline'))
    mocks.agents.mockRejectedValue(new Error('offline'))
    await refreshNashSetupSignals({ force: true })
    expect(readNashSetupSignalState()).toEqual({ ...ALL_DONE, checked: true })
  })

  it('runs a fresh read after an in-flight read for an explicit check and coalesces repeat clicks', async () => {
    let finish: (value: typeof ALL_DONE) => void = () => {
      throw new Error('read has not started')
    }
    const firstRead = new Promise<typeof ALL_DONE>((resolve) => {
      finish = resolve
    })
    const first = refreshNashSetupSignals({ read: () => firstRead })
    const read = vi.fn(async () => ALL_DONE)
    const forced = refreshNashSetupSignals({ force: true, read })
    const repeated = refreshNashSetupSignals({ force: true, read })
    finish({ ...ALL_DONE, primaryCliDetected: false })
    await Promise.all([first, forced, repeated])
    expect(read).toHaveBeenCalledOnce()
    expect(readNashSetupSignalState().primaryCliDetected).toBe(true)
  })

  it('accepts a successful fresh detection that reports a removed CLI', async () => {
    await refreshNashSetupSignals({ read: async () => ALL_DONE })
    mocks.rpc.mockRejectedValue(new Error('offline'))
    mocks.agents.mockResolvedValue([])
    await refreshNashSetupSignals({ force: true })
    expect(readNashSetupSignalState()).toEqual({
      ...ALL_DONE,
      checked: true,
      primaryCliDetected: false
    })
  })
})
