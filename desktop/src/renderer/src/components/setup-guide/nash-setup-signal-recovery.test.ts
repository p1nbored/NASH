import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), agents: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.rpc }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ ensureDetectedAgents: mocks.agents }) }
}))
import {
  readNashSetupSignalState,
  refreshNashSetupSignals,
  resetNashSetupSignalStateForTests
} from './nash-setup-signal-cache'
const done = {
  claudeCodeDetected: true,
  clefConnected: true,
  dotConnected: true,
  hasWorkbenchRun: true
}
afterEach(() => {
  resetNashSetupSignalStateForTests()
  vi.resetAllMocks()
})

describe('setup signal recovery', () => {
  it('keeps previously confirmed progress during transient RPC and agent detection failures', async () => {
    await refreshNashSetupSignals({ read: async () => done })
    mocks.rpc.mockRejectedValue(new Error('offline'))
    mocks.agents.mockRejectedValue(new Error('offline'))
    await refreshNashSetupSignals({ force: true })
    expect(readNashSetupSignalState()).toEqual({ ...done, checked: true })
  })

  it('runs a fresh read after an in-flight read for an explicit check and coalesces repeat clicks', async () => {
    let finish: (value: typeof done) => void = () => {
      throw new Error('read has not started')
    }
    const firstRead = new Promise<typeof done>((resolve) => {
      finish = resolve
    })
    const first = refreshNashSetupSignals({ read: () => firstRead })
    const read = vi.fn(async () => done)
    const forced = refreshNashSetupSignals({ force: true, read })
    const repeated = refreshNashSetupSignals({ force: true, read })
    finish({ ...done, claudeCodeDetected: false })
    await Promise.all([first, forced, repeated])
    expect(read).toHaveBeenCalledOnce()
    expect(readNashSetupSignalState().claudeCodeDetected).toBe(true)
  })

  it('accepts a successful fresh detection that reports a removed CLI', async () => {
    await refreshNashSetupSignals({ read: async () => done })
    mocks.rpc.mockRejectedValue(new Error('offline'))
    mocks.agents.mockResolvedValue([])
    await refreshNashSetupSignals({ force: true })
    expect(readNashSetupSignalState()).toEqual({
      ...done,
      checked: true,
      claudeCodeDetected: false
    })
  })
})
