import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRelayHarness,
  FIXTURE_EVIDENCE,
  FIXTURE_START_MS,
  relayRequest,
  type RelayHarness
} from './permission-relay.test-fixture'

describe('permission source lifetime across maintenance and restart', () => {
  let harness: RelayHarness
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_START_MS })
    harness = createRelayHarness()
  })
  afterEach(() => {
    harness.service.dispose()
    harness.owner.close()
    vi.useRealTimers()
  })

  function request(): string {
    const result = harness.service.request(FIXTURE_EVIDENCE, relayRequest())
    if (result.outcome !== 'relayed') {
      throw new Error('Expected relay')
    }
    return result.decisionId
  }

  it('lets the original hook consume a settled decision after the maintenance tick', async () => {
    const decisionId = request()
    harness.service.answerFromDesktop({ decisionId, decision: 'allow' })
    await harness.service.tick()

    await expect(
      harness.service.wait(FIXTURE_EVIDENCE, { decisionId, waitMs: 1 })
    ).resolves.toMatchObject({
      state: 'decided',
      hookOutput: { hookSpecificOutput: { decision: { behavior: 'allow' } } }
    })
  })

  it('does not treat a persisted record after restart as proof that its original hook is waiting', async () => {
    const decisionId = request()
    const restarted = harness.newService()
    try {
      restarted.start()
      expect(restarted.answerFromDesktop({ decisionId, decision: 'allow' })).toMatchObject({
        outcome: 'closed'
      })
      await expect(restarted.wait(FIXTURE_EVIDENCE, { decisionId, waitMs: 1 })).resolves.toEqual({
        state: 'no_decision'
      })
      expect(harness.store.get(decisionId)?.status).toBe('pending')
    } finally {
      restarted.dispose()
    }
  })

  it('refuses a late desktop answer once the recorded source owner closes', () => {
    const decisionId = request()
    harness.owner.db
      .prepare(
        "UPDATE workflow_runs SET status = 'canceled', end_reason = 'fixture_closed', ended_at = '2026-10-05T00:00:11.000Z' WHERE run_id = 'run_fixture01'"
      )
      .run()
    expect(harness.service.answerFromDesktop({ decisionId, decision: 'allow' })).toMatchObject({
      outcome: 'closed'
    })
    expect(harness.store.get(decisionId)?.status).toBe('pending')
  })
})
