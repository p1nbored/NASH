import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement, type AppAttemptStartInput } from './app-attempt-settlement'
import { getWorkflowRunStore } from './workflow-run-store'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

describe('app attempt start', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const settlement = () => getAppAttemptSettlement(harness.owner)
  const startInput = (
    seeded: { taskId: string; routeId: string },
    overrides: Partial<AppAttemptStartInput> = {}
  ): AppAttemptStartInput => ({
    taskId: seeded.taskId,
    routeId: seeded.routeId,
    executor: 'in_session',
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    timestamp: fixtureTime(5),
    ...overrides
  })
  const dispatchCount = () =>
    harness.owner.db.prepare('SELECT count(*) AS n FROM dispatch_contexts').get()?.n

  it('is one settlement service per database', () => {
    expect(getAppAttemptSettlement(harness.owner)).toBe(settlement())
  })

  it('opens an Orca Dispatch for an in-session attempt and records its route', () => {
    const seeded = seedRoutedTask(harness)
    const view = settlement().start(startInput(seeded))
    expect(view).toMatchObject({
      taskId: seeded.taskId,
      taskStatus: 'dispatched',
      dispatchStatus: 'pending',
      workerState: 'starting',
      workerStage: 'accepted',
      notice: null
    })
    expect(
      JSON.parse(harness.owner.getWorkerDispatch(view.dispatchId)?.start_options ?? '')
    ).toEqual({
      executor: 'in_session',
      route_id: seeded.routeId
    })
  })

  it('owns no pane, terminal handle or worktree on the Dispatch', () => {
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

  it('refuses a route that cannot be dispatched before Orca opens anything', () => {
    const unavailable = seedRoutedTask(harness, {
      route: { status: 'unavailable', reasons: ['auth_failed'] }
    })
    const unverified = seedRoutedTask(harness, {
      route: { status: 'unverified', reasons: ['auth_unobserved'] }
    })
    const nativeWorker = seedRoutedTask(harness, {
      route: { target: 'codex_cli', model: 'gpt-6.1-sol' }
    })
    for (const seeded of [unavailable, unverified, nativeWorker]) {
      expect(errorCodeOf(() => settlement().start(startInput(seeded)))).toBe(
        'autopilot_route_not_dispatchable'
      )
      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('ready')
    }
    expect(
      errorCodeOf(() =>
        settlement().start(startInput({ ...nativeWorker, routeId: 'route_unknown' }))
      )
    ).toBe('autopilot_route_not_found')
    expect(dispatchCount()).toBe(0)
  })

  it('refuses a task Orca will not start, and changes nothing', () => {
    const first = seedRoutedTask(harness)
    const dependent = seedRoutedTask(harness, { deps: [first.taskId] })
    expect(errorCodeOf(() => settlement().start(startInput(dependent)))).toBe('task_not_startable')
    expect(dispatchCount()).toBe(0)
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
    expect(errorCodeOf(() => settlement().start(startInput(seeded)))).toBe('autopilot_run_not_live')
    expect(dispatchCount()).toBe(0)
  })

  it('passes the mutation receipt through to Orca', () => {
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
    expect(dispatchCount()).toBe(1)
  })

  it('refuses malformed input and a connection that is already in a transaction', () => {
    const seeded = seedRoutedTask(harness)
    const bad = [
      { ...startInput(seeded), executor: 'codex_cli' },
      { ...startInput(seeded), executor: 'agy_cli' },
      startInput(seeded, { taskId: 'has space' }),
      startInput(seeded, { timestamp: 'yesterday' }),
      { ...startInput(seeded), extra: 1 }
    ]
    for (const input of bad) {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Exercise malformed runtime input.
      expect(errorCodeOf(() => settlement().start(input as AppAttemptStartInput))).toBe(
        'autopilot_invalid_input'
      )
    }
    harness.owner.db.exec('BEGIN IMMEDIATE')
    try {
      expect(errorCodeOf(() => settlement().start(startInput(seeded)))).toBe(
        'autopilot_transaction_unavailable'
      )
    } finally {
      harness.owner.db.exec('ROLLBACK')
    }
    expect(dispatchCount()).toBe(0)
  })
})
