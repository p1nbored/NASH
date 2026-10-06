import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectAttemptOutcome } from './attempt-outcome-projection'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import { getExecutorProcessStore } from './executor-process-store'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { FIXTURE_HASH_B, errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

const SUBAGENT_ROUTE = {
  target: 'claude_subagent',
  model: 'claude-sonnet-5-5',
  policyLevel: 'max',
  cliSetting: null
} as const
const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const
const RUNNING = { executableEvidence: { executable: 'codex', version: '0.160.0' } }
const CLAIM = {
  exitCode: 0,
  tree: EXITED,
  lastMessage: { sha256: FIXTURE_HASH_B, bytes: 120, secretLike: false },
  verdict: { kind: 'finished' },
  usage: { input_tokens: 10, output_tokens: 20 }
}

describe('app attempt settlement', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const settlement = () => getAppAttemptSettlement(harness.owner)

  /** A started attempt; `inSession` attempts have no executor row. */
  function begin(options: { inSession?: boolean; deps?: string[] } = {}) {
    const seeded = seedRoutedTask(harness, {
      deps: options.deps,
      route: options.inSession ? SUBAGENT_ROUTE : {}
    })
    const view = settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: options.inSession ? 'in_session' : 'codex_cli',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    return { ...seeded, dispatchId: view.dispatchId, inSession: options.inSession === true }
  }
  function running(options: { inSession?: boolean } = {}) {
    const attempt = begin(options)
    settlement().markRunning({
      dispatchId: attempt.dispatchId,
      ...(attempt.inSession ? {} : RUNNING),
      timestamp: fixtureTime(6)
    })
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
  const failNextWrite = (table: string) =>
    harness.owner.db.exec(
      `CREATE TRIGGER fixture_fail_${table} BEFORE ${table === 'executor_processes' ? 'UPDATE' : 'INSERT'} ON ${table}
         BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`
    )

  describe('markRunning', () => {
    it('opens the Dispatch and readies the worker together with the executor row', () => {
      const { dispatchId, taskId } = begin()
      const view = settlement().markRunning({
        dispatchId,
        ...RUNNING,
        threadId: 'thread_fixture01',
        timestamp: fixtureTime(6)
      })
      expect(view).toMatchObject({
        taskStatus: 'dispatched',
        dispatchStatus: 'dispatched',
        workerState: 'ready',
        workerStage: 'executor_running',
        executor: {
          state: 'running',
          executableEvidence: RUNNING.executableEvidence,
          threadId: 'thread_fixture01'
        }
      })
      expect(orca(dispatchId, taskId).worker?.updated_at).toBeTruthy()
    })

    it('readies an in-session worker with no executor row', () => {
      const { dispatchId } = begin({ inSession: true })
      const view = settlement().markRunning({ dispatchId, timestamp: fixtureTime(6) })
      expect(view).toMatchObject({
        workerState: 'ready',
        workerStage: 'executor_running',
        executor: null
      })
    })

    it('needs executable evidence for a process and refuses it for an in-session attempt', () => {
      const process = begin()
      const session = begin({ inSession: true })
      expect(
        errorCodeOf(() =>
          settlement().markRunning({ dispatchId: process.dispatchId, timestamp: fixtureTime(6) })
        )
      ).toBe('autopilot_invalid_input')
      expect(
        errorCodeOf(() =>
          settlement().markRunning({
            dispatchId: session.dispatchId,
            ...RUNNING,
            timestamp: fixtureTime(6)
          })
        )
      ).toBe('autopilot_invalid_input')
      expect(orca(process.dispatchId, process.taskId).worker?.state).toBe('starting')
    })

    it('refuses an attempt that is not starting, and one that is not an app attempt', () => {
      const { dispatchId } = running()
      expect(
        errorCodeOf(() =>
          settlement().markRunning({ dispatchId, ...RUNNING, timestamp: fixtureTime(7) })
        )
      ).toBe('autopilot_attempt_conflict')
      expect(
        errorCodeOf(() =>
          settlement().markRunning({
            dispatchId: 'ctx_unknown',
            ...RUNNING,
            timestamp: fixtureTime(7)
          })
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
          settlement().markRunning({
            dispatchId: started.dispatch.id,
            ...RUNNING,
            timestamp: fixtureTime(7)
          })
        )
      ).toBe('autopilot_attempt_not_found')
    })

    it('writes nothing to Orca when the executor row cannot move', () => {
      const { dispatchId, taskId } = begin()
      failNextWrite('executor_processes')
      expect(() =>
        settlement().markRunning({ dispatchId, ...RUNNING, timestamp: fixtureTime(6) })
      ).toThrow('fixture failure')
      expect(orca(dispatchId, taskId)).toMatchObject({
        dispatch: { status: 'pending' },
        worker: { state: 'starting', stage: 'accepted' },
        task: { status: 'dispatched' }
      })
    })
  })

  describe('markStartFailed', () => {
    it('fails the attempt and the task when the process provably never started', () => {
      const { dispatchId, taskId } = begin()
      const view = settlement().markStartFailed({
        dispatchId,
        reason: 'spawn_failed',
        timestamp: fixtureTime(6)
      })
      expect(view).toMatchObject({
        taskStatus: 'failed',
        dispatchStatus: 'failed',
        workerState: 'failed',
        workerStage: 'start_failed',
        executor: {
          state: 'failed',
          treeVerdict: 'exited',
          treeMethod: 'not_started',
          verdict: { reason: 'spawn_failed' },
          settledAt: fixtureTime(6)
        }
      })
      expect(orca(dispatchId, taskId)).toMatchObject({
        dispatch: { failure_count: 1, last_failure: 'spawn_failed' },
        worker: { last_error: 'spawn_failed' }
      })
    })

    it('only applies to an attempt that is still starting, and takes a code, not text', () => {
      const { dispatchId } = running()
      expect(
        errorCodeOf(() =>
          settlement().markStartFailed({
            dispatchId,
            reason: 'spawn_failed',
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

  describe('markStartUnknown', () => {
    it('blocks the task and keeps the start unknown, never retrying it', () => {
      const { dispatchId, taskId } = begin()
      const view = settlement().markStartUnknown({
        dispatchId,
        reason: 'restart',
        timestamp: fixtureTime(6)
      })
      expect(view).toMatchObject({
        taskStatus: 'blocked',
        dispatchStatus: 'pending',
        workerState: 'start_unknown',
        workerStage: 'start_outcome_unknown',
        executor: { state: 'start_unknown', verdict: { reason: 'restart' }, treeVerdict: null }
      })
      expect(orca(dispatchId, taskId).worker?.last_error).toBe('restart')
    })

    it('covers an in-session attempt too', () => {
      const { dispatchId } = begin({ inSession: true })
      expect(
        settlement().markStartUnknown({ dispatchId, reason: 'restart', timestamp: fixtureTime(6) })
      ).toMatchObject({
        workerState: 'start_unknown',
        executor: null
      })
    })
  })

  describe('an attempt whose executor row was never written', () => {
    // Why: the Dispatch and the executor row are written one after the other, so a crash between them
    // leaves a starting Dispatch with no row. No process can exist then, because the row is written first.
    function unrecordedStart() {
      const seeded = seedRoutedTask(harness)
      const started = harness.owner.createStartingWorkerDispatch({
        taskId: seeded.taskId,
        startOptions: { executor: 'codex_cli', route_id: seeded.routeId },
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER
      })
      return { ...seeded, dispatchId: started.dispatch.id }
    }

    it('is listed for reconciliation, and an attempt that has its row is not', () => {
      const orphan = unrecordedStart()
      begin()
      expect(settlement().listUnrecordedStarts(10)).toEqual([
        { dispatchId: orphan.dispatchId, taskId: orphan.taskId, runId: harness.runId }
      ])
      expect(errorCodeOf(() => settlement().listUnrecordedStarts(0))).toBe(
        'autopilot_invalid_input'
      )
    })

    it('can only be recorded as a failed start, which leaves the task retryable', () => {
      const { dispatchId, taskId } = unrecordedStart()
      for (const record of [
        () =>
          settlement().markRunning({
            dispatchId,
            executableEvidence: { executable: 'codex' },
            timestamp: fixtureTime(6)
          }),
        () =>
          settlement().markStartUnknown({
            dispatchId,
            reason: 'restart',
            timestamp: fixtureTime(6)
          })
      ]) {
        expect(errorCodeOf(record)).toBe('autopilot_recovery_required')
      }
      const view = settlement().markStartFailed({
        dispatchId,
        reason: 'executor_record_missing',
        timestamp: fixtureTime(6)
      })
      expect(view).toMatchObject({ taskStatus: 'failed', workerState: 'failed', executor: null })
      expect(orca(dispatchId, taskId).dispatch?.last_failure).toBe('executor_record_missing')
      expect(settlement().listUnrecordedStarts(10)).toEqual([])
    })
  })

  describe('settleClaim', () => {
    it('records the claim and leaves the task blocked, never completed', () => {
      const { dispatchId, taskId } = running()
      const view = settlement().settleClaim({ dispatchId, ...CLAIM, timestamp: fixtureTime(7) })
      expect(view).toMatchObject({
        taskStatus: 'blocked',
        dispatchStatus: 'dispatched',
        workerState: 'ready',
        workerStage: 'validation_pending',
        executor: {
          state: 'completed',
          exitCode: 0,
          lastMessage: { sha256: FIXTURE_HASH_B, bytes: 120, secretLike: false },
          settledAt: fixtureTime(7)
        }
      })
      expect(orca(dispatchId, taskId).task).toMatchObject({
        status: 'blocked',
        completed_at: null,
        result: null
      })
    })

    it('records the claim as finished but unverified, not as an accepted report', () => {
      const { dispatchId, taskId } = running()
      settlement().settleClaim({ dispatchId, ...CLAIM, timestamp: fixtureTime(7) })
      expect(factsOf(dispatchId)).toEqual([
        {
          facet: 'outcome',
          payload: { outcome: 'finished_unverified', reason: 'executor_claim_awaiting_validation' }
        }
      ])
      const projection = projectAttemptOutcome({
        dispatchId,
        taskId,
        facts: harness.owner.getAttemptObservationFacts(dispatchId),
        authorityNow: { home: Date.parse(fixtureTime(8)) }
      })
      expect(projection).toMatchObject({ outcome: 'finished_unverified', workerReport: null })
    })

    it('flags a secret-shaped last message without keeping its text', () => {
      const { dispatchId } = running()
      const view = settlement().settleClaim({
        dispatchId,
        ...CLAIM,
        lastMessage: { sha256: FIXTURE_HASH_B, bytes: 9, secretLike: true },
        timestamp: fixtureTime(7)
      })
      expect(view.executor?.lastMessage?.secretLike).toBe(true)
    })

    it('records an in-session claim with no executor evidence', () => {
      const { dispatchId } = running({ inSession: true })
      const view = settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7) })
      expect(view).toMatchObject({
        taskStatus: 'blocked',
        workerStage: 'validation_pending',
        executor: null
      })
    })

    it('needs the evidence of a finished process, and refuses it for an in-session attempt', () => {
      const process = running()
      const session = running({ inSession: true })
      const claim = (dispatchId: string, extra: object) =>
        errorCodeOf(() =>
          settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7), ...extra })
        )
      expect(claim(process.dispatchId, {})).toBe('autopilot_invalid_input')
      expect(claim(process.dispatchId, { ...CLAIM, exitCode: 1 })).toBe('autopilot_invalid_input')
      expect(claim(process.dispatchId, { ...CLAIM, lastMessage: null })).toBe(
        'autopilot_invalid_input'
      )
      expect(claim(session.dispatchId, CLAIM)).toBe('autopilot_invalid_input')
      expect(orca(process.dispatchId, process.taskId).task?.status).toBe('dispatched')
    })

    it('refuses an attempt that is not running, and a second claim', () => {
      const starting = begin()
      expect(
        errorCodeOf(() =>
          settlement().settleClaim({
            dispatchId: starting.dispatchId,
            ...CLAIM,
            timestamp: fixtureTime(7)
          })
        )
      ).toBe('autopilot_attempt_conflict')
      const { dispatchId } = running()
      settlement().settleClaim({ dispatchId, ...CLAIM, timestamp: fixtureTime(7) })
      expect(
        errorCodeOf(() =>
          settlement().settleClaim({ dispatchId, ...CLAIM, timestamp: fixtureTime(8) })
        )
      ).toBe('autopilot_attempt_conflict')
      expect(
        errorCodeOf(() =>
          settlement().settleClaim({
            dispatchId: 'ctx_unknown',
            ...CLAIM,
            timestamp: fixtureTime(8)
          })
        )
      ).toBe('autopilot_attempt_not_found')
    })

    it('writes nothing when any part of the claim cannot be recorded', () => {
      const { dispatchId, taskId } = running()
      failNextWrite('executor_processes')
      expect(() =>
        settlement().settleClaim({ dispatchId, ...CLAIM, timestamp: fixtureTime(7) })
      ).toThrow('fixture failure')
      expect(orca(dispatchId, taskId)).toMatchObject({
        task: { status: 'dispatched' },
        worker: { state: 'ready', stage: 'executor_running' }
      })
      expect(factsOf(dispatchId)).toEqual([])
      const session = running({ inSession: true })
      failNextWrite('attempt_observation_facts')
      expect(() =>
        settlement().settleClaim({ dispatchId: session.dispatchId, timestamp: fixtureTime(7) })
      ).toThrow('fixture failure')
      expect(orca(session.dispatchId, session.taskId).task?.status).toBe('dispatched')
    })
  })

  describe('settleFailure', () => {
    it('fails the attempt and the task, with the tree proof and a worker report of failure', () => {
      const { dispatchId, taskId } = running()
      const view = settlement().settleFailure({
        dispatchId,
        outcome: 'failed',
        reason: 'executor_failed',
        exitCode: 2,
        tree: EXITED,
        timestamp: fixtureTime(7)
      })
      expect(view).toMatchObject({
        taskStatus: 'failed',
        dispatchStatus: 'failed',
        workerState: 'failed',
        workerStage: 'executor_failed',
        executor: {
          state: 'failed',
          exitCode: 2,
          treeVerdict: 'exited',
          verdict: { reason: 'executor_failed' }
        }
      })
      expect(orca(dispatchId, taskId)).toMatchObject({
        dispatch: { failure_count: 1, last_failure: 'executor_failed' },
        worker: { last_error: 'executor_failed' },
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

    it('records a run the route blocked (auth or quota) as blocked, and still fails the task', () => {
      const { dispatchId } = running()
      const view = settlement().settleFailure({
        dispatchId,
        outcome: 'blocked',
        reason: 'auth_failed',
        tree: EXITED,
        timestamp: fixtureTime(7)
      })
      expect(view).toMatchObject({
        taskStatus: 'failed',
        workerStage: 'executor_blocked',
        executor: { state: 'blocked' }
      })
    })

    it('fails an in-session attempt, and refuses a blocked outcome for it', () => {
      const first = running({ inSession: true })
      expect(
        errorCodeOf(() =>
          settlement().settleFailure({
            dispatchId: first.dispatchId,
            outcome: 'blocked',
            reason: 'auth_failed',
            timestamp: fixtureTime(7)
          })
        )
      ).toBe('autopilot_invalid_input')
      const view = settlement().settleFailure({
        dispatchId: first.dispatchId,
        outcome: 'failed',
        reason: 'reported_failed',
        timestamp: fixtureTime(7)
      })
      expect(view).toMatchObject({ taskStatus: 'failed', workerState: 'failed', executor: null })
    })

    it('only applies to a running attempt, never to one that is starting or already claimed', () => {
      const starting = begin()
      const claimed = running()
      settlement().settleClaim({
        dispatchId: claimed.dispatchId,
        ...CLAIM,
        timestamp: fixtureTime(7)
      })
      for (const { dispatchId } of [starting, claimed]) {
        expect(
          errorCodeOf(() =>
            settlement().settleFailure({
              dispatchId,
              outcome: 'failed',
              reason: 'executor_failed',
              tree: EXITED,
              timestamp: fixtureTime(8)
            })
          )
        ).toBe('autopilot_attempt_conflict')
      }
    })

    it('takes a reason code and a tree proof for a process', () => {
      const { dispatchId } = running()
      const fail = (extra: object) =>
        errorCodeOf(() =>
          settlement().settleFailure({
            dispatchId,
            outcome: 'failed',
            reason: 'executor_failed',
            timestamp: fixtureTime(7),
            ...extra
          })
        )
      expect(fail({ tree: EXITED, reason: 'It broke.' })).toBe('autopilot_invalid_input')
      expect(fail({})).toBe('autopilot_invalid_input')
      expect(fail({ tree: EXITED, verdict: { text: FAKE_SECRET } })).toBe(
        'autopilot_unredacted_text'
      )
    })

    it('writes nothing when any part of the failure cannot be recorded', () => {
      const { dispatchId, taskId } = running()
      failNextWrite('executor_processes')
      expect(() =>
        settlement().settleFailure({
          dispatchId,
          outcome: 'failed',
          reason: 'executor_failed',
          tree: EXITED,
          timestamp: fixtureTime(7)
        })
      ).toThrow('fixture failure')
      expect(orca(dispatchId, taskId)).toMatchObject({
        task: { status: 'dispatched' },
        dispatch: { status: 'dispatched' },
        worker: { state: 'ready' }
      })
    })
  })

  describe('settleStop', () => {
    it('settles a stop with proof of exit as stopped, and blocks the task for a retry', () => {
      const { dispatchId, taskId } = running()
      const view = settlement().settleStop({
        dispatchId,
        stopVerdict: 'exited',
        reason: 'user_stop',
        timestamp: fixtureTime(7)
      })
      expect(view).toMatchObject({
        taskStatus: 'blocked',
        dispatchStatus: 'failed',
        workerState: 'stopped',
        workerStage: 'process_stopped',
        executor: { state: 'stopped', stopVerdict: 'exited', verdict: { reason: 'user_stop' } }
      })
      expect(orca(dispatchId, taskId).dispatch?.last_failure).toBe('stopped')
    })

    it('keeps a stop that cannot be proven as unknown, with the Dispatch still open', () => {
      for (const stopVerdict of ['live', 'unverifiable'] as const) {
        const { dispatchId } = running()
        const view = settlement().settleStop({
          dispatchId,
          stopVerdict,
          reason: 'restart',
          timestamp: fixtureTime(7)
        })
        expect(view).toMatchObject({
          taskStatus: 'blocked',
          dispatchStatus: 'dispatched',
          workerState: 'stop_unknown',
          workerStage: 'stop_outcome_unknown',
          executor: { state: 'stop_unknown', stopVerdict }
        })
      }
    })

    it('settles an unknown stop once a later check proves the exit', () => {
      const { dispatchId } = running()
      settlement().settleStop({
        dispatchId,
        stopVerdict: 'unverifiable',
        reason: 'restart',
        timestamp: fixtureTime(7)
      })
      const view = settlement().settleStop({
        dispatchId,
        stopVerdict: 'exited',
        reason: 'exit_confirmed',
        timestamp: fixtureTime(8)
      })
      expect(view).toMatchObject({
        dispatchStatus: 'failed',
        workerState: 'stopped',
        executor: { state: 'stopped', stopVerdict: 'exited' }
      })
      expect(
        errorCodeOf(() =>
          settlement().settleStop({
            dispatchId,
            stopVerdict: 'unverifiable',
            reason: 'restart',
            timestamp: fixtureTime(9)
          })
        )
      ).toBe('autopilot_attempt_conflict')
    })

    it('settles the stop of an attempt that never ran, and of one Orca already marked stopping', () => {
      const starting = begin()
      expect(
        settlement().settleStop({
          dispatchId: starting.dispatchId,
          stopVerdict: 'exited',
          reason: 'user_stop',
          timestamp: fixtureTime(7)
        })
      ).toMatchObject({
        workerState: 'stopped',
        executor: { state: 'stopped' }
      })
      const stopping = running()
      harness.owner.beginWorkerStop(stopping.dispatchId, 'fixture_epoch')
      expect(
        settlement().settleStop({
          dispatchId: stopping.dispatchId,
          stopVerdict: 'exited',
          reason: 'user_stop',
          timestamp: fixtureTime(7)
        })
      ).toMatchObject({
        workerState: 'stopped',
        taskStatus: 'blocked'
      })
    })

    it('keeps a stop Orca already began as unknown when the exit is not proven', () => {
      const { dispatchId } = running()
      harness.owner.beginWorkerStop(dispatchId, 'fixture_epoch')
      const view = settlement().settleStop({
        dispatchId,
        stopVerdict: 'live',
        tree: { verdict: 'live', method: 'windows_descendant_snapshot' },
        reason: 'tree_still_live',
        timestamp: fixtureTime(7)
      })
      expect(view).toMatchObject({
        taskStatus: 'blocked',
        dispatchStatus: 'dispatched',
        workerState: 'stop_unknown',
        executor: {
          state: 'stop_unknown',
          stopVerdict: 'live',
          treeVerdict: 'live',
          verdict: { reason: 'tree_still_live' }
        }
      })
    })

    it('stops an in-session attempt with no executor row', () => {
      const { dispatchId } = running({ inSession: true })
      expect(
        settlement().settleStop({
          dispatchId,
          stopVerdict: 'exited',
          reason: 'user_stop',
          timestamp: fixtureTime(7)
        })
      ).toMatchObject({
        workerState: 'stopped',
        executor: null
      })
    })

    it('refuses a claimed attempt, which has no process left to stop', () => {
      const process = running()
      const session = running({ inSession: true })
      settlement().settleClaim({
        dispatchId: process.dispatchId,
        ...CLAIM,
        timestamp: fixtureTime(7)
      })
      settlement().settleClaim({ dispatchId: session.dispatchId, timestamp: fixtureTime(7) })
      for (const { dispatchId } of [process, session]) {
        expect(
          errorCodeOf(() =>
            settlement().settleStop({
              dispatchId,
              stopVerdict: 'exited',
              reason: 'user_stop',
              timestamp: fixtureTime(8)
            })
          )
        ).toBe('autopilot_attempt_conflict')
      }
      expect(orca(session.dispatchId, session.taskId).worker?.state).toBe('ready')
    })

    it('refuses a verdict the executor evidence does not fit', () => {
      const { dispatchId } = running()
      expect(
        errorCodeOf(() =>
          settlement().settleStop({
            dispatchId,
            stopVerdict: 'gone' as never,
            reason: 'user_stop',
            timestamp: fixtureTime(7)
          })
        )
      ).toBe('autopilot_invalid_input')
      expect(
        errorCodeOf(() =>
          settlement().settleStop({
            dispatchId,
            stopVerdict: 'exited',
            reason: 'Stop it',
            timestamp: fixtureTime(7)
          })
        )
      ).toBe('autopilot_invalid_input')
    })
  })

  describe('notices', () => {
    it('files one English status message in the run mailbox in the same transaction', () => {
      const { dispatchId } = running()
      const view = settlement().settleFailure({
        dispatchId,
        outcome: 'failed',
        reason: 'executor_failed',
        tree: EXITED,
        timestamp: fixtureTime(7),
        notice: {
          subject: 'Attempt failed for a delegated task.',
          body: 'The executor exited with an error.'
        }
      })
      expect(view.notice).toMatchObject({
        run_id: harness.runId,
        from_handle: `dispatch:${dispatchId}`,
        to_handle: `run:${harness.runId}`,
        type: 'status',
        priority: 'high',
        subject: 'Attempt failed for a delegated task.',
        body: 'The executor exited with an error.'
      })
      expect(JSON.parse(view.notice?.payload ?? '')).toMatchObject({
        dispatchId,
        outcome: 'failed'
      })
    })

    it('refuses a notice that is multi-line or holds a secret, and writes nothing', () => {
      const { dispatchId, taskId } = running()
      const claim = (notice: object) =>
        errorCodeOf(() =>
          settlement().settleClaim({
            dispatchId,
            ...CLAIM,
            timestamp: fixtureTime(7),
            notice: notice as never
          })
        )
      expect(claim({ subject: 'Two\nlines' })).toBe('autopilot_invalid_input')
      expect(claim({ subject: '' })).toBe('autopilot_invalid_input')
      expect(claim({ subject: 'Fine', body: 'x'.repeat(2001) })).toBe('autopilot_invalid_input')
      expect(claim({ subject: `Key ${FAKE_SECRET}` })).toBe('autopilot_unredacted_text')
      expect(orca(dispatchId, taskId).task?.status).toBe('dispatched')
      expect(getExecutorProcessStore(harness.owner).get(dispatchId)?.state).toBe('running')
    })
  })

  describe('listAwaitingValidation', () => {
    it('lists the claimed attempts whose task waits, oldest first', () => {
      const first = running()
      const second = running()
      running()
      settlement().settleClaim({
        dispatchId: first.dispatchId,
        ...CLAIM,
        timestamp: fixtureTime(7)
      })
      settlement().settleClaim({
        dispatchId: second.dispatchId,
        ...CLAIM,
        timestamp: fixtureTime(8)
      })
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
