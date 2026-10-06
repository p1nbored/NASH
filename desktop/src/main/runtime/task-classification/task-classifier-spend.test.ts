import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import type { ClefTransportPort } from '../../clef/clef-call-ports'
import { transportResponding } from '../workbench-routing/clef-scripted-transport.test-fixture'
import { proposeFixtureTask } from './classification-db.test-fixture'
import {
  createClassifierHarness,
  transportAnsweringOnRetry,
  type ClassifierHarness,
  type ClassifierHarnessOptions
} from './classification-deps.test-fixture'
import { loadClassificationSubject } from './classification-subject'
import { createTaskClassifier } from './task-classifier'

// FIXTURE_ONLY: synthetic amounts on one fixed UTC day; scripted transports bill no real call.
const NEVER_ABORTED = new AbortController().signal

/** Two billed attempts that both fail transiently, as a flaky endpoint would. */
const transportFailingTwice: ClefTransportPort = async (request) => {
  for (const attempt of [1, 2]) {
    const permit = await request.beforeAttempt(attempt)
    if (!permit.proceed) {
      return {
        kind: 'blocked',
        blocker: permit.blocker ?? { reason: 'classifier_unavailable', detail: 'budget_exhausted' },
        latch: null,
        status: null,
        errorClass: 'vetoed',
        attempts: attempt - 1
      }
    }
  }
  return {
    kind: 'blocked',
    blocker: { reason: 'classifier_unavailable', detail: 'transient_exhausted' },
    latch: null,
    status: 503,
    errorClass: 'http_status',
    attempts: 2
  }
}

function spendRows(h: ClassifierHarness) {
  return h.db.owner.db
    .prepare(
      'SELECT reservation_id, request_id, attempt, state FROM workbench_clef_spend ORDER BY sequence'
    )
    .all()
}

describe('TaskSpec classification spend (retry bound per TaskSpec, no spend cap)', () => {
  let harness: ClassifierHarness | null = null

  beforeEach(() => setClefCallCircuit(null))
  afterEach(() => {
    harness?.db.owner.close()
    harness = null
    setClefCallCircuit(null)
  })

  function setup(options: ClassifierHarnessOptions = {}) {
    harness = createClassifierHarness(options)
    const h = harness
    const classifier = createTaskClassifier(h.deps)
    const classify = (objective: string, taskId?: string) => {
      const id = taskId ?? proposeFixtureTask(h.db, objective).taskId
      return classifier.classify(loadClassificationSubject(h.db.owner, id), NEVER_ABORTED)
    }
    return { h, classify }
  }

  it('classifies a third TaskSpec of one run; the old per-request cap of 2 does not refuse it', async () => {
    const { h, classify } = setup()
    const results = [
      await classify('Write the parser for the queue export format.'),
      await classify('Write the renderer for the queue export format.'),
      await classify('Write the tests for the queue export format.')
    ]
    expect(results.map((result) => result.classification.outcome)).toEqual([
      'classified',
      'classified',
      'classified'
    ])
    expect(spendRows(h).map((row) => [row.request_id, row.attempt, row.state])).toEqual([
      [h.db.requestId, 1, 'settled'],
      [h.db.requestId, 2, 'settled'],
      [h.db.requestId, 3, 'settled']
    ])
  })

  it('holds the per-TaskSpec retry bound of two billed attempts across classifications', async () => {
    const { h, classify } = setup({ transport: transportFailingTwice })
    const taskId = proposeFixtureTask(h.db).taskId
    const first = await classify('', taskId)
    expect(first.classification).toMatchObject({
      outcome: 'blocked',
      detail: 'transient_exhausted'
    })
    const second = await classify('', taskId)
    expect(second.classification).toMatchObject({
      attempt: 2,
      outcome: 'blocked',
      detail: 'budget_exhausted'
    })
    expect(spendRows(h)).toHaveLength(2)
    expect(h.spendStore.countAttemptsForSubject(taskId)).toBe(2)
    expect(await classify('Write the tests for the queue export format.')).toMatchObject({
      classification: { outcome: 'blocked', detail: 'transient_exhausted' }
    })
  })

  it('records classification spend with no daily neuron or classification cap (D-022)', async () => {
    // Why an invalid answer: it keeps each reservation at its bound, the most a call can count.
    const { h, classify } = setup({
      transport: transportResponding({ edit: () => ({ unexpected: true }) })
    })
    const objectives = Array.from(
      { length: 20 },
      (_unused, index) => `Write part ${index + 1} of the queue export format.`
    )
    const outcomes: string[] = []
    for (const objective of objectives) {
      outcomes.push((await classify(objective)).classification.outcome)
    }
    expect(outcomes).toEqual(objectives.map(() => 'invalid_output'))
    expect(spendRows(h)).toHaveLength(objectives.length)
    expect(h.ledger.snapshot().dailyNeuronsSpent).toBeGreaterThan(2_000)
  })

  it('settles from usage and links the reservation, the raw response and the TaskSpec', async () => {
    const { h, classify } = setup()
    const { classification } = await classify('Write the parser for the queue export format.')
    const [row] = spendRows(h)
    expect(classification.spendReservationId).toBe(row?.reservation_id)
    const raw = h.db.owner.db
      .prepare('SELECT request_id, spend_reservation_id FROM workbench_clef_raw_responses')
      .get()
    expect(raw).toEqual({ request_id: h.db.requestId, spend_reservation_id: row?.reservation_id })
    expect(h.spendStore.countAttemptsForSubject(classification.taskId)).toBe(1)
    expect(classification.answers).toMatchObject({
      evidence: { computedNeurons: expect.any(Number) }
    })
  })

  it('keeps an earlier attempt spent at its bound and settles only the answered one', async () => {
    const { h, classify } = setup({ transport: transportAnsweringOnRetry() })
    const { classification } = await classify('Write the parser for the queue export format.')
    const rows = spendRows(h)
    expect(rows.map((row) => row.state)).toEqual(['kept', 'settled'])
    expect(classification).toMatchObject({
      outcome: 'classified',
      spendReservationId: rows[1]?.reservation_id
    })
    expect(classification.answers).toMatchObject({
      evidence: { attempts: 2, earlierReservationIds: [rows[0]?.reservation_id] }
    })
    expect(h.spendStore.countAttemptsForSubject(classification.taskId)).toBe(2)
  })
})
