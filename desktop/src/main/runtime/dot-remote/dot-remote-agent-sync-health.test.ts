import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentHarness, type AgentHarness } from './dot-remote-agent.test-fixture'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'

// TypeScript review H1 follow-up: while polls keep throwing, the state still reads connected, so
// the status says sync is failing (how many polls in a row, the last code, since when).

function sqliteFailure(): Error {
  return Object.assign(new Error('Fixture: database busy at C:\\private\\nash.db'), {
    code: 'SQLITE_BUSY'
  })
}

describe('dot remote agent: sync health in the status', () => {
  let h: AgentHarness
  beforeEach(async () => {
    h = createAgentHarness()
    await h.pair()
  })
  afterEach(() => h.close())

  function failNextPolls(count: number): void {
    const pending = vi.spyOn(getDotRemoteOutboxStore(h.owner), 'pending')
    for (let n = 0; n < count; n += 1) {
      pending.mockImplementationOnce(() => {
        throw sqliteFailure()
      })
    }
  }

  it('reports sync failing after three polls in a row throw, then clears it after a good poll', async () => {
    expect(h.agent.status()).toMatchObject({ state: 'connected', syncFailure: null })
    failNextPolls(3)
    await h.timers.advance(30_000)
    const firstFailureAt = new Date(h.clock.now()).toISOString()
    await h.timers.advance(5_000)
    expect(h.agent.status().syncFailure).toBeNull()
    await h.timers.advance(10_000)
    expect(h.agent.status()).toMatchObject({
      state: 'connected',
      syncFailure: { consecutiveFailures: 3, lastCode: 'SQLITE_BUSY', since: firstFailureAt }
    })
    expect(JSON.stringify(h.agent.status())).not.toContain('private')

    await h.timers.advance(20_000)
    expect(h.agent.status().syncFailure).toBeNull()
  })

  it('clears it when remote access is switched off', async () => {
    failNextPolls(3)
    await h.timers.advance(30_000 + 5_000 + 10_000)
    expect(h.agent.status().syncFailure).not.toBeNull()
    expect(h.agent.disable()).toMatchObject({ state: 'off', syncFailure: null })
  })

  it('counts only polls that throw in a row: a poll that reaches the Site ends the run', async () => {
    const pending = vi.spyOn(getDotRemoteOutboxStore(h.owner), 'pending')
    const throwNext = (count: number) => {
      for (let n = 0; n < count; n += 1) {
        pending.mockImplementationOnce(() => {
          throw sqliteFailure()
        })
      }
    }
    throwNext(2)
    await h.agent.tick()
    await h.agent.tick()
    h.fetch.mockImplementationOnce(async () => {
      throw new TypeError('Fixture: network down')
    })
    await h.agent.tick()
    throwNext(2)
    await h.agent.tick()
    await h.agent.tick()
    expect(h.agent.status().syncFailure).toBeNull()

    throwNext(1)
    await h.agent.tick()
    expect(h.agent.status().syncFailure).toMatchObject({ consecutiveFailures: 3 })
  })

  it('clears it when the pairing is revoked', async () => {
    failNextPolls(3)
    await h.timers.advance(30_000 + 5_000 + 10_000)
    expect(h.agent.status().syncFailure).not.toBeNull()
    expect((await h.agent.revoke()).status.syncFailure).toBeNull()
  })

  it('counts only polls that throw, not a Site that cannot be reached', async () => {
    h.fetch.mockImplementation(async () => {
      throw new TypeError('Fixture: network down')
    })
    await h.timers.advance(30_000 + 30_000 + 30_000 + 30_000)
    expect(h.agent.status()).toMatchObject({ state: 'offline', syncFailure: null })
  })
})
