import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchRequest } from '../../shared/workbench-request'
import { getWorkflowRunStore } from './orchestration/db/workflow-run-store'
import { settleWorkbenchLaunches, waitForWorkbenchLaunch } from './workbench-intake-launch'
import { reconcileWorkbenchLaunches } from './workbench-intake-reconcile'
import { submitWorkbenchRequest } from './workbench-intake-submit'
import {
  createFakePrimarySessionRuntime,
  manualGate,
  seedLaunchedRun
} from './workbench-intake.test-fixture'
import {
  FIXTURE_ONLY_PRINCIPAL,
  FIXTURE_ONLY_WORKSPACE,
  createRuntimeHarness,
  type RuntimeHarness
} from './workbench-routing/workbench-runtime.test-fixture'
import { moveWorkflowRun } from './workflow-run/primary-session-moves'
import { setPrimarySessionRuntime } from './workflow-run/primary-session-runtime'

let harness: RuntimeHarness | null = null
const TIME = '2026-10-05T00:00:05.000Z'

afterEach(async () => {
  await settleWorkbenchLaunches()
  setPrimarySessionRuntime(null)
  harness?.close()
  harness = null
  vi.restoreAllMocks()
})

function setup() {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  harness = createRuntimeHarness()
  return harness
}

/** A request recorded RECEIVED straight through the store, so no launch is scheduled for it. */
function received(h: RuntimeHarness): WorkbenchRequest {
  return h.requests.submit(
    FIXTURE_ONLY_PRINCIPAL,
    {
      workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
      objective: 'Inspect this change.',
      idempotencyKey: randomUUID()
    },
    FIXTURE_ONLY_WORKSPACE
  ).request
}

/** A request left LAUNCHING, as a crash during the launch leaves it. */
function launching(h: RuntimeHarness): WorkbenchRequest {
  const request = received(h)
  return h.requests.advance(
    FIXTURE_ONLY_PRINCIPAL,
    { workspaceId: request.workspaceId, requestId: request.requestId, expectedRevision: 1 },
    FIXTURE_ONLY_WORKSPACE,
    { to: 'LAUNCHING' }
  )
}

function runFor(h: RuntimeHarness, request: WorkbenchRequest, status: 'active' | 'unverifiable') {
  return seedLaunchedRun(
    h.owner,
    {
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      workspaceBinding: 'a'.repeat(64),
      objective: request.objective,
      requestedAccess: 'read_only'
    },
    status
  )
}

function stored(h: RuntimeHarness, requestId: string) {
  return h.owner.db
    .prepare(
      'SELECT status, revision, blocker_reason, blocker_detail, workflow_run_id FROM workbench_requests WHERE request_id = ?'
    )
    .get(requestId)
}

describe('reconcileWorkbenchLaunches (startup, before any submit is accepted)', () => {
  it('links a run that was launched before the crash', () => {
    const h = setup()
    const request = launching(h)
    const run = runFor(h, request, 'active')
    expect(reconcileWorkbenchLaunches(h.owner)).toMatchObject({ launched: 1, blocked: 0 })
    expect(stored(h, request.requestId)).toEqual({
      status: 'LAUNCHED',
      revision: 3,
      blocker_reason: null,
      blocker_detail: null,
      workflow_run_id: run.runId
    })
    expect(h.events(request.requestId)).toEqual(['accepted', 'launch_started', 'launched'])
  })

  it('blocks a launch that left no run as refused', () => {
    const h = setup()
    const request = launching(h)
    expect(reconcileWorkbenchLaunches(h.owner)).toMatchObject({ launched: 0, blocked: 1 })
    expect(stored(h, request.requestId)).toMatchObject({
      status: 'LAUNCH_BLOCKED',
      blocker_reason: 'launch_blocked',
      blocker_detail: 'launch_refused',
      workflow_run_id: null
    })
  })

  it('blocks a launch whose run outcome is unknown as unverifiable, linking the run', () => {
    const h = setup()
    const request = launching(h)
    const run = runFor(h, request, 'unverifiable')
    reconcileWorkbenchLaunches(h.owner)
    expect(stored(h, request.requestId)).toMatchObject({
      status: 'LAUNCH_BLOCKED',
      blocker_detail: 'launch_unverifiable',
      workflow_run_id: run.runId
    })
  })

  it('blocks a launch whose run failed as refused, and records a canceled run as canceled', () => {
    const h = setup()
    const failed = launching(h)
    const failedRun = runFor(h, failed, 'active')
    moveWorkflowRun(h.owner, failedRun.runId, 'failed', 'primary_exited', TIME)
    const canceled = launching(h)
    const canceledRun = runFor(h, canceled, 'active')
    moveWorkflowRun(h.owner, canceledRun.runId, 'canceled', 'user_canceled', TIME)
    expect(reconcileWorkbenchLaunches(h.owner)).toMatchObject({ blocked: 1, canceled: 1 })
    expect(stored(h, failed.requestId)).toMatchObject({
      status: 'LAUNCH_BLOCKED',
      blocker_detail: 'launch_refused',
      workflow_run_id: failedRun.runId
    })
    expect(stored(h, canceled.requestId)).toMatchObject({ status: 'CANCELED' })
  })

  it('blocks a request still RECEIVED, because nothing will ever launch it after a restart', () => {
    const h = setup()
    const request = received(h)
    expect(reconcileWorkbenchLaunches(h.owner)).toMatchObject({ blocked: 1 })
    expect(stored(h, request.requestId)).toMatchObject({
      status: 'LAUNCH_BLOCKED',
      revision: 2,
      blocker_detail: 'launch_refused'
    })
    expect(h.events(request.requestId)).toEqual(['accepted', 'launch_blocked'])
  })

  it('leaves settled requests alone and is a no-op the second time', () => {
    const h = setup()
    const request = launching(h)
    runFor(h, request, 'active')
    reconcileWorkbenchLaunches(h.owner)
    const before = stored(h, request.requestId)
    expect(reconcileWorkbenchLaunches(h.owner)).toEqual({
      launched: 0,
      blocked: 0,
      canceled: 0,
      skipped: 0
    })
    expect(stored(h, request.requestId)).toEqual(before)
  })

  it('skips a request whose launch is in flight in this process', async () => {
    const h = setup()
    const gate = manualGate()
    setPrimarySessionRuntime(createFakePrimarySessionRuntime(h.owner, { gate: gate.gate }).runtime)
    const { request } = submitWorkbenchRequest(
      {
        owner: h.owner,
        store: h.requests,
        principalId: FIXTURE_ONLY_PRINCIPAL,
        workspace: FIXTURE_ONLY_WORKSPACE
      },
      {
        workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
        objective: 'Inspect this change.',
        idempotencyKey: randomUUID()
      }
    )
    await vi.waitFor(() =>
      expect(stored(h, request.requestId)).toMatchObject({ status: 'LAUNCHING' })
    )
    expect(reconcileWorkbenchLaunches(h.owner)).toMatchObject({ skipped: 1, blocked: 0 })
    gate.open()
    await waitForWorkbenchLaunch(request.requestId)
    expect(stored(h, request.requestId)).toMatchObject({ status: 'LAUNCHED' })
    expect(getWorkflowRunStore(h.owner).getByRequestId(request.requestId)).not.toBeNull()
  })
})
