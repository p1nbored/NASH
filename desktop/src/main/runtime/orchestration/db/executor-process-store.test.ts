import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getExecutorProcessStore, type ExecutorProcessStartInput } from './executor-process-store'
import {
  EXECUTOR_PROCESS_TRANSITIONS,
  applyExecutorTransition,
  type ExecutorTransition
} from './executor-process-transition'
import { EXECUTOR_PROCESS_STATES } from './autopilot-task-schema-definition'
import {
  seedRoutedTask,
  seedStartedAttempt,
  startOrcaDispatch
} from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { FIXTURE_HASH_B, errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

const EXITED_TREE = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const
const RUNNING = { executableEvidence: { executable: 'codex', version: '0.160.0' } }
const COMPLETED = {
  exitCode: 0,
  tree: EXITED_TREE,
  lastMessage: { sha256: FIXTURE_HASH_B, bytes: 120, secretLike: false },
  verdict: { kind: 'finished' },
  usage: { input_tokens: 10, output_tokens: 20 }
}

describe('executor process store', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const store = () => getExecutorProcessStore(harness.owner)
  const rowCount = () =>
    harness.owner.db.prepare('SELECT count(*) AS n FROM executor_processes').get()?.n

  function startInput(
    taskId: string,
    routeId: string,
    dispatchId: string,
    overrides: Partial<ExecutorProcessStartInput> = {}
  ): ExecutorProcessStartInput {
    return {
      dispatchId,
      runId: harness.runId,
      taskId,
      executorKind: 'codex_cli',
      routeId,
      runDirectory: `autopilot-runs/${harness.runId}/${dispatchId}`,
      timestamp: fixtureTime(4),
      ...overrides
    }
  }

  it('is one store per database', () => {
    expect(getExecutorProcessStore(harness.owner)).toBe(store())
  })

  describe('insertStarting', () => {
    it('records the executor of a starting Dispatch with nothing settled', () => {
      const { taskId, routeId } = seedRoutedTask(harness)
      const { dispatchId } = startOrcaDispatch(harness, taskId, routeId)
      const record = store().insertStarting(startInput(taskId, routeId, dispatchId))
      expect(record).toEqual({
        dispatchId,
        runId: harness.runId,
        taskId,
        executorKind: 'codex_cli',
        routeId,
        state: 'starting',
        executableEvidence: null,
        runDirectory: `autopilot-runs/${harness.runId}/${dispatchId}`,
        threadId: null,
        treeVerdict: null,
        treeMethod: null,
        stopVerdict: null,
        exitCode: null,
        verdict: null,
        lastMessage: null,
        usage: null,
        startedAt: fixtureTime(4),
        settledAt: null,
        orphaned: false
      })
    })

    it('refuses a second row for the same Dispatch', () => {
      const { taskId, routeId } = seedRoutedTask(harness)
      const { dispatchId } = seedStartedAttempt(harness, taskId, routeId)
      expect(
        errorCodeOf(() => store().insertStarting(startInput(taskId, routeId, dispatchId)))
      ).toBe('autopilot_executor_conflict')
      expect(rowCount()).toBe(1)
    })

    it('refuses a Dispatch that Orca does not hold for this task and run', () => {
      const first = seedRoutedTask(harness)
      const second = seedRoutedTask(harness)
      const { dispatchId } = startOrcaDispatch(harness, second.taskId, second.routeId)
      const refused = (input: ExecutorProcessStartInput) =>
        errorCodeOf(() => store().insertStarting(input))
      expect(refused(startInput(first.taskId, first.routeId, 'ctx_unknown'))).toBe(
        'autopilot_attempt_not_found'
      )
      expect(refused(startInput(first.taskId, first.routeId, dispatchId))).toBe(
        'autopilot_attempt_not_found'
      )
      expect(
        refused(startInput(second.taskId, second.routeId, dispatchId, { runId: 'run_other' }))
      ).toBe('autopilot_attempt_not_found')
      expect(rowCount()).toBe(0)
    })

    it('refuses a Dispatch that is no longer starting', () => {
      const { taskId, routeId } = seedRoutedTask(harness)
      const { dispatchId } = startOrcaDispatch(harness, taskId, routeId)
      harness.owner.markWorkerDispatchReady(dispatchId)
      expect(
        errorCodeOf(() => store().insertStarting(startInput(taskId, routeId, dispatchId)))
      ).toBe('autopilot_attempt_conflict')
    })

    it('refuses a route that is missing, belongs to another task, or cannot be dispatched', () => {
      const first = seedRoutedTask(harness)
      const other = seedRoutedTask(harness)
      const unavailable = seedRoutedTask(harness, {
        route: { status: 'unavailable', reasons: ['auth_failed'] }
      })
      const unverified = seedRoutedTask(harness, {
        route: { status: 'unverified', reasons: ['auth_unobserved'] }
      })
      const agyRoute = seedRoutedTask(harness, {
        route: {
          target: 'agy_cli',
          model: 'gemini-3.8-flash-high',
          policyLevel: 'high',
          cliSetting: null
        }
      })
      const attempt = (task: { taskId: string; routeId: string }, routeId = task.routeId) => {
        const { dispatchId } = startOrcaDispatch(harness, task.taskId, task.routeId)
        return errorCodeOf(() =>
          store().insertStarting(startInput(task.taskId, routeId, dispatchId))
        )
      }
      expect(attempt(first, 'route_unknown')).toBe('autopilot_route_not_found')
      expect(attempt(other, first.routeId)).toBe('autopilot_route_not_found')
      expect(attempt(unavailable)).toBe('autopilot_route_not_dispatchable')
      expect(attempt(unverified)).toBe('autopilot_route_not_dispatchable')
      // Why: a Codex executor row must never run under a route that names another target.
      expect(attempt(agyRoute)).toBe('autopilot_route_not_dispatchable')
      expect(rowCount()).toBe(0)
    })

    it('refuses a route that is not for a headless executor target', () => {
      const claude = seedRoutedTask(harness, {
        route: {
          target: 'claude_subagent',
          model: 'claude-sonnet-5-5',
          policyLevel: 'max',
          cliSetting: null
        }
      })
      const { dispatchId } = startOrcaDispatch(harness, claude.taskId, claude.routeId)
      expect(
        errorCodeOf(() =>
          store().insertStarting(startInput(claude.taskId, claude.routeId, dispatchId))
        )
      ).toBe('autopilot_route_not_dispatchable')
    })

    it('refuses run directories that are not plain relative paths, and unknown keys', () => {
      const { taskId, routeId } = seedRoutedTask(harness)
      const { dispatchId } = startOrcaDispatch(harness, taskId, routeId)
      const bad = [
        '/abs/path',
        'C:/x',
        'C:\\x',
        'a\\b',
        '../x',
        'a/../b',
        'a/..',
        '',
        './a',
        'a//b',
        'a/'
      ]
      for (const runDirectory of bad) {
        expect(
          errorCodeOf(() =>
            store().insertStarting(startInput(taskId, routeId, dispatchId, { runDirectory }))
          )
        ).toBe('autopilot_invalid_input')
      }
      expect(
        errorCodeOf(() =>
          store().insertStarting({ ...startInput(taskId, routeId, dispatchId), extra: 1 } as never)
        )
      ).toBe('autopilot_invalid_input')
      expect(
        errorCodeOf(() =>
          store().insertStarting(
            startInput(taskId, routeId, dispatchId, { executorKind: 'claude' as never })
          )
        )
      ).toBe('autopilot_invalid_input')
      expect(rowCount()).toBe(0)
    })

    it('opens its own transaction and refuses a connection that is already in one', () => {
      const { taskId, routeId } = seedRoutedTask(harness)
      const { dispatchId } = startOrcaDispatch(harness, taskId, routeId)
      harness.owner.db.exec('BEGIN IMMEDIATE')
      try {
        expect(
          errorCodeOf(() => store().insertStarting(startInput(taskId, routeId, dispatchId)))
        ).toBe('autopilot_transaction_unavailable')
      } finally {
        harness.owner.db.exec('ROLLBACK')
      }
    })
  })

  describe('reads', () => {
    it('returns null for an unknown Dispatch', () => {
      expect(store().get('ctx_unknown')).toBeNull()
    })

    it('lists only open executors, oldest first, and every executor of a task', () => {
      const first = seedRoutedTask(harness)
      const second = seedRoutedTask(harness)
      const a = seedStartedAttempt(harness, first.taskId, first.routeId)
      const b = seedStartedAttempt(harness, second.taskId, second.routeId)
      expect(
        store()
          .listOpen(10)
          .map((record) => record.dispatchId)
      ).toEqual([a.dispatchId, b.dispatchId])
      harness.owner.db.exec('BEGIN IMMEDIATE')
      applyExecutorTransition(harness.owner.db, {
        dispatchId: a.dispatchId,
        from: 'starting',
        to: 'start_unknown',
        timestamp: fixtureTime(5),
        verdict: { reason: 'restart' }
      })
      harness.owner.db.exec('COMMIT')
      expect(
        store()
          .listOpen(10)
          .map((record) => record.dispatchId)
      ).toEqual([b.dispatchId])
      expect(store().listOpen(1)).toHaveLength(1)
      expect(
        store()
          .listForTask(first.taskId)
          .map((record) => record.dispatchId)
      ).toEqual([a.dispatchId])
      expect(errorCodeOf(() => store().listOpen(0))).toBe('autopilot_invalid_input')
    })

    it('reads an executor as orphaned, and still lists it as open, after an Orca reset', () => {
      const { taskId, routeId } = seedRoutedTask(harness)
      const { dispatchId } = seedStartedAttempt(harness, taskId, routeId)
      expect(store().get(dispatchId)?.orphaned).toBe(false)
      harness.owner.resetAll()
      expect(store().get(dispatchId)).toMatchObject({ state: 'starting', orphaned: true })
      expect(store().listOpen(10)).toMatchObject([{ dispatchId, orphaned: true }])
    })
  })

  describe('transitions', () => {
    let dispatchId: string
    beforeEach(() => {
      const { taskId, routeId } = seedRoutedTask(harness)
      dispatchId = seedStartedAttempt(harness, taskId, routeId).dispatchId
    })

    const apply = (
      input: Partial<ExecutorTransition> & Pick<ExecutorTransition, 'from' | 'to'>
    ) => {
      const db = harness.owner.db
      db.exec('BEGIN IMMEDIATE')
      try {
        applyExecutorTransition(db, { dispatchId, timestamp: fixtureTime(6), ...input })
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    const toRunning = () => apply({ from: 'starting', to: 'running', ...RUNNING })

    it('has a frozen edge list', () => {
      expect(EXECUTOR_PROCESS_TRANSITIONS).toEqual({
        starting: ['running', 'failed', 'start_unknown', 'stopped', 'stop_unknown'],
        running: ['completed', 'failed', 'blocked', 'stopped', 'stop_unknown'],
        completed: [],
        failed: [],
        blocked: [],
        stopped: [],
        stop_unknown: ['stopped'],
        start_unknown: []
      })
      expect(Object.isFrozen(EXECUTOR_PROCESS_TRANSITIONS)).toBe(true)
    })

    it('refuses every move that is not on the edge list', () => {
      for (const from of EXECUTOR_PROCESS_STATES) {
        for (const to of EXECUTOR_PROCESS_STATES) {
          if (!EXECUTOR_PROCESS_TRANSITIONS[from].includes(to)) {
            expect(
              errorCodeOf(() => apply({ from, to, ...COMPLETED, stopVerdict: 'exited' }))
            ).toBe('autopilot_invalid_transition')
          }
        }
      }
      expect(store().get(dispatchId)?.state).toBe('starting')
    })

    it('records the executable evidence when the process starts running', () => {
      toRunning()
      expect(store().get(dispatchId)).toMatchObject({
        state: 'running',
        executableEvidence: RUNNING.executableEvidence,
        settledAt: null
      })
      expect(errorCodeOf(() => apply({ from: 'starting', to: 'running', ...RUNNING }))).toBe(
        'autopilot_executor_conflict'
      )
    })

    it('records a completed claim with its exit code, tree proof and last message evidence', () => {
      toRunning()
      apply({ from: 'running', to: 'completed', threadId: 'thread_fixture01', ...COMPLETED })
      expect(store().get(dispatchId)).toMatchObject({
        state: 'completed',
        exitCode: 0,
        treeVerdict: 'exited',
        treeMethod: 'windows_descendant_snapshot',
        stopVerdict: null,
        threadId: 'thread_fixture01',
        verdict: { kind: 'finished' },
        lastMessage: { sha256: FIXTURE_HASH_B, bytes: 120, secretLike: false },
        usage: { input_tokens: 10, output_tokens: 20 },
        settledAt: fixtureTime(6)
      })
    })

    it('records a secret-shaped last message as a flag, never as text', () => {
      toRunning()
      apply({
        from: 'running',
        to: 'completed',
        ...COMPLETED,
        lastMessage: { sha256: FIXTURE_HASH_B, bytes: 9, secretLike: true }
      })
      expect(store().get(dispatchId)?.lastMessage?.secretLike).toBe(true)
    })

    it('records failed and blocked runs with their tree proof and optional exit code', () => {
      toRunning()
      apply({
        from: 'running',
        to: 'blocked',
        tree: EXITED_TREE,
        exitCode: 1,
        verdict: { reason: 'auth_failed' }
      })
      expect(store().get(dispatchId)).toMatchObject({ state: 'blocked', exitCode: 1 })
    })

    it('records a start that failed before any process existed', () => {
      apply({
        from: 'starting',
        to: 'failed',
        tree: { verdict: 'exited', method: 'not_started' },
        verdict: { reason: 'spawn_failed' }
      })
      expect(store().get(dispatchId)).toMatchObject({ state: 'failed', treeMethod: 'not_started' })
    })

    it('records a stop as stopped only with an exited verdict, and as unknown otherwise', () => {
      toRunning()
      expect(
        errorCodeOf(() => apply({ from: 'running', to: 'stopped', stopVerdict: 'live' }))
      ).toBe('autopilot_invalid_input')
      expect(errorCodeOf(() => apply({ from: 'running', to: 'stopped' }))).toBe(
        'autopilot_invalid_input'
      )
      expect(
        errorCodeOf(() => apply({ from: 'running', to: 'stop_unknown', stopVerdict: 'exited' }))
      ).toBe('autopilot_invalid_input')
      apply({
        from: 'running',
        to: 'stop_unknown',
        stopVerdict: 'unverifiable',
        verdict: { reason: 'restart' }
      })
      expect(store().get(dispatchId)).toMatchObject({
        state: 'stop_unknown',
        stopVerdict: 'unverifiable',
        settledAt: fixtureTime(6)
      })
      // A later check that proves the exit settles it and keeps the earlier evidence.
      apply({
        from: 'stop_unknown',
        to: 'stopped',
        stopVerdict: 'exited',
        timestamp: fixtureTime(7)
      })
      expect(store().get(dispatchId)).toMatchObject({
        state: 'stopped',
        stopVerdict: 'exited',
        verdict: { reason: 'restart' }
      })
    })

    it('records a start of unknown outcome with no process evidence', () => {
      apply({ from: 'starting', to: 'start_unknown', verdict: { reason: 'restart' } })
      expect(store().get(dispatchId)).toMatchObject({ state: 'start_unknown', treeVerdict: null })
      expect(
        errorCodeOf(() => apply({ from: 'starting', to: 'start_unknown', tree: EXITED_TREE }))
      ).toBe('autopilot_invalid_input')
    })

    it('requires the evidence each target state stands on', () => {
      toRunning()
      const refused = (input: Parameters<typeof apply>[0]) =>
        errorCodeOf(() => apply(input)) === 'autopilot_invalid_input'
      expect(refused({ from: 'running', to: 'completed', ...COMPLETED, exitCode: 1 })).toBe(true)
      expect(refused({ from: 'running', to: 'completed', ...COMPLETED, exitCode: null })).toBe(true)
      expect(refused({ from: 'running', to: 'completed', ...COMPLETED, tree: null })).toBe(true)
      expect(refused({ from: 'running', to: 'completed', ...COMPLETED, lastMessage: null })).toBe(
        true
      )
      expect(refused({ from: 'running', to: 'failed', ...COMPLETED, tree: null })).toBe(true)
      expect(refused({ from: 'running', to: 'blocked', verdict: { reason: 'x_y' } })).toBe(true)
      expect(
        refused({
          from: 'running',
          to: 'stopped',
          stopVerdict: 'exited',
          lastMessage: COMPLETED.lastMessage
        })
      ).toBe(true)
      expect(refused({ from: 'starting', to: 'running' })).toBe(true)
      expect(store().get(dispatchId)?.state).toBe('running')
    })

    it('refuses malformed evidence and a verdict that still holds a secret', () => {
      toRunning()
      const code = (input: Partial<ExecutorTransition>) =>
        errorCodeOf(() => apply({ from: 'running', to: 'completed', ...COMPLETED, ...input }))
      expect(code({ lastMessage: { sha256: 'abc', bytes: 1, secretLike: false } })).toBe(
        'autopilot_invalid_input'
      )
      expect(code({ lastMessage: { sha256: FIXTURE_HASH_B, bytes: -1, secretLike: false } })).toBe(
        'autopilot_invalid_input'
      )
      expect(code({ tree: { verdict: 'gone', method: 'root_exit_only' } as never })).toBe(
        'autopilot_invalid_input'
      )
      expect(code({ tree: { verdict: 'exited', method: 'guess' } as never })).toBe(
        'autopilot_invalid_input'
      )
      expect(code({ usage: { note: 'x'.repeat(2049) } })).toBe('autopilot_invalid_input')
      expect(code({ verdict: { note: 'x'.repeat(8193) } })).toBe('autopilot_invalid_input')
      expect(code({ verdict: { text: FAKE_SECRET } })).toBe('autopilot_unredacted_text')
      expect(code({ threadId: '' })).toBe('autopilot_invalid_input')
      expect(code({ timestamp: 'yesterday' })).toBe('autopilot_invalid_input')
      expect(store().get(dispatchId)?.state).toBe('running')
    })

    it('is a compare-and-set on the stated state and refuses an unknown Dispatch', () => {
      expect(errorCodeOf(() => apply({ from: 'running', to: 'completed', ...COMPLETED }))).toBe(
        'autopilot_executor_conflict'
      )
      const db = harness.owner.db
      db.exec('BEGIN IMMEDIATE')
      try {
        expect(
          errorCodeOf(() =>
            applyExecutorTransition(db, {
              dispatchId: 'ctx_unknown',
              from: 'starting',
              to: 'running',
              timestamp: fixtureTime(6),
              ...RUNNING
            })
          )
        ).toBe('autopilot_executor_not_found')
      } finally {
        db.exec('ROLLBACK')
      }
    })

    it('only runs inside a transaction the caller owns, so Orca state moves with it', () => {
      expect(
        errorCodeOf(() =>
          applyExecutorTransition(harness.owner.db, {
            dispatchId,
            from: 'starting',
            to: 'running',
            timestamp: fixtureTime(6),
            ...RUNNING
          })
        )
      ).toBe('autopilot_transaction_required')
      expect(store().get(dispatchId)?.state).toBe('starting')
    })

    it('is rolled back with the transaction that holds it', () => {
      const db = harness.owner.db
      db.exec('BEGIN IMMEDIATE')
      applyExecutorTransition(db, {
        dispatchId,
        from: 'starting',
        to: 'running',
        timestamp: fixtureTime(6),
        ...RUNNING
      })
      db.exec('ROLLBACK')
      expect(store().get(dispatchId)?.state).toBe('starting')
    })
  })
})
