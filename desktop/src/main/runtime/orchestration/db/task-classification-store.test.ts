import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getTaskClassificationStore,
  type TaskClassificationInput
} from './task-classification-store'
import { createAppRunHarness, seedTask, type AppRunHarness } from './app-attempt.test-fixture'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  errorCodeOf,
  fixtureTime,
  insertRawSpendReservation
} from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

function classified(
  taskId: string,
  overrides: Partial<TaskClassificationInput> = {}
): TaskClassificationInput {
  return {
    taskId,
    attempt: 1,
    outcome: 'classified',
    detail: null,
    needsDelegation: true,
    taskType: 'software_engineering',
    answers: { needs_delegation: 'yes', task_type: 'software_engineering' },
    bundleSha256: FIXTURE_HASH_A,
    taxonomyVersion: 2,
    profileSha256: FIXTURE_HASH_B,
    classifierModel: '@cf/cloudflare/clef',
    rawResponseId: null,
    spendReservationId: null,
    timestamp: fixtureTime(3),
    ...overrides
  }
}

describe('task classification store', () => {
  let harness: AppRunHarness
  let taskId: string
  beforeEach(() => {
    harness = createAppRunHarness()
    taskId = seedTask(harness).taskId
  })
  afterEach(() => harness.owner.close())

  const store = () => getTaskClassificationStore(harness.owner)
  const rowCount = () =>
    harness.owner.db.prepare('SELECT count(*) AS n FROM task_classifications').get()?.n

  it('is one store per database', () => {
    expect(getTaskClassificationStore(harness.owner)).toBe(store())
  })

  describe('record', () => {
    it('stores a classification with the exact classifier provenance', () => {
      const record = store().record(classified(taskId))
      expect(record).toMatchObject({
        taskId,
        attempt: 1,
        outcome: 'classified',
        detail: null,
        needsDelegation: true,
        taskType: 'software_engineering',
        answers: { needs_delegation: 'yes', task_type: 'software_engineering' },
        bundleSha256: FIXTURE_HASH_A,
        taxonomyVersion: 2,
        profileSha256: FIXTURE_HASH_B,
        classifierModel: '@cf/cloudflare/clef',
        rawResponseId: null,
        spendReservationId: null,
        createdAt: fixtureTime(3),
        orphaned: false
      })
      expect(record.classificationId).toMatch(/^classification_/)
    })

    it('keeps the answer as given when no delegation is needed for a delegable type (U10)', () => {
      const record = store().record(
        classified(taskId, { needsDelegation: false, taskType: 'high_quality_writing' })
      )
      expect(record).toMatchObject({ needsDelegation: false, taskType: 'high_quality_writing' })
    })

    it('stores a blocked outcome with only a reason code', () => {
      const outcomes = ['blocked', 'invalid_output', 'discarded_after_cancel'] as const
      outcomes.forEach((outcome, index) => {
        const record = store().record(
          classified(taskId, {
            attempt: index + 1,
            outcome,
            detail: 'clef_unavailable',
            needsDelegation: null,
            taskType: null,
            answers: null,
            bundleSha256: null,
            taxonomyVersion: null,
            profileSha256: null,
            classifierModel: null
          })
        )
        expect(record).toMatchObject({ outcome, detail: 'clef_unavailable', needsDelegation: null })
      })
    })

    it('links a spend reservation and refuses one that does not exist', () => {
      insertRawSpendReservation(harness.owner.db, 'reservation_fixture01')
      expect(
        store().record(classified(taskId, { spendReservationId: 'reservation_fixture01' }))
          .spendReservationId
      ).toBe('reservation_fixture01')
      expect(
        errorCodeOf(() =>
          store().record(classified(taskId, { attempt: 2, spendReservationId: 'reservation_nope' }))
        )
      ).toBe('autopilot_spend_reservation_not_found')
      expect(
        errorCodeOf(() =>
          store().record(classified(taskId, { attempt: 2, rawResponseId: 'raw_response_nope' }))
        )
      ).toBe('autopilot_raw_response_not_found')
      expect(rowCount()).toBe(1)
    })

    it('refuses a second record for the same attempt of a task', () => {
      store().record(classified(taskId))
      expect(errorCodeOf(() => store().record(classified(taskId)))).toBe(
        'autopilot_classification_conflict'
      )
      expect(rowCount()).toBe(1)
    })

    it('refuses a task that has no TaskSpec', () => {
      expect(errorCodeOf(() => store().record(classified('task_unknown')))).toBe(
        'autopilot_task_spec_not_found'
      )
    })

    it('refuses results that do not fit the outcome', () => {
      const blockedShape = {
        outcome: 'blocked',
        detail: 'clef_unavailable',
        needsDelegation: null,
        taskType: null
      } as const
      const bad: TaskClassificationInput[] = [
        classified(taskId, { needsDelegation: null }),
        classified(taskId, { taskType: null }),
        classified(taskId, { taskType: 'Not A Code' }),
        classified(taskId, { attempt: 0 }),
        classified(taskId, { bundleSha256: 'abc' }),
        classified(taskId, { taxonomyVersion: 0 }),
        classified(taskId, { classifierModel: 'bad model name' }),
        classified(taskId, { detail: 'not_expected_here' }),
        classified(taskId, { ...blockedShape, detail: null }),
        classified(taskId, { ...blockedShape, taskType: 'software_engineering' }),
        classified(taskId, { ...blockedShape, needsDelegation: true }),
        classified(taskId, { ...blockedShape, detail: 'Has Spaces And Capitals' })
      ]
      for (const input of bad) {
        expect(errorCodeOf(() => store().record(input))).toBe('autopilot_invalid_input')
      }
      expect(errorCodeOf(() => store().record({ ...classified(taskId), extra: 1 } as never))).toBe(
        'autopilot_invalid_input'
      )
      expect(rowCount()).toBe(0)
    })

    it('refuses answers that are not a small JSON object or still hold a secret', () => {
      expect(
        errorCodeOf(() => store().record(classified(taskId, { answers: ['yes'] as never })))
      ).toBe('autopilot_invalid_input')
      expect(
        errorCodeOf(() =>
          store().record(classified(taskId, { answers: { note: 'x'.repeat(4096) } }))
        )
      ).toBe('autopilot_invalid_input')
      expect(
        errorCodeOf(() => store().record(classified(taskId, { answers: { note: FAKE_SECRET } })))
      ).toBe('autopilot_unredacted_text')
      expect(rowCount()).toBe(0)
    })
  })

  describe('reads', () => {
    it('numbers attempts per task and reads them back in order', () => {
      expect(store().nextAttempt(taskId)).toBe(1)
      const first = store().record(classified(taskId))
      expect(store().nextAttempt(taskId)).toBe(2)
      const second = store().record(
        classified(taskId, { attempt: 2, taskType: 'high_quality_writing' })
      )
      expect(store().get(first.classificationId)).toEqual(first)
      expect(store().getForAttempt(taskId, 2)).toEqual(second)
      expect(store().latestForTask(taskId)).toEqual(second)
      expect(store().listForTask(taskId)).toEqual([first, second])
    })

    it('returns null or an empty list for unknown ids', () => {
      expect(store().get('classification_unknown')).toBeNull()
      expect(store().getForAttempt('task_unknown', 1)).toBeNull()
      expect(store().latestForTask('task_unknown')).toBeNull()
      expect(store().listForTask('task_unknown')).toEqual([])
      expect(store().nextAttempt('task_unknown')).toBe(1)
    })

    it('reads a classification as orphaned once Orca no longer holds its task', () => {
      const record = store().record(classified(taskId))
      harness.owner.resetAll()
      expect(store().get(record.classificationId)?.orphaned).toBe(true)
      expect(store().latestForTask(taskId)?.orphaned).toBe(true)
    })
  })
})
