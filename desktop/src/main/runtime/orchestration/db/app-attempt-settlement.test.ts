import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectAttemptOutcome } from './attempt-outcome-projection'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

describe('app attempt settlement', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const settlement = () => getAppAttemptSettlement(harness.owner)
  function begin() {
    const seeded = seedRoutedTask(harness)
    const view = settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'in_session',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    return { ...seeded, dispatchId: view.dispatchId }
  }
  function running() {
    const attempt = begin()
    settlement().markRunning({ dispatchId: attempt.dispatchId, timestamp: fixtureTime(6) })
    return attempt
  }
  const orca = (dispatchId: string, taskId: string) => ({
    task: harness.owner.getTask(taskId),
    dispatch: harness.owner.getDispatchContextById(dispatchId),
    worker: harness.owner.getWorkerDispatch(dispatchId)
  })
  const factsOf = (dispatchId: string) =>
    harness.owner.getAttemptObservationFacts(dispatchId).map((fact) => ({
      facet: fact.facet,
      payload: fact.payload
    }))
  const failNextWrite = (table: 'worker_dispatches' | 'attempt_observation_facts' | 'messages') =>
    harness.owner.db.exec(
      `CREATE TRIGGER fixture_fail_${table} BEFORE ${table === 'worker_dispatches' ? 'UPDATE' : 'INSERT'} ON ${table}
         BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`
    )

  describe('markRunning', () => {
    it('opens the Dispatch and readies the worker together', () => {
      const { dispatchId, taskId } = begin()
      const view = settlement().markRunning({ dispatchId, timestamp: fixtureTime(6) })
      expect(view).toMatchObject({
        taskStatus: 'dispatched',
        dispatchStatus: 'dispatched',
        workerState: 'ready',
        workerStage: 'executor_running'
      })
      expect(orca(dispatchId, taskId).worker?.updated_at).toBe(fixtureTime(6))
    })

    it('refuses retired executable evidence and writes nothing', () => {
      const { dispatchId, taskId } = begin()
      const input = {
        dispatchId,
        executableEvidence: { executable: 'codex' },
        timestamp: fixtureTime(6)
      }
      expect(errorCodeOf(() => settlement().markRunning(input))).toBe('autopilot_invalid_input')
      expect(orca(dispatchId, taskId).worker?.state).toBe('starting')
    })

    it('refuses an attempt that is not starting, and one that is not an app attempt', () => {
      const { dispatchId } = running()
      expect(
        errorCodeOf(() => settlement().markRunning({ dispatchId, timestamp: fixtureTime(7) }))
      ).toBe('autopilot_attempt_conflict')
      expect(
        errorCodeOf(() =>
          settlement().markRunning({ dispatchId: 'ctx_unknown', timestamp: fixtureTime(7) })
        )
      ).toBe('autopilot_attempt_not_found')
      const plain = harness.owner.createTask({
        spec: 'A task with no TaskSpec.',
        runId: harness.runId
      })
      const started = harness.owner.createStartingWorkerDispatch({
        taskId: plain.id,
        startOptions: {},
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER
      })
      expect(
        errorCodeOf(() =>
          settlement().markRunning({ dispatchId: started.dispatch.id, timestamp: fixtureTime(7) })
        )
      ).toBe('autopilot_attempt_not_found')
    })

    it('rolls back the Dispatch when the worker cannot become ready', () => {
      const { dispatchId, taskId } = begin()
      failNextWrite('worker_dispatches')
      expect(() => settlement().markRunning({ dispatchId, timestamp: fixtureTime(6) })).toThrow(
        'fixture failure'
      )
      expect(orca(dispatchId, taskId)).toMatchObject({
        dispatch: { status: 'pending' },
        worker: { state: 'starting', stage: 'accepted' },
        task: { status: 'dispatched' }
      })
    })
  })

  describe('markStartFailed', () => {
    it('fails the starting attempt and the task', () => {
      const { dispatchId, taskId } = begin()
      const view = settlement().markStartFailed({
        dispatchId,
        reason: 'start_failed',
        timestamp: fixtureTime(6)
      })
      expect(view).toMatchObject({
        taskStatus: 'failed',
        dispatchStatus: 'failed',
        workerState: 'failed',
        workerStage: 'start_failed'
      })
      expect(orca(dispatchId, taskId)).toMatchObject({
        dispatch: { failure_count: 1, last_failure: 'start_failed' },
        worker: { last_error: 'start_failed' }
      })
    })

    it('only applies while starting, and takes a reason code', () => {
      const { dispatchId } = running()
      expect(
        errorCodeOf(() =>
          settlement().markStartFailed({
            dispatchId,
            reason: 'start_failed',
            timestamp: fixtureTime(7)
          })
        )
      ).toBe('autopilot_attempt_conflict')
      const fresh = begin()
      expect(
        errorCodeOf(() =>
          settlement().markStartFailed({
            dispatchId: fresh.dispatchId,
            reason: 'It broke.',
            timestamp: fixtureTime(7)
          })
        )
      ).toBe('autopilot_invalid_input')
    })
  })

  describe('settleClaim', () => {
    it('records the claim and leaves the task blocked, never completed', () => {
      const { dispatchId, taskId } = running()
      const view = settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7) })
      expect(view).toMatchObject({
        taskStatus: 'blocked',
        dispatchStatus: 'dispatched',
        workerState: 'ready',
        workerStage: 'validation_pending'
      })
      expect(orca(dispatchId, taskId).task).toMatchObject({
        status: 'blocked',
        completed_at: null,
        result: null
      })
    })

    it('records the claim as finished but unverified, not as an accepted report', () => {
      const { dispatchId, taskId } = running()
      settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7) })
      expect(factsOf(dispatchId)).toEqual([
        {
          facet: 'outcome',
          payload: { outcome: 'finished_unverified', reason: 'executor_claim_awaiting_validation' }
        }
      ])
      expect(
        projectAttemptOutcome({
          dispatchId,
          taskId,
          facts: harness.owner.getAttemptObservationFacts(dispatchId),
          authorityNow: { home: Date.parse(fixtureTime(8)) }
        })
      ).toMatchObject({ outcome: 'finished_unverified', workerReport: null })
    })

    it('rejects process evidence without changing the running task', () => {
      const { dispatchId, taskId } = running()
      const input = { dispatchId, exitCode: 0, timestamp: fixtureTime(7) }
      expect(errorCodeOf(() => settlement().settleClaim(input))).toBe('autopilot_invalid_input')
      expect(orca(dispatchId, taskId).task?.status).toBe('dispatched')
    })

    it('refuses an attempt that is not running, and a second claim', () => {
      const starting = begin()
      expect(
        errorCodeOf(() =>
          settlement().settleClaim({ dispatchId: starting.dispatchId, timestamp: fixtureTime(7) })
        )
      ).toBe('autopilot_attempt_conflict')
      const { dispatchId } = running()
      settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7) })
      expect(
        errorCodeOf(() => settlement().settleClaim({ dispatchId, timestamp: fixtureTime(8) }))
      ).toBe('autopilot_attempt_conflict')
      expect(
        errorCodeOf(() =>
          settlement().settleClaim({ dispatchId: 'ctx_unknown', timestamp: fixtureTime(8) })
        )
      ).toBe('autopilot_attempt_not_found')
    })

    it('rolls back the claim when its observation cannot be recorded', () => {
      const { dispatchId, taskId } = running()
      failNextWrite('attempt_observation_facts')
      expect(() => settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7) })).toThrow(
        'fixture failure'
      )
      expect(orca(dispatchId, taskId)).toMatchObject({
        task: { status: 'dispatched' },
        worker: { state: 'ready', stage: 'executor_running' }
      })
      expect(factsOf(dispatchId)).toEqual([])
    })
  })

  describe('settleFailure', () => {
    it('fails the attempt and task with an accepted worker report of failure', () => {
      const { dispatchId, taskId } = running()
      const view = settlement().settleFailure({
        dispatchId,
        outcome: 'failed',
        reason: 'reported_failed',
        timestamp: fixtureTime(7)
      })
      expect(view).toMatchObject({
        taskStatus: 'failed',
        dispatchStatus: 'failed',
        workerState: 'failed',
        workerStage: 'executor_failed'
      })
      expect(orca(dispatchId, taskId)).toMatchObject({
        dispatch: { failure_count: 1, last_failure: 'reported_failed' },
        worker: { last_error: 'reported_failed' },
        task: { status: 'failed' }
      })
      expect(orca(dispatchId, taskId).task?.completed_at).toBeTruthy()
      expect(factsOf(dispatchId)).toEqual([
        {
          facet: 'worker_report',
          payload: expect.objectContaining({ status: 'accepted', outcome: 'failed' })
        }
      ])
    })

    it('rejects blocked outcomes, free text reasons and process evidence', () => {
      const { dispatchId, taskId } = running()
      const fail = (extra: object) =>
        errorCodeOf(() =>
          settlement().settleFailure({
            dispatchId,
            outcome: 'failed',
            reason: 'reported_failed',
            timestamp: fixtureTime(7),
            ...extra
          })
        )
      expect(fail({ outcome: 'blocked' })).toBe('autopilot_invalid_input')
      expect(fail({ reason: 'It broke.' })).toBe('autopilot_invalid_input')
      expect(fail({ tree: { verdict: 'exited', method: 'root_exit_only' } })).toBe(
        'autopilot_invalid_input'
      )
      expect(orca(dispatchId, taskId).task?.status).toBe('dispatched')
    })

    it('only applies to a running attempt, never one starting or already claimed', () => {
      const starting = begin()
      const claimed = running()
      settlement().settleClaim({ dispatchId: claimed.dispatchId, timestamp: fixtureTime(7) })
      for (const { dispatchId } of [starting, claimed]) {
        expect(
          errorCodeOf(() =>
            settlement().settleFailure({
              dispatchId,
              outcome: 'failed',
              reason: 'reported_failed',
              timestamp: fixtureTime(8)
            })
          )
        ).toBe('autopilot_attempt_conflict')
      }
    })

    it('rolls back failure when the worker report cannot be recorded', () => {
      const { dispatchId, taskId } = running()
      failNextWrite('attempt_observation_facts')
      expect(() =>
        settlement().settleFailure({
          dispatchId,
          outcome: 'failed',
          reason: 'reported_failed',
          timestamp: fixtureTime(7)
        })
      ).toThrow('fixture failure')
      expect(orca(dispatchId, taskId)).toMatchObject({
        task: { status: 'dispatched' },
        dispatch: { status: 'dispatched', failure_count: 0 },
        worker: { state: 'ready' }
      })
      expect(factsOf(dispatchId)).toEqual([])
    })
  })

  describe('notices', () => {
    it('files one English status message in the run mailbox in the same transaction', () => {
      const { dispatchId } = running()
      const view = settlement().settleFailure({
        dispatchId,
        outcome: 'failed',
        reason: 'reported_failed',
        timestamp: fixtureTime(7),
        notice: {
          subject: 'Attempt failed for a delegated task.',
          body: 'The session reported an error.'
        }
      })
      expect(view.notice).toMatchObject({
        run_id: harness.runId,
        from_handle: `dispatch:${dispatchId}`,
        to_handle: `run:${harness.runId}`,
        type: 'status',
        priority: 'high',
        subject: 'Attempt failed for a delegated task.',
        body: 'The session reported an error.'
      })
      expect(JSON.parse(view.notice?.payload ?? '')).toMatchObject({
        dispatchId,
        outcome: 'failed'
      })
    })

    it('refuses a notice that is multi-line or holds a secret, and writes nothing', () => {
      const { dispatchId, taskId } = running()
      const claim = (notice: { subject: string; body?: string }) =>
        errorCodeOf(() =>
          settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7), notice })
        )
      expect(claim({ subject: 'Two\nlines' })).toBe('autopilot_invalid_input')
      expect(claim({ subject: '' })).toBe('autopilot_invalid_input')
      expect(claim({ subject: 'Fine', body: 'x'.repeat(2001) })).toBe('autopilot_invalid_input')
      expect(claim({ subject: `Key ${FAKE_SECRET}` })).toBe('autopilot_unredacted_text')
      expect(orca(dispatchId, taskId)).toMatchObject({
        task: { status: 'dispatched' },
        worker: { state: 'ready', stage: 'executor_running' }
      })
    })

    it('rolls back the lifecycle and report if the notice cannot be filed', () => {
      const { dispatchId, taskId } = running()
      failNextWrite('messages')
      expect(() =>
        settlement().settleFailure({
          dispatchId,
          outcome: 'failed',
          reason: 'reported_failed',
          timestamp: fixtureTime(7),
          notice: { subject: 'Attempt failed.' }
        })
      ).toThrow('fixture failure')
      expect(orca(dispatchId, taskId)).toMatchObject({
        task: { status: 'dispatched' },
        dispatch: { status: 'dispatched', failure_count: 0 },
        worker: { state: 'ready' }
      })
      expect(factsOf(dispatchId)).toEqual([])
    })
  })

  describe('listAwaitingValidation', () => {
    it('lists the claimed attempts whose task waits, oldest first', () => {
      const first = running()
      const second = running()
      running()
      settlement().settleClaim({ dispatchId: first.dispatchId, timestamp: fixtureTime(7) })
      settlement().settleClaim({ dispatchId: second.dispatchId, timestamp: fixtureTime(8) })
      expect(settlement().listAwaitingValidation(10)).toEqual([
        expect.objectContaining({
          taskId: first.taskId,
          dispatchId: first.dispatchId,
          runId: harness.runId,
          stage: 'validation_pending'
        }),
        expect.objectContaining({ taskId: second.taskId, dispatchId: second.dispatchId })
      ])
      expect(settlement().listAwaitingValidation(1)).toHaveLength(1)
      expect(errorCodeOf(() => settlement().listAwaitingValidation(0))).toBe(
        'autopilot_invalid_input'
      )
    })
  })
})
