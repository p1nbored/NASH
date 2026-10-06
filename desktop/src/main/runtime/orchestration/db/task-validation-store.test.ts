import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyValidationVerdict,
  applyValidationWaiver,
  getTaskValidationStore,
  type TaskValidationOpenInput
} from './task-validation-store'
import { computeCriteriaSha256 } from './task-spec-record'
import { getTaskSpecStore } from './task-spec-store'
import {
  forceAwaitingValidation,
  seedRoutedTask,
  seedStartedAttempt
} from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

describe('task validation store', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const store = () => getTaskValidationStore(harness.owner)
  const rowCount = () =>
    harness.owner.db.prepare('SELECT count(*) AS n FROM task_validations').get()?.n

  /**
   * An attempt awaiting validation, for a spec with machine checks (default), with none and a model
   * review request (false), or with neither (`'none'`, validated by its default check, D-027).
   */
  function awaiting(machineChecks: boolean | 'none' = true) {
    const spec =
      machineChecks === true
        ? {}
        : {
            spec: {
              machineChecks: [],
              ...(machineChecks === false ? { review: 'model' as const } : {})
            }
          }
    const seeded = seedRoutedTask(harness, spec)
    const { dispatchId } = seedStartedAttempt(harness, seeded.taskId, seeded.routeId)
    forceAwaitingValidation(harness, dispatchId)
    return { taskId: seeded.taskId, dispatchId }
  }
  const machineOpen = (
    taskId: string,
    dispatchId: string,
    overrides: Partial<TaskValidationOpenInput> = {}
  ) =>
    ({
      taskId,
      dispatchId,
      policy: 'machine_checks',
      validatorId: 'deterministic_validators',
      workerModel: null,
      reviewerModel: null,
      timestamp: fixtureTime(8),
      ...overrides
    }) satisfies TaskValidationOpenInput
  const reviewOpen = (
    taskId: string,
    dispatchId: string,
    overrides: Partial<TaskValidationOpenInput> = {}
  ) =>
    machineOpen(taskId, dispatchId, {
      policy: 'model_review',
      validatorId: 'review:claude-opus-5-5',
      workerModel: 'gpt-6.1-sol',
      reviewerModel: 'claude-opus-5-5',
      ...overrides
    })

  it('is one store per database', () => {
    expect(getTaskValidationStore(harness.owner)).toBe(store())
  })

  describe('open', () => {
    it('opens a pending machine-check validation on a claimed attempt', () => {
      const { taskId, dispatchId } = awaiting()
      const spec = getTaskSpecStore(harness.owner).get(taskId)
      const { duplicate, record } = store().open(machineOpen(taskId, dispatchId))
      expect(duplicate).toBe(false)
      expect(record).toMatchObject({
        taskId,
        dispatchId,
        policy: 'machine_checks',
        criteriaSha256: computeCriteriaSha256(
          spec ?? { expectedOutputs: [], acceptanceCriteria: [], machineChecks: [] }
        ),
        verdict: 'pending',
        checks: [],
        validatorId: 'deterministic_validators',
        workerModel: null,
        reviewerModel: null,
        evidenceRefs: [],
        waiver: null,
        waivedAt: null,
        createdAt: fixtureTime(8),
        updatedAt: fixtureTime(8),
        orphaned: false
      })
      expect(record.validationId).toMatch(/^validation_/)
    })

    it('opens the default check under machine_checks for a TaskSpec with neither (D-027)', () => {
      const { taskId, dispatchId } = awaiting('none')
      expect(store().open(machineOpen(taskId, dispatchId)).record.policy).toBe('machine_checks')
    })

    it('refuses a model review that the TaskSpec did not ask for (D-027)', () => {
      const { taskId, dispatchId } = awaiting('none')
      expect(errorCodeOf(() => store().open(reviewOpen(taskId, dispatchId)))).toBe(
        'autopilot_validation_policy_mismatch'
      )
      expect(rowCount()).toBe(0)
    })

    it('opens a model review for a TaskSpec that asks for one', () => {
      const { taskId, dispatchId } = awaiting(false)
      const { record } = store().open(reviewOpen(taskId, dispatchId))
      expect(record).toMatchObject({
        policy: 'model_review',
        workerModel: 'gpt-6.1-sol',
        reviewerModel: 'claude-opus-5-5',
        verdict: 'pending'
      })
    })

    it('ties the criteria hash to the spec it was judged against', () => {
      const first = awaiting()
      const second = (() => {
        const seeded = seedRoutedTask(harness, {
          spec: { acceptanceCriteria: ['A different rule.'] }
        })
        const { dispatchId } = seedStartedAttempt(harness, seeded.taskId, seeded.routeId)
        forceAwaitingValidation(harness, dispatchId)
        return { taskId: seeded.taskId, dispatchId }
      })()
      const a = store().open(machineOpen(first.taskId, first.dispatchId)).record
      const b = store().open(machineOpen(second.taskId, second.dispatchId)).record
      expect(a.criteriaSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(b.criteriaSha256).not.toBe(a.criteriaSha256)
    })

    it('refuses a policy that does not follow the TaskSpec', () => {
      const withChecks = awaiting(true)
      const withoutChecks = awaiting(false)
      // Why: automatic checks where they exist; a model review only when the TaskSpec asks for one.
      expect(
        errorCodeOf(() => store().open(reviewOpen(withChecks.taskId, withChecks.dispatchId)))
      ).toBe('autopilot_validation_policy_mismatch')
      expect(
        errorCodeOf(() => store().open(machineOpen(withoutChecks.taskId, withoutChecks.dispatchId)))
      ).toBe('autopilot_validation_policy_mismatch')
      expect(rowCount()).toBe(0)
    })

    it('refuses a review by the model that did the work, however its id is spelled', () => {
      const { taskId, dispatchId } = awaiting(false)
      const same = [
        ['gpt-6.1-sol', 'gpt-6.1-sol'],
        ['gpt-6.1-sol', 'GPT-6.1-SOL'],
        ['gpt-6.1-sol', 'gpt-6.1-sol-high'],
        ['gpt-6.1-sol-max', 'gpt-6.1-sol-low'],
        ['gpt-6.1-sol-xhigh', 'gpt-6.1-sol'],
        ['gpt-6.1-sol-ultra', 'gpt-6.1-sol-minimal'],
        ['gpt-6.1-sol-none', 'gpt-6.1-sol']
      ]
      for (const [workerModel, reviewerModel] of same) {
        expect(
          errorCodeOf(() =>
            store().open(reviewOpen(taskId, dispatchId, { workerModel, reviewerModel }))
          )
        ).toBe('autopilot_validation_not_independent')
      }
      expect(rowCount()).toBe(0)
    })

    it('accepts a reviewer that is a different model, including a different version', () => {
      const { taskId, dispatchId } = awaiting(false)
      expect(() =>
        store().open(
          reviewOpen(taskId, dispatchId, {
            workerModel: 'gpt-6.1-sol',
            reviewerModel: 'gpt-6-astra'
          })
        )
      ).not.toThrow()
    })

    it('refuses a model review that names no worker or no reviewer, and models on a machine check', () => {
      const { taskId, dispatchId } = awaiting(false)
      expect(
        errorCodeOf(() => store().open(reviewOpen(taskId, dispatchId, { workerModel: null })))
      ).toBe('autopilot_invalid_input')
      expect(
        errorCodeOf(() => store().open(reviewOpen(taskId, dispatchId, { reviewerModel: null })))
      ).toBe('autopilot_invalid_input')
      const checked = awaiting(true)
      expect(
        errorCodeOf(() =>
          store().open(
            machineOpen(checked.taskId, checked.dispatchId, { reviewerModel: 'claude-opus-5-5' })
          )
        )
      ).toBe('autopilot_invalid_input')
    })

    it('refuses a worker model that is not the model the route ran', () => {
      const { taskId, dispatchId } = awaiting(false)
      expect(
        errorCodeOf(() =>
          store().open(reviewOpen(taskId, dispatchId, { workerModel: 'claude-sonnet-5-5' }))
        )
      ).toBe('autopilot_validation_worker_model_mismatch')
    })

    it("refuses an attempt that has no recorded claim, or that is not the task's", () => {
      const seeded = seedRoutedTask(harness)
      const running = seedStartedAttempt(harness, seeded.taskId, seeded.routeId)
      expect(errorCodeOf(() => store().open(machineOpen(seeded.taskId, running.dispatchId)))).toBe(
        'autopilot_attempt_conflict'
      )
      const claimed = awaiting()
      expect(errorCodeOf(() => store().open(machineOpen(seeded.taskId, claimed.dispatchId)))).toBe(
        'autopilot_attempt_not_found'
      )
      expect(errorCodeOf(() => store().open(machineOpen(claimed.taskId, 'ctx_unknown')))).toBe(
        'autopilot_attempt_not_found'
      )
      expect(errorCodeOf(() => store().open(machineOpen('task_unknown', 'ctx_unknown')))).toBe(
        'autopilot_task_spec_not_found'
      )
      expect(rowCount()).toBe(0)
    })

    it('returns the existing validation for the same request and refuses a different one', () => {
      const { taskId, dispatchId } = awaiting()
      const first = store().open(machineOpen(taskId, dispatchId)).record
      expect(store().open(machineOpen(taskId, dispatchId))).toEqual({
        duplicate: true,
        record: first
      })
      expect(
        errorCodeOf(() =>
          store().open(machineOpen(taskId, dispatchId, { validatorId: 'someone_else' }))
        )
      ).toBe('autopilot_validation_conflict')
      expect(rowCount()).toBe(1)
    })

    it('refuses malformed input and unknown keys', () => {
      const { taskId, dispatchId } = awaiting()
      const bad = [
        machineOpen(taskId, dispatchId, { policy: 'manual' as never }),
        machineOpen(taskId, dispatchId, { validatorId: '' }),
        machineOpen(taskId, dispatchId, { validatorId: 'has space' }),
        reviewOpen(taskId, dispatchId, { reviewerModel: ' claude-opus-5-5 ' }),
        machineOpen(taskId, dispatchId, { timestamp: 'yesterday' }),
        { ...machineOpen(taskId, dispatchId), extra: 1 } as never
      ]
      for (const input of bad) {
        expect(errorCodeOf(() => store().open(input))).toBe('autopilot_invalid_input')
      }
      expect(rowCount()).toBe(0)
    })

    it('opens its own transaction and refuses a connection that is already in one', () => {
      const { taskId, dispatchId } = awaiting()
      harness.owner.db.exec('BEGIN IMMEDIATE')
      try {
        expect(errorCodeOf(() => store().open(machineOpen(taskId, dispatchId)))).toBe(
          'autopilot_transaction_unavailable'
        )
      } finally {
        harness.owner.db.exec('ROLLBACK')
      }
    })
  })

  describe('verdict and waiver writes', () => {
    let validationId: string
    beforeEach(() => {
      const { taskId, dispatchId } = awaiting()
      validationId = store().open(machineOpen(taskId, dispatchId)).record.validationId
    })

    const write = (operation: () => void) => {
      const db = harness.owner.db
      db.exec('BEGIN IMMEDIATE')
      try {
        operation()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    const verdict = (
      input: Partial<Parameters<typeof applyValidationVerdict>[1]> & {
        verdict: 'pass' | 'fail' | 'inconclusive'
      }
    ) =>
      write(() =>
        applyValidationVerdict(harness.owner.db, {
          validationId,
          checks: [{ kind: 'artifact_exists', status: input.verdict }],
          evidenceRefs: [{ kind: 'artifact', ref: 'artifact_fixture01' }],
          timestamp: fixtureTime(9),
          ...input
        })
      )

    it('records a verdict with its checks and evidence', () => {
      verdict({
        verdict: 'pass',
        checks: [{ kind: 'artifact_exists', status: 'pass', note: 'Found `report.md`.' }]
      })
      expect(store().get(validationId)).toMatchObject({
        verdict: 'pass',
        checks: [{ kind: 'artifact_exists', status: 'pass', note: 'Found `report.md`.' }],
        evidenceRefs: [{ kind: 'artifact', ref: 'artifact_fixture01' }],
        updatedAt: fixtureTime(9),
        waiver: null
      })
    })

    it('lets an inconclusive validation be run again, and settles pass and fail for good', () => {
      verdict({ verdict: 'inconclusive' })
      verdict({ verdict: 'inconclusive', timestamp: fixtureTime(10) })
      verdict({ verdict: 'fail', timestamp: fixtureTime(11) })
      expect(store().get(validationId)?.verdict).toBe('fail')
      for (const next of ['pass', 'fail', 'inconclusive'] as const) {
        expect(errorCodeOf(() => verdict({ verdict: next }))).toBe('autopilot_validation_conflict')
      }
    })

    it('refuses to move a validation back to pending', () => {
      expect(errorCodeOf(() => verdict({ verdict: 'pending' as never }))).toBe(
        'autopilot_invalid_input'
      )
    })

    it('refuses malformed checks and evidence, and text that still holds a secret', () => {
      const code = (input: Partial<Parameters<typeof applyValidationVerdict>[1]>) =>
        errorCodeOf(() => verdict({ verdict: 'pass', ...input }))
      expect(code({ checks: [{ kind: 'Not A Code', status: 'pass' }] })).toBe(
        'autopilot_invalid_input'
      )
      expect(code({ checks: [{ kind: 'x_check', status: 'maybe' as never }] })).toBe(
        'autopilot_invalid_input'
      )
      expect(code({ checks: [{ kind: 'x_check', status: 'pass', note: 'two\nlines' }] })).toBe(
        'autopilot_invalid_input'
      )
      expect(code({ checks: [{ kind: 'x_check', status: 'pass', note: 'x'.repeat(501) }] })).toBe(
        'autopilot_invalid_input'
      )
      expect(
        code({
          checks: Array.from({ length: 65 }, () => ({ kind: 'x_check', status: 'pass' as const }))
        })
      ).toBe('autopilot_invalid_input')
      expect(code({ evidenceRefs: [{ kind: 'artifact', ref: '' }] })).toBe(
        'autopilot_invalid_input'
      )
      expect(
        code({ evidenceRefs: Array.from({ length: 33 }, () => ({ kind: 'artifact', ref: 'a' })) })
      ).toBe('autopilot_invalid_input')
      expect(code({ checks: [{ kind: 'x_check', status: 'pass', note: FAKE_SECRET }] })).toBe(
        'autopilot_unredacted_text'
      )
      expect(store().get(validationId)?.verdict).toBe('pending')
    })

    it('waives only an inconclusive validation, and only once', () => {
      const waive = (waiver: 'desktop_user' | 'dot' = 'desktop_user') =>
        write(() =>
          applyValidationWaiver(harness.owner.db, {
            validationId,
            waiver,
            timestamp: fixtureTime(12)
          })
        )
      expect(errorCodeOf(() => waive())).toBe('autopilot_validation_conflict')
      verdict({ verdict: 'inconclusive' })
      waive('dot')
      expect(store().get(validationId)).toMatchObject({
        verdict: 'inconclusive',
        waiver: 'dot',
        waivedAt: fixtureTime(12)
      })
      expect(errorCodeOf(() => waive('desktop_user'))).toBe('autopilot_validation_conflict')
      expect(errorCodeOf(() => verdict({ verdict: 'pass' }))).toBe('autopilot_validation_conflict')
      expect(errorCodeOf(() => waive('primary' as never))).toBe('autopilot_invalid_input')
    })

    it('refuses an unknown validation', () => {
      expect(
        errorCodeOf(() =>
          write(() =>
            applyValidationWaiver(harness.owner.db, {
              validationId: 'validation_unknown',
              waiver: 'dot',
              timestamp: fixtureTime(12)
            })
          )
        )
      ).toBe('autopilot_validation_not_found')
    })

    it('only runs inside a transaction the caller owns, so Orca state moves with it', () => {
      const bare = () =>
        applyValidationVerdict(harness.owner.db, {
          validationId,
          verdict: 'pass',
          checks: [],
          evidenceRefs: [],
          timestamp: fixtureTime(9)
        })
      expect(errorCodeOf(bare)).toBe('autopilot_transaction_required')
      expect(store().get(validationId)?.verdict).toBe('pending')
    })
  })

  describe('reads', () => {
    it('reads validations by id, Dispatch and task, newest last', () => {
      const first = awaiting()
      const a = store().open(machineOpen(first.taskId, first.dispatchId)).record
      expect(store().get(a.validationId)).toEqual(a)
      expect(store().getForDispatch(first.dispatchId)).toEqual(a)
      expect(store().latestForTask(first.taskId)).toEqual(a)
      expect(store().listForTask(first.taskId)).toEqual([a])
      expect(store().get('validation_unknown')).toBeNull()
      expect(store().getForDispatch('ctx_unknown')).toBeNull()
      expect(store().latestForTask('task_unknown')).toBeNull()
      expect(store().listForTask('task_unknown')).toEqual([])
    })

    it('says a task has a passing validation only after a pass was recorded', () => {
      const { taskId, dispatchId } = awaiting()
      const { validationId } = store().open(machineOpen(taskId, dispatchId)).record
      expect(store().hasPassing(taskId)).toBe(false)
      harness.owner.db.exec('BEGIN IMMEDIATE')
      applyValidationVerdict(harness.owner.db, {
        validationId,
        verdict: 'pass',
        checks: [{ kind: 'artifact_exists', status: 'pass' }],
        evidenceRefs: [],
        timestamp: fixtureTime(9)
      })
      harness.owner.db.exec('COMMIT')
      expect(store().hasPassing(taskId)).toBe(true)
    })

    it('reads a validation as orphaned, and never as passing, once Orca no longer holds the task', () => {
      const { taskId, dispatchId } = awaiting()
      const { validationId } = store().open(machineOpen(taskId, dispatchId)).record
      harness.owner.db.exec('BEGIN IMMEDIATE')
      applyValidationVerdict(harness.owner.db, {
        validationId,
        verdict: 'pass',
        checks: [{ kind: 'artifact_exists', status: 'pass' }],
        evidenceRefs: [],
        timestamp: fixtureTime(9)
      })
      harness.owner.db.exec('COMMIT')
      harness.owner.resetAll()
      expect(store().get(validationId)).toMatchObject({ verdict: 'pass', orphaned: true })
      expect(store().hasPassing(taskId)).toBe(false)
    })
  })
})
