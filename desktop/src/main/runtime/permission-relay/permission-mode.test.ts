import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRelayHarness,
  FIXTURE_EVIDENCE,
  FIXTURE_START_MS,
  relayRequest,
  type RelayHarness
} from './permission-relay.test-fixture'

describe('permission review mode', () => {
  let h: RelayHarness
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_START_MS })
    h = createRelayHarness()
  })
  afterEach(() => {
    h.service.dispose()
    h.owner.close()
    vi.useRealTimers()
  })
  function request() {
    const result = h.service.request(
      FIXTURE_EVIDENCE,
      relayRequest({ toolName: 'Read', toolInput: { file_path: '/fixture/repo/README.md' } })
    )
    if (result.outcome !== 'relayed') {
      throw new Error('Expected relay')
    }
    return result.decisionId
  }

  it.each(['manual', 'yolo'] as const)('leaves new %s prompts in the native CLI', (mode) => {
    h.setPermissionMode(mode)
    expect(() => request()).toThrow('Automatic permission review is disabled')
    expect(h.store.listPending('run_fixture01', 20)).toEqual([])
  })

  it('hides queued reviews and refuses an old Dot decision after switching to Manual', () => {
    const decisionId = request()
    h.setPermissionMode('manual')
    expect(h.service.listForDot('run_fixture01', { limit: 20 })).toEqual([])
    expect(h.service.listForPrimary(FIXTURE_EVIDENCE).decisions).toEqual([])
    expect(() => h.service.answerFromDot({ decisionId, decision: 'allow' })).toThrow(
      'Automatic permission review is disabled'
    )
    expect(h.store.get(decisionId)?.status).toBe('pending')
    expect(h.service.listForDesktop({}).decisions[0]?.answerable).toBe(false)
  })

  it('does not send an already queued agent approval to a hook after switching to Manual', async () => {
    const decisionId = request()
    h.service.answerFromDot({ decisionId, decision: 'allow' })
    h.setPermissionMode('manual')
    await expect(h.service.wait(FIXTURE_EVIDENCE, { decisionId, waitMs: 1 })).resolves.toEqual({
      state: 'no_decision'
    })
  })

  it('ends an in-flight hook wait when Auto is disabled', async () => {
    const decisionId = request()
    let state: string | undefined
    const waiting = h.service
      .wait(FIXTURE_EVIDENCE, { decisionId, waitMs: 10_000 })
      .then((result) => {
        state = result.state
      })
    h.setPermissionMode('manual')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(state).toBe('no_decision')
    await vi.advanceTimersByTimeAsync(10_000)
    await waiting
  })
})
