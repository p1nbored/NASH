import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentHarness, type AgentHarness } from './dot-remote-agent.test-fixture'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'

// H1: a poll that throws (a synchronous SQLite call inside the cycle) is logged by code and polled
// again with backoff; it never ends the polling loop or rejects tick().

function sqliteFailure(): Error {
  return Object.assign(new Error('Fixture: database busy at C:\\private\\nash.db'), {
    code: 'SQLITE_BUSY'
  })
}

describe('dot remote agent: a poll that throws', () => {
  let h: AgentHarness
  beforeEach(async () => {
    h = createAgentHarness()
    await h.pair()
  })
  afterEach(() => h.close())

  const leases = () => h.site.calls.filter((call) => call === 'POST /nash/v1/inbox/lease').length

  it('logs the code, polls again with backoff and returns to the idle cadence once it works', async () => {
    vi.spyOn(getDotRemoteOutboxStore(h.owner), 'pending')
      .mockImplementationOnce(() => {
        throw sqliteFailure()
      })
      .mockImplementationOnce(() => {
        throw sqliteFailure()
      })
    await h.timers.advance(30_000)
    expect(h.log).toHaveBeenCalledWith({ event: 'dot_remote_tick_failed', code: 'SQLITE_BUSY' })
    const before = leases()
    await h.timers.advance(5_000)
    expect(leases() - before).toBe(1)
    await h.timers.advance(10_000)
    expect(leases() - before).toBe(2)
    await h.timers.advance(30_000)
    expect(leases() - before).toBe(3)
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('private')
  })

  it('resolves tick() instead of rejecting it', async () => {
    vi.spyOn(getDotRemoteOutboxStore(h.owner), 'pending').mockImplementationOnce(() => {
      throw sqliteFailure()
    })
    await expect(h.agent.tick()).resolves.toBeUndefined()
    expect(h.log).toHaveBeenCalledWith({ event: 'dot_remote_tick_failed', code: 'SQLITE_BUSY' })
  })

  it('logs an unexpected throw without a code as unexpected', async () => {
    vi.spyOn(getDotRemoteOutboxStore(h.owner), 'pending').mockImplementationOnce(() => {
      throw new Error('Fixture: C:\\private\\path')
    })
    await h.agent.tick()
    expect(h.log).toHaveBeenCalledWith({ event: 'dot_remote_tick_failed', code: 'unexpected' })
  })
})

describe('dot remote agent: an issued pairing that could not be installed', () => {
  it('logs why, and never sends the new pairing heartbeat', async () => {
    const h = createAgentHarness()
    try {
      await h.configure()
      await h.agent.startPairing()
      h.credentials.failDeviceWrites(true)
      h.site.approve()
      await h.timers.advance(5_000)
      expect(h.log).toHaveBeenCalledWith({
        event: 'dot_remote_pairing_not_installed',
        code: 'device_credential_unsaved'
      })
      expect(h.site.calls).not.toContain('POST /nash/v1/heartbeat')
    } finally {
      h.close()
    }
  })
})
