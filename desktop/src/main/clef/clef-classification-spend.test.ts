import { describe, expect, it } from 'vitest'
import * as classificationSpendModule from './clef-classification-spend'
import {
  createClassificationSpend,
  type ClassificationSpendSubject
} from './clef-classification-spend'
import { createClefSpendLedger } from './clef-spend-ledger'
import { createClefSpendMemoryStore } from './clef-spend-memory-store.test-fixture'

// FIXTURE_ONLY: synthetic run, task and request ids; the memory store stands in for the database.
const DAY_END = Date.parse('2026-10-04T23:59:59.999Z')
const TOKENS = 700

function subject(taskId: string, requestId = 'request-a'): ClassificationSpendSubject {
  return { runId: 'run-a', taskId, requestId }
}

function setup() {
  const store = createClefSpendMemoryStore()
  let ids = 0
  const ledger = createClefSpendLedger({
    store,
    now: () => DAY_END,
    newId: () => `spend-${++ids}`
  })
  const spend = createClassificationSpend({ store, ledger })
  return { store, ledger, spend }
}

describe('classification spend (D-016 re-key, D-022 without limits)', () => {
  it('has no daily classification cap and no cap status', () => {
    const exported = Object.keys(classificationSpendModule)
    expect(exported).not.toContain('CLEF_DAILY_CLASSIFICATIONS_DEFAULT')
    expect(exported).not.toContain('CLEF_CLASSIFICATION_SPEND_VALUES_AWAITING_USER_CONFIRMATION')
    expect(Object.keys(setup().spend)).toEqual(['reserve'])
  })

  it('records any number of classifications in a day', () => {
    const { spend, store } = setup()
    const results = Array.from({ length: 150 }, (_unused, index) =>
      spend.reserve(subject(`task-${index}`, `request-${index}`), TOKENS)
    )
    expect(results.every((result) => result.ok)).toBe(true)
    expect(store.rows()).toHaveLength(150)
    expect(store.links()).toHaveLength(150)
  })

  it('does not refuse the third TaskSpec of one request with the old per-request cap of 2', () => {
    const { spend, store } = setup()
    const results = ['task-1', 'task-2', 'task-3'].map((taskId) =>
      spend.reserve(subject(taskId), TOKENS)
    )
    expect(results.map((result) => result.ok)).toEqual([true, true, true])
    // Why: the spend rows keep UNIQUE(request_id, attempt), so their numbers run on per request.
    expect(store.rows().map((row) => [row.requestId, row.attempt])).toEqual([
      ['request-a', 1],
      ['request-a', 2],
      ['request-a', 3]
    ])
    expect(store.links().map((link) => [link.taskId, link.attempt])).toEqual([
      ['task-1', 1],
      ['task-2', 1],
      ['task-3', 1]
    ])
  })

  it('refuses a third billed attempt for one TaskSpec and inserts nothing for it', () => {
    const { spend, store } = setup()
    const first = spend.reserve(subject('task-1'), TOKENS)
    const second = spend.reserve(subject('task-1'), TOKENS)
    expect(first.ok && first.link.attempt).toBe(1)
    expect(second.ok && second.link.attempt).toBe(2)
    expect(spend.reserve(subject('task-1'), TOKENS)).toEqual({
      ok: false,
      refusal: 'request_attempts_exhausted'
    })
    expect(store.rows()).toHaveLength(2)
    expect(store.links()).toHaveLength(2)
    expect(spend.reserve(subject('task-2'), TOKENS).ok).toBe(true)
  })

  it('records classifications as production spend', () => {
    const { spend, ledger } = setup()
    expect(spend.reserve(subject('task-1'), TOKENS).ok).toBe(true)
    expect(ledger.snapshot().dailyNeuronsSpent).toBeGreaterThan(0)
    expect(ledger.snapshot().verificationMicroUsdSpent).toBe(0)
  })

  it('refuses a malformed estimate before linking anything', () => {
    const { spend, store } = setup()
    expect(spend.reserve(subject('task-1'), 0)).toEqual({
      ok: false,
      refusal: 'invalid_estimate'
    })
    expect(store.rows()).toEqual([])
    expect(store.links()).toEqual([])
  })

  it('leaves request-keyed and verification spend on the ledger rules', () => {
    const { ledger } = setup()
    const reserve = () =>
      ledger.reserve({ requestId: 'request-b', purpose: 'production', estimatedInputTokens: 500 })
    expect(reserve().ok).toBe(true)
    expect(reserve().ok).toBe(true)
    expect(reserve()).toEqual({ ok: false, refusal: 'request_attempts_exhausted' })
    const verification = ledger.reserve({
      requestId: null,
      purpose: 'verification',
      estimatedInputTokens: 500
    })
    expect(verification.ok && verification.reservation.attempt).toBeNull()
  })
})
