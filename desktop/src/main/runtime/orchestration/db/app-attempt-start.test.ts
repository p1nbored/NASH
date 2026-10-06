import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppAttemptSettlement, type AppAttemptStartInput } from './app-attempt-settlement'
import { getExecutorProcessStore } from './executor-process-store'
import { getWorkflowRunStore } from './workflow-run-store'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

const SUBAGENT_ROUTE = {
  target: 'claude_subagent',
  model: 'claude-sonnet-5-5',
  policyLevel: 'max',
  cliSetting: null
} as const

describe('app attempt start', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    harness.owner.close()
  })

  const settlement = () => getAppAttemptSettlement(harness.owner)
  const startInput = (
    seeded: { taskId: string; routeId: string },
    overrides: Partial<AppAttemptStartInput> = {}
  ): AppAttemptStartInput => ({
    taskId: seeded.taskId,
    routeId: seeded.routeId,
    executor: 'codex_cli',
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    timestamp: fixtureTime(5),
    ...overrides
  })
  const count = (table: string) =>
    harness.owner.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n

  it('is one settlement service per database', () => {
    expect(getAppAttemptSettlement(harness.owner)).toBe(settlement())
  })

  describe('start', () => {
    it('opens an Orca Dispatch for a Codex attempt and records its executor beside it', () => {
      const seeded = seedRoutedTask(harness)
      const view = settlement().start(startInput(seeded))
      expect(view).toMatchObject({
        taskId: seeded.taskId,
        taskStatus: 'dispatched',
        dispatchStatus: 'pending',
        workerState: 'starting',
        workerStage: 'accepted',
        notice: null,
        executor: {
          dispatchId: view.dispatchId,
          state: 'starting',
          executorKind: 'codex_cli',
          routeId: seeded.routeId,
          runDirectory: `autopilot-runs/${harness.runId}/${view.dispatchId}`
        }
      })
      const worker = harness.owner.getWorkerDispatch(view.dispatchId)
      expect(JSON.parse(worker?.start_options ?? '')).toEqual({
        executor: 'codex_cli',
        route_id: seeded.routeId
      })
    })

    it('has no pane, terminal handle or worktree on the Dispatch, because an app attempt owns none', () => {
      const seeded = seedRoutedTask(harness)
      const { dispatchId } = settlement().start(startInput(seeded))
      expect(harness.owner.getDispatchContextById(dispatchId)).toMatchObject({
        assignee_handle: null,
        assignee_pane_key: null,
        process_incarnation: null
      })
      expect(harness.owner.getWorkerDispatch(dispatchId)).toMatchObject({
        agent_terminal_handle: null,
        worktree_id: null
      })
    })

    it('starts an in-session attempt with no executor row', () => {
      const seeded = seedRoutedTask(harness, { route: SUBAGENT_ROUTE })
      const view = settlement().start(startInput(seeded, { executor: 'in_session' }))
      expect(view).toMatchObject({ workerState: 'starting', executor: null })
      expect(count('executor_processes')).toBe(0)
      expect(
        JSON.parse(harness.owner.getWorkerDispatch(view.dispatchId)?.start_options ?? '')
      ).toEqual({
        executor: 'in_session',
        route_id: seeded.routeId
      })
    })

    it('refuses a route that cannot be dispatched before Orca opens anything', () => {
      const unavailable = seedRoutedTask(harness, {
        route: { status: 'unavailable', reasons: ['auth_failed'] }
      })
      const unverified = seedRoutedTask(harness, {
        route: { status: 'unverified', reasons: ['auth_unobserved'] }
      })
      const claude = seedRoutedTask(harness, { route: SUBAGENT_ROUTE })
      const codex = seedRoutedTask(harness)
      const refused = (
        seeded: { taskId: string; routeId: string },
        executor: AppAttemptStartInput['executor']
      ) => errorCodeOf(() => settlement().start(startInput(seeded, { executor })))
      expect(refused(unavailable, 'codex_cli')).toBe('autopilot_route_not_dispatchable')
      expect(refused(unverified, 'codex_cli')).toBe('autopilot_route_not_dispatchable')
      expect(refused(claude, 'codex_cli')).toBe('autopilot_route_not_dispatchable')
      expect(refused(codex, 'in_session')).toBe('autopilot_route_not_dispatchable')
      expect(refused(codex, 'agy_cli')).toBe('autopilot_route_not_dispatchable')
      expect(
        errorCodeOf(() => settlement().start(startInput({ ...codex, routeId: 'route_unknown' })))
      ).toBe('autopilot_route_not_found')
      expect(count('dispatch_contexts')).toBe(0)
      expect(harness.owner.getTask(codex.taskId)?.status).toBe('ready')
    })

    it('refuses a task Orca will not start, and changes nothing', () => {
      const first = seedRoutedTask(harness)
      const dependent = seedRoutedTask(harness, { deps: [first.taskId] })
      expect(errorCodeOf(() => settlement().start(startInput(dependent)))).toBe(
        'task_not_startable'
      )
      expect(count('dispatch_contexts')).toBe(0)
      expect(count('executor_processes')).toBe(0)
      expect(harness.owner.getTask(dependent.taskId)?.status).toBe('pending')
    })

    it('refuses a task that has no TaskSpec, or whose run is no longer active', () => {
      const seeded = seedRoutedTask(harness)
      expect(
        errorCodeOf(() => settlement().start(startInput({ ...seeded, taskId: 'task_unknown' })))
      ).toBe('autopilot_task_spec_not_found')
      getWorkflowRunStore(harness.owner).transition({
        runId: harness.runId,
        from: 'active',
        to: 'canceled',
        expectedRevision: 2,
        reason: 'user_canceled',
        timestamp: fixtureTime(6)
      })
      expect(errorCodeOf(() => settlement().start(startInput(seeded)))).toBe(
        'autopilot_run_not_live'
      )
      expect(count('dispatch_contexts')).toBe(0)
    })

    it('leaves a retryable failed attempt when the executor row cannot be written', () => {
      const seeded = seedRoutedTask(harness)
      vi.spyOn(getExecutorProcessStore(harness.owner), 'insertStarting').mockImplementation(() => {
        throw new Error('disk full')
      })
      expect(() => settlement().start(startInput(seeded))).toThrow('disk full')
      const dispatch = harness.owner.getDispatchContext(seeded.taskId)
      expect(dispatch).toMatchObject({ status: 'failed', last_failure: 'executor_record_failed' })
      expect(harness.owner.getWorkerDispatch(dispatch?.id ?? '')).toMatchObject({
        state: 'failed',
        stage: 'start_failed'
      })
      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('failed')
      expect(count('executor_processes')).toBe(0)
      vi.restoreAllMocks()
      expect(settlement().start(startInput(seeded, { retryOf: dispatch?.id })).taskStatus).toBe(
        'dispatched'
      )
    })

    it('passes the receipt through so a repeated request is not a second start', () => {
      const seeded = seedRoutedTask(harness)
      const mutationReceipt = {
        callerFingerprint: 'fixture_caller',
        requestId: 'fixture_request',
        method: 'orchestration.autopilotTaskStart',
        payloadHash: 'fixture_hash'
      }
      settlement().start(startInput(seeded, { mutationReceipt }))
      expect(harness.owner.getMutationReceipt('fixture_caller', 'fixture_request')).toMatchObject({
        method: 'orchestration.autopilotTaskStart'
      })
      expect(count('dispatch_contexts')).toBe(1)
    })

    it('refuses malformed input, unknown keys and a connection that is already in a transaction', () => {
      const seeded = seedRoutedTask(harness)
      const bad = [
        startInput(seeded, { executor: 'gemini_cli' as never }),
        startInput(seeded, { taskId: 'has space' }),
        startInput(seeded, { timestamp: 'yesterday' }),
        { ...startInput(seeded), extra: 1 } as never
      ]
      for (const input of bad) {
        expect(errorCodeOf(() => settlement().start(input))).toBe('autopilot_invalid_input')
      }
      harness.owner.db.exec('BEGIN IMMEDIATE')
      try {
        expect(errorCodeOf(() => settlement().start(startInput(seeded)))).toBe(
          'autopilot_transaction_unavailable'
        )
      } finally {
        harness.owner.db.exec('ROLLBACK')
      }
      expect(count('dispatch_contexts')).toBe(0)
    })
  })
})
