import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectAttemptOutcome } from './attempt-outcome-projection'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import {
  getValidationOutcomeService,
  type RecordVerdictInput
} from './app-attempt-validation-outcome'
import { getTaskValidationStore } from './task-validation-store'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

const TWO_CHECKS = [{ kind: 'artifact_exists', path: 'report.md' }, { kind: 'secret_scan_clean' }]

describe('app attempt validation outcome', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    harness.owner.close()
  })

  const settlement = () => getAppAttemptSettlement(harness.owner)
  const outcome = () => getValidationOutcomeService(harness.owner)
  const validations = () => getTaskValidationStore(harness.owner)

  /** A claimed attempt with its pending validation; a `review` spec asks for one and has no machine checks. */
  function claimed(options: { review?: boolean; deps?: string[]; checks?: object[] } = {}) {
    const seeded = seedRoutedTask(harness, {
      deps: options.deps,
      spec: options.review
        ? { machineChecks: [], review: 'model' }
        : { machineChecks: (options.checks ?? TWO_CHECKS) as never }
    })
    const { dispatchId } = settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'in_session',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    settlement().markRunning({
      dispatchId,
      timestamp: fixtureTime(6)
    })
    settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7) })
    const { record } = validations().open(
      options.review
        ? {
            taskId: seeded.taskId,
            dispatchId,
            policy: 'model_review',
            validatorId: 'review:claude-opus-5-5',
            workerModel: 'gpt-6.1-sol',
            reviewerModel: 'claude-opus-5-5',
            timestamp: fixtureTime(8)
          }
        : {
            taskId: seeded.taskId,
            dispatchId,
            policy: 'machine_checks',
            validatorId: 'deterministic_validators',
            workerModel: null,
            reviewerModel: null,
            timestamp: fixtureTime(8)
          }
    )
    return { ...seeded, dispatchId, validationId: record.validationId }
  }
  const passInput = (
    validationId: string,
    overrides: Partial<RecordVerdictInput> = {}
  ): RecordVerdictInput => ({
    validationId,
    verdict: 'pass',
    checks: [
      { kind: 'artifact_exists', status: 'pass' },
      { kind: 'secret_scan_clean', status: 'pass' }
    ],
    evidenceRefs: [{ kind: 'artifact', ref: 'report.md' }],
    timestamp: fixtureTime(9),
    ...overrides
  })
  const orca = (dispatchId: string, taskId: string) => ({
    task: harness.owner.getTask(taskId),
    dispatch: harness.owner.getDispatchContextById(dispatchId),
    worker: harness.owner.getWorkerDispatch(dispatchId)
  })

  describe('a passing verdict', () => {
    it('completes the task through updateTaskStatus and promotes its dependents', () => {
      const first = claimed()
      const dependent = seedRoutedTask(harness, { deps: [first.taskId] })
      expect(harness.owner.getTask(dependent.taskId)?.status).toBe('pending')
      const update = vi.spyOn(harness.owner, 'updateTaskStatus')
      const result = outcome().recordVerdict(passInput(first.validationId))
      expect(update).toHaveBeenCalledTimes(1)
      expect(update).toHaveBeenCalledWith(first.taskId, 'completed', expect.any(String))
      expect(result.attempt).toMatchObject({
        taskStatus: 'completed',
        dispatchStatus: 'completed',
        workerState: 'succeeded',
        workerStage: 'settled'
      })
      expect(result.validation).toMatchObject({ verdict: 'pass', updatedAt: fixtureTime(9) })
      expect(harness.owner.getTask(first.taskId)).toMatchObject({
        status: 'completed',
        result: 'Validation passed.'
      })
      expect(harness.owner.getTask(first.taskId)?.completed_at).toBeTruthy()
      expect(harness.owner.getTask(dependent.taskId)?.status).toBe('ready')
    })

    it('records the validator as the accepted report, so Orca reads success only after validation', () => {
      const { dispatchId, taskId, validationId } = claimed()
      outcome().recordVerdict(passInput(validationId))
      const facts = harness.owner.getAttemptObservationFacts(dispatchId)
      expect(facts.map((fact) => fact.facet)).toEqual(['outcome', 'worker_report'])
      expect(facts[1]?.payload).toEqual({
        status: 'accepted',
        outcome: 'succeeded',
        reportId: validationId
      })
      expect(
        projectAttemptOutcome({
          dispatchId,
          taskId,
          facts,
          authorityNow: { home: Date.parse(fixtureTime(10)) }
        })
      ).toMatchObject({ outcome: 'succeeded', outcomeSource: 'worker_report' })
    })

    it("uses the caller's one-line result and files a notice in the same transaction", () => {
      const { taskId, validationId } = claimed()
      const result = outcome().recordVerdict(
        passInput(validationId, {
          resultSummary: 'All two machine checks passed.',
          notice: { subject: 'Validation passed for a delegated task.' }
        })
      )
      expect(harness.owner.getTask(taskId)?.result).toBe('All two machine checks passed.')
      expect(result.attempt.notice).toMatchObject({
        to_handle: `run:${harness.runId}`,
        priority: 'normal'
      })
    })

    it('completes a task validated by a model review of a different model', () => {
      const { taskId, validationId } = claimed({ review: true })
      outcome().recordVerdict(
        passInput(validationId, {
          checks: [{ kind: 'criteria_satisfied', status: 'pass', note: 'Every criterion holds.' }]
        })
      )
      expect(harness.owner.getTask(taskId)?.status).toBe('completed')
    })

    it('refuses a pass that does not cover every machine check, and changes nothing', () => {
      const { dispatchId, taskId, validationId } = claimed()
      const refuse = (overrides: Partial<RecordVerdictInput>) =>
        errorCodeOf(() => outcome().recordVerdict(passInput(validationId, overrides)))
      expect(refuse({ checks: [] })).toBe('autopilot_validation_insufficient')
      expect(refuse({ checks: [{ kind: 'artifact_exists', status: 'pass' }] })).toBe(
        'autopilot_validation_insufficient'
      )
      expect(
        refuse({
          checks: [
            { kind: 'secret_scan_clean', status: 'pass' },
            { kind: 'artifact_exists', status: 'pass' }
          ]
        })
      ).toBe('autopilot_validation_insufficient')
      expect(
        refuse({
          checks: [
            { kind: 'artifact_exists', status: 'pass' },
            { kind: 'secret_scan_clean', status: 'fail' }
          ]
        })
      ).toBe('autopilot_validation_insufficient')
      expect(
        refuse({
          checks: [
            { kind: 'artifact_exists', status: 'pass' },
            { kind: 'secret_scan_clean', status: 'inconclusive' }
          ]
        })
      ).toBe('autopilot_validation_insufficient')
      expect(refuse({ evidenceRefs: [] })).toBe('autopilot_validation_insufficient')
      expect(validations().get(validationId)?.verdict).toBe('pending')
      expect(orca(dispatchId, taskId)).toMatchObject({
        task: { status: 'blocked' },
        dispatch: { status: 'dispatched' },
        worker: { state: 'ready', stage: 'validation_pending' }
      })
    })

    it('refuses a model review that carries no check, or a check that did not pass', () => {
      const { validationId } = claimed({ review: true })
      const refuse = (checks: RecordVerdictInput['checks']) =>
        errorCodeOf(() => outcome().recordVerdict(passInput(validationId, { checks })))
      expect(refuse([])).toBe('autopilot_validation_insufficient')
      expect(refuse([{ kind: 'criteria_satisfied', status: 'fail' }])).toBe(
        'autopilot_validation_insufficient'
      )
    })

    it('leaves the whole verdict unwritten when the task cannot be completed', () => {
      const { dispatchId, taskId, validationId } = claimed()
      harness.owner.db.exec(
        `CREATE TRIGGER fixture_no_completion BEFORE UPDATE OF status ON tasks WHEN NEW.status = 'completed'
           BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`
      )
      expect(() => outcome().recordVerdict(passInput(validationId))).toThrow('fixture failure')
      expect(validations().get(validationId)?.verdict).toBe('pending')
      expect(orca(dispatchId, taskId)).toMatchObject({
        task: { status: 'blocked' },
        dispatch: { status: 'dispatched' },
        worker: { state: 'ready', stage: 'validation_pending' }
      })
      expect(harness.owner.getAttemptObservationFacts(dispatchId)).toHaveLength(1)
    })
  })

  describe('a failing verdict', () => {
    it('fails the task and the attempt and leaves dependents pending', () => {
      const first = claimed()
      const dependent = seedRoutedTask(harness, { deps: [first.taskId] })
      const result = outcome().recordVerdict({
        validationId: first.validationId,
        verdict: 'fail',
        checks: [{ kind: 'artifact_exists', status: 'fail', note: 'The report is missing.' }],
        evidenceRefs: [],
        notice: { subject: 'Validation failed for a delegated task.' },
        timestamp: fixtureTime(9)
      })
      expect(result.attempt).toMatchObject({
        taskStatus: 'failed',
        dispatchStatus: 'failed',
        workerState: 'failed',
        workerStage: 'settled'
      })
      expect(result.validation.verdict).toBe('fail')
      expect(orca(first.dispatchId, first.taskId)).toMatchObject({
        dispatch: { failure_count: 1, last_failure: 'validation_failed' },
        worker: { last_error: 'validation_failed' }
      })
      expect(harness.owner.getTask(first.taskId)).toMatchObject({
        status: 'failed',
        result: 'Validation failed.'
      })
      expect(harness.owner.getTask(dependent.taskId)?.status).toBe('pending')
      expect(result.attempt.notice).toMatchObject({ priority: 'high' })
      const facts = harness.owner.getAttemptObservationFacts(first.dispatchId)
      expect(facts[1]?.payload).toMatchObject({ status: 'accepted', outcome: 'failed' })
    })
  })

  describe('an inconclusive verdict', () => {
    it('keeps the task blocked, marks it for a decision, and can be run again to a pass', () => {
      const first = claimed()
      const dependent = seedRoutedTask(harness, { deps: [first.taskId] })
      const result = outcome().recordVerdict({
        validationId: first.validationId,
        verdict: 'inconclusive',
        checks: [{ kind: 'artifact_exists', status: 'inconclusive' }],
        evidenceRefs: [],
        timestamp: fixtureTime(9)
      })
      expect(result.attempt).toMatchObject({
        taskStatus: 'blocked',
        dispatchStatus: 'dispatched',
        workerState: 'ready',
        workerStage: 'validation_inconclusive'
      })
      expect(result.validation.verdict).toBe('inconclusive')
      expect(harness.owner.getTask(dependent.taskId)?.status).toBe('pending')
      expect(validations().hasPassing(first.taskId)).toBe(false)
      const rerun = outcome().recordVerdict(
        passInput(first.validationId, { timestamp: fixtureTime(10) })
      )
      expect(rerun.attempt.taskStatus).toBe('completed')
      expect(harness.owner.getTask(dependent.taskId)?.status).toBe('ready')
    })
  })

  describe('a decision on an inconclusive result', () => {
    const inconclusive = () => {
      const first = claimed()
      outcome().recordVerdict({
        validationId: first.validationId,
        verdict: 'inconclusive',
        checks: [{ kind: 'artifact_exists', status: 'inconclusive' }],
        evidenceRefs: [],
        timestamp: fixtureTime(9)
      })
      return first
    }

    it('lets the user or dot waive it, which completes the task and records who accepted it', () => {
      for (const by of ['desktop_user', 'dot'] as const) {
        const first = inconclusive()
        const dependent = seedRoutedTask(harness, { deps: [first.taskId] })
        const result = outcome().waive({
          validationId: first.validationId,
          by,
          timestamp: fixtureTime(10)
        })
        expect(result.validation).toMatchObject({
          verdict: 'inconclusive',
          waiver: by,
          waivedAt: fixtureTime(10)
        })
        expect(result.attempt).toMatchObject({ taskStatus: 'completed', workerState: 'succeeded' })
        expect(harness.owner.getTask(first.taskId)?.result).toBe(`Validation waived by ${by}.`)
        expect(harness.owner.getTask(dependent.taskId)?.status).toBe('ready')
        expect(validations().hasPassing(first.taskId)).toBe(false)
      }
    })

    it('lets the user or dot reject it, which fails the task', () => {
      const first = inconclusive()
      const result = outcome().reject({
        validationId: first.validationId,
        by: 'desktop_user',
        timestamp: fixtureTime(10)
      })
      expect(result.validation.verdict).toBe('fail')
      expect(result.validation.checks).toEqual([
        { kind: 'artifact_exists', status: 'inconclusive' },
        { kind: 'user_decision', status: 'fail', note: 'Rejected by desktop_user.' }
      ])
      expect(result.attempt).toMatchObject({ taskStatus: 'failed', workerState: 'failed' })
      expect(harness.owner.getTask(first.taskId)?.result).toBe(
        'Validation rejected by desktop_user.'
      )
    })

    it('refuses a waiver or rejection of a validation that is not inconclusive', () => {
      const pending = claimed()
      expect(
        errorCodeOf(() =>
          outcome().waive({
            validationId: pending.validationId,
            by: 'dot',
            timestamp: fixtureTime(10)
          })
        )
      ).toBe('autopilot_validation_conflict')
      expect(
        errorCodeOf(() =>
          outcome().reject({
            validationId: pending.validationId,
            by: 'dot',
            timestamp: fixtureTime(10)
          })
        )
      ).toBe('autopilot_validation_conflict')
      expect(harness.owner.getTask(pending.taskId)?.status).toBe('blocked')
    })

    it('refuses a waiver by anyone but the user or dot, and a second decision', () => {
      const first = inconclusive()
      expect(
        errorCodeOf(() =>
          outcome().waive({
            validationId: first.validationId,
            by: 'primary' as never,
            timestamp: fixtureTime(10)
          })
        )
      ).toBe('autopilot_invalid_input')
      outcome().waive({ validationId: first.validationId, by: 'dot', timestamp: fixtureTime(10) })
      expect(
        errorCodeOf(() =>
          outcome().reject({
            validationId: first.validationId,
            by: 'dot',
            timestamp: fixtureTime(11)
          })
        )
      ).toBe('autopilot_validation_conflict')
    })
  })

  describe('refusals', () => {
    it('refuses a second verdict after a final one, and an unknown validation', () => {
      const first = claimed()
      outcome().recordVerdict(passInput(first.validationId))
      expect(
        errorCodeOf(() =>
          outcome().recordVerdict(passInput(first.validationId, { verdict: 'fail', checks: [] }))
        )
      ).toBe('autopilot_validation_conflict')
      expect(errorCodeOf(() => outcome().recordVerdict(passInput('validation_unknown')))).toBe(
        'autopilot_validation_not_found'
      )
    })

    it('refuses a verdict once the attempt is no longer waiting for one', () => {
      const first = claimed()
      harness.owner.beginWorkerStop(first.dispatchId, 'fixture_epoch')
      expect(errorCodeOf(() => outcome().recordVerdict(passInput(first.validationId)))).toBe(
        'autopilot_attempt_conflict'
      )
      expect(validations().get(first.validationId)?.verdict).toBe('pending')
    })

    it('refuses malformed input, a secret in the result or notice, and an unknown key', () => {
      const first = claimed()
      const refuse = (overrides: Partial<RecordVerdictInput>) =>
        errorCodeOf(() => outcome().recordVerdict(passInput(first.validationId, overrides)))
      expect(refuse({ verdict: 'pending' as never })).toBe('autopilot_invalid_input')
      expect(refuse({ resultSummary: 'x'.repeat(1001) })).toBe('autopilot_invalid_input')
      expect(refuse({ resultSummary: `Key ${FAKE_SECRET}` })).toBe('autopilot_unredacted_text')
      expect(refuse({ notice: { subject: `Key ${FAKE_SECRET}` } })).toBe(
        'autopilot_unredacted_text'
      )
      expect(refuse({ extra: 1 } as never)).toBe('autopilot_invalid_input')
      expect(harness.owner.getTask(first.taskId)?.status).toBe('blocked')
    })

    it('refuses an attempt Orca no longer holds, after a reset', () => {
      const first = claimed()
      harness.owner.resetAll()
      expect(errorCodeOf(() => outcome().recordVerdict(passInput(first.validationId)))).toBe(
        'autopilot_attempt_orphaned'
      )
      expect(
        errorCodeOf(() =>
          outcome().waive({
            validationId: first.validationId,
            by: 'dot',
            timestamp: fixtureTime(10)
          })
        )
      ).toBe('autopilot_attempt_orphaned')
      expect(validations().get(first.validationId)).toMatchObject({
        verdict: 'pending',
        orphaned: true
      })
    })

    it('opens its own transaction and refuses a connection that is already in one', () => {
      const first = claimed()
      harness.owner.db.exec('BEGIN IMMEDIATE')
      try {
        expect(errorCodeOf(() => outcome().recordVerdict(passInput(first.validationId)))).toBe(
          'autopilot_transaction_unavailable'
        )
      } finally {
        harness.owner.db.exec('ROLLBACK')
      }
    })
  })
})
