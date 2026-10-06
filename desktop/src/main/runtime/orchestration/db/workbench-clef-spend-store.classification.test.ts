import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClassificationSpend,
  type ClassificationSpendSubject
} from '../../../clef/clef-classification-spend'
import { createClefSpendLedger } from '../../../clef/clef-spend-ledger'
import {
  createClassificationDbHarness,
  proposeFixtureTask,
  type ClassificationDbHarness
} from '../../task-classification/classification-db.test-fixture'
import { getTaskClassificationStore } from './task-classification-store'
import { WorkbenchClefSpendStore } from './workbench-clef-spend-store'

// FIXTURE_ONLY: synthetic ids and amounts; the clock sits on one fixed UTC day.
const NOW = Date.parse('2026-10-05T10:00:00.000Z')
const DAY = '2026-10-05'
const TOKENS = 700

describe('classification spend in the Workbench spend table (D-016 re-key)', () => {
  let harness: ClassificationDbHarness
  let spend: WorkbenchClefSpendStore

  beforeEach(() => {
    harness = createClassificationDbHarness()
    spend = new WorkbenchClefSpendStore(harness.owner.db)
  })
  afterEach(() => harness.owner.close())

  function classificationSpend() {
    let ids = 0
    const ledger = createClefSpendLedger({
      store: spend,
      now: () => NOW,
      newId: () => `spend_fixture_${++ids}`
    })
    return createClassificationSpend({ store: spend, ledger })
  }

  function subjectOf(taskId: string): ClassificationSpendSubject {
    return { runId: harness.runId, taskId, requestId: harness.requestId }
  }

  it('numbers spend rows per request so three TaskSpecs of one run all reserve', () => {
    const tasks = [1, 2, 3].map(() => proposeFixtureTask(harness).taskId)
    const reserve = classificationSpend()
    const results = tasks.map((taskId) => reserve.reserve(subjectOf(taskId), TOKENS))
    expect(results.map((result) => result.ok)).toEqual([true, true, true])
    const rows = harness.owner.db
      .prepare('SELECT request_id, attempt, purpose FROM workbench_clef_spend ORDER BY sequence')
      .all()
    expect(rows).toEqual(
      [1, 2, 3].map((attempt) => ({
        request_id: harness.requestId,
        attempt,
        purpose: 'production'
      }))
    )
    expect(tasks.map((taskId) => spend.countAttemptsForSubject(taskId))).toEqual([1, 1, 1])
    expect(spend.nextAttemptForRequest(harness.requestId)).toBe(4)
    expect('countClassificationsForUtcDay' in spend).toBe(false)
  })

  it('caps one TaskSpec at two billed attempts while its request has more', () => {
    const first = proposeFixtureTask(harness).taskId
    const second = proposeFixtureTask(harness).taskId
    const reserve = classificationSpend()
    expect(reserve.reserve(subjectOf(second), TOKENS).ok).toBe(true)
    expect(reserve.reserve(subjectOf(first), TOKENS).ok).toBe(true)
    expect(reserve.reserve(subjectOf(first), TOKENS).ok).toBe(true)
    expect(reserve.reserve(subjectOf(first), TOKENS)).toEqual({
      ok: false,
      refusal: 'request_attempts_exhausted'
    })
    const links = harness.owner.db
      .prepare('SELECT task_id, attempt FROM clef_classification_spend ORDER BY rowid')
      .all()
    expect(links).toEqual([
      { task_id: second, attempt: 1 },
      { task_id: first, attempt: 1 },
      { task_id: first, attempt: 2 }
    ])
  })

  it('records every classification of the day with no daily cap (D-022)', () => {
    const tasks = Array.from({ length: 5 }, () => proposeFixtureTask(harness).taskId)
    const reserve = classificationSpend()
    for (const taskId of tasks) {
      expect(reserve.reserve(subjectOf(taskId), TOKENS).ok).toBe(true)
    }
    const days = harness.owner.db
      .prepare(
        'SELECT spend.utc_day AS day FROM clef_classification_spend link JOIN workbench_clef_spend spend ON spend.reservation_id = link.reservation_id'
      )
      .all()
    expect(days).toEqual(tasks.map(() => ({ day: DAY })))
  })

  it('rolls the spend row back when the link cannot be written', () => {
    const taskId = proposeFixtureTask(harness).taskId
    const reserve = classificationSpend()
    // Why: a TaskSpec of another run breaks the link's composite key, after the spend row was inserted.
    expect(() =>
      reserve.reserve({ ...subjectOf(taskId), runId: 'run_fixture_other' }, TOKENS)
    ).toThrow()
    expect(
      harness.owner.db.prepare('SELECT count(*) AS n FROM workbench_clef_spend').get()?.n
    ).toBe(0)
    expect(spend.countAttemptsForSubject(taskId)).toBe(0)
  })

  it('writes links only inside the store transaction', () => {
    expect(() =>
      spend.insertClassificationLink({
        reservationId: 'spend_fixture_x',
        runId: harness.runId,
        taskId: 'task_fixture_x',
        attempt: 1
      })
    ).toThrow(/transaction/)
  })

  it('lists the latest billed attempt of a TaskSpec that no classification records', () => {
    const recorded = proposeFixtureTask(harness).taskId
    const interrupted = proposeFixtureTask(harness).taskId
    const reserve = classificationSpend()
    const done = reserve.reserve(subjectOf(recorded), TOKENS)
    reserve.reserve(subjectOf(interrupted), TOKENS)
    const lost = reserve.reserve(subjectOf(interrupted), TOKENS)
    if (!done.ok || !lost.ok) {
      throw new Error('fixture reservations must succeed')
    }
    getTaskClassificationStore(harness.owner).record({
      taskId: recorded,
      attempt: 1,
      outcome: 'blocked',
      detail: 'transient_exhausted',
      needsDelegation: null,
      taskType: null,
      answers: null,
      bundleSha256: null,
      taxonomyVersion: null,
      profileSha256: null,
      classifierModel: null,
      rawResponseId: null,
      spendReservationId: done.reservation.reservationId,
      timestamp: '2026-10-05T10:00:01.000Z'
    })
    expect(spend.listUnrecordedClassificationAttempts(10)).toEqual([
      {
        reservationId: lost.reservation.reservationId,
        runId: harness.runId,
        taskId: interrupted,
        attempt: 2
      }
    ])
  })
})
