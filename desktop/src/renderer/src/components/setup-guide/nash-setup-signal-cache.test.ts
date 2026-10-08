import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

import {
  readNashSetupSignalState,
  refreshNashSetupSignals,
  resetNashSetupSignalStateForTests,
  subscribeNashSetupSignalState
} from './nash-setup-signal-cache'

const ALL_DONE = {
  claudeCodeDetected: true,
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
      claudeCodeDetected: false,
      clefConnected: false,
      dotConnected: false,
      hasWorkbenchRun: false
    })
  })
})
