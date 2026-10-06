import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOT_INGRESS_PRINCIPAL_ID } from '../../shared/dot-ingress/dot-ingress-limits'
import { getWorkflowRunStore } from './orchestration/db/workflow-run-store'
import { OrchestrationError } from './orchestration/orchestration-error'
import * as intakeModule from './workbench-intake-submit'
import {
  cancelWorkbenchRequest,
  listWorkbenchRequests,
  submitWorkbenchRequest,
  type WorkbenchIntakeTarget
} from './workbench-intake-submit'
import { settleWorkbenchLaunches, waitForWorkbenchLaunch } from './workbench-intake-launch'
import {
  createFakePrimarySessionRuntime,
  manualGate,
  type FakeRunsOptions
} from './workbench-intake.test-fixture'
import {
  createWorkbenchRoutingRuntime,
  setWorkbenchRoutingRuntime
} from './workbench-routing/workbench-routing-runtime'
import {
  FIXTURE_ONLY_PRINCIPAL,
  FIXTURE_ONLY_WORKSPACE,
  createRuntimeHarness,
  type RuntimeHarness
} from './workbench-routing/workbench-runtime.test-fixture'
import { setPrimarySessionRuntime } from './workflow-run/primary-session-runtime'

let harness: RuntimeHarness | null = null

function setup(options: { principalId?: string; runs?: FakeRunsOptions | 'none' } = {}) {
  harness = createRuntimeHarness()
  const target: WorkbenchIntakeTarget = {
    owner: harness.owner,
    store: harness.requests,
    principalId: options.principalId ?? FIXTURE_ONLY_PRINCIPAL,
    workspace: FIXTURE_ONLY_WORKSPACE
  }
  const fake = createFakePrimarySessionRuntime(
    harness.owner,
    options.runs === 'none' ? {} : options.runs
  )
  setPrimarySessionRuntime(options.runs === 'none' ? null : fake.runtime)
  return { h: harness, target, ...fake }
}

afterEach(async () => {
  await settleWorkbenchLaunches()
  setPrimarySessionRuntime(null)
  setWorkbenchRoutingRuntime(null)
  harness?.close()
  harness = null
  vi.restoreAllMocks()
})

const params = (objective = 'Inspect this change.') => ({
  workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
  objective,
  idempotencyKey: randomUUID()
})

function cancelParams(request: { requestId: string; revision: number }) {
  return {
    workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
    requestId: request.requestId,
    expectedRevision: request.revision
  }
}

/** The stored v3 row; the view shows RECEIVED and LAUNCHING both as ROUTING. */
function stored(h: RuntimeHarness, requestId: string) {
  return h.owner.db
    .prepare(
      'SELECT status, revision, blocker_reason, blocker_detail, workflow_run_id FROM workbench_requests WHERE request_id = ?'
    )
    .get(requestId)
}

function view(target: WorkbenchIntakeTarget, requestId: string) {
  return target.store.get(
    target.principalId,
    { workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId, requestId },
    target.workspace
  )
}

async function submitAndSettle(target: WorkbenchIntakeTarget, objective?: string) {
  const { request } = submitWorkbenchRequest(target, params(objective))
  await waitForWorkbenchLaunch(request.requestId)
  return view(target, request.requestId)
}

describe('the intake door under D-016', () => {
  it('exports only submit, list and cancel', () => {
    expect(Object.keys(intakeModule).sort()).toEqual([
      'cancelWorkbenchRequest',
      'listWorkbenchRequests',
      'submitWorkbenchRequest'
    ])
  })

  it('imports nothing from the routing runtime, the router or the route store', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/main/runtime/workbench-intake-submit.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/workbench-routing/)
    expect(source).not.toMatch(/workbench-route-store/)
    expect(source).not.toMatch(/clef-route-contract/)
  })
})

describe('submit: RECEIVED, then the workflow run is started (D-018: no confirmation step)', () => {
  it('returns the receipt as recorded and starts the run only after the door returned', async () => {
    const { h, target, startWorkflowRun } = setup()
    const submit = vi.spyOn(h.requests, 'submit')
    const input = params()
    const result = submitWorkbenchRequest(target, input)
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      FIXTURE_ONLY_PRINCIPAL,
      input,
      FIXTURE_ONLY_WORKSPACE
    )
    expect(result).toMatchObject({
      duplicate: false,
      request: { status: 'ROUTING', revision: 1, routingBlocker: null, workflowRunId: null }
    })
    expect(startWorkflowRun).not.toHaveBeenCalled()
    await waitForWorkbenchLaunch(result.request.requestId)
    expect(startWorkflowRun).toHaveBeenCalledOnce()
  })

  it('moves RECEIVED to LAUNCHING to LAUNCHED and links the run', async () => {
    const { h, target, startWorkflowRun } = setup()
    const launched = await submitAndSettle(target)
    const run = getWorkflowRunStore(h.owner).getByRequestId(launched.requestId)
    expect(run).not.toBeNull()
    expect(launched).toMatchObject({ status: 'ROUTED', revision: 3, workflowRunId: run?.runId })
    expect(stored(h, launched.requestId)).toMatchObject({
      status: 'LAUNCHED',
      blocker_reason: null
    })
    expect(h.events(launched.requestId)).toEqual(['accepted', 'launch_started', 'launched'])
    expect(startWorkflowRun).toHaveBeenCalledExactlyOnceWith({
      requestId: launched.requestId,
      workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
      workspaceBinding: expect.stringMatching(/^[0-9a-f]{64}$/),
      objective: 'Inspect this change.',
      requestedAccess: 'read_only',
      deliverableLanguage: null
    })
  })

  it('starts the run with the stored access and canonical deliverable language', async () => {
    const { target, startWorkflowRun } = setup()
    const { request } = submitWorkbenchRequest(target, {
      ...params(),
      requestedAccess: 'workspace_write',
      deliverableLanguage: 'zh-hant-tw'
    })
    await waitForWorkbenchLaunch(request.requestId)
    expect(startWorkflowRun.mock.calls[0]?.[0]).toMatchObject({
      requestedAccess: 'workspace_write',
      deliverableLanguage: 'zh-Hant-TW'
    })
  })

  it('launches a dot submission through the same door with the dot principal', async () => {
    const { h, target } = setup({ principalId: DOT_INGRESS_PRINCIPAL_ID })
    const launched = await submitAndSettle(target)
    expect(launched.status).toBe('ROUTED')
    expect(h.owner.db.prepare('SELECT principal_id FROM workbench_requests').get()).toEqual({
      principal_id: DOT_INGRESS_PRINCIPAL_ID
    })
  })

  it('starts nothing for a duplicate submit, before or after the launch', async () => {
    const { target, startWorkflowRun } = setup()
    const input = params()
    const first = submitWorkbenchRequest(target, input)
    const early = submitWorkbenchRequest(target, input)
    await waitForWorkbenchLaunch(first.request.requestId)
    const late = submitWorkbenchRequest(target, input)
    await settleWorkbenchLaunches()
    expect(early).toMatchObject({
      duplicate: true,
      request: { requestId: first.request.requestId }
    })
    expect(late).toMatchObject({ duplicate: true, request: { status: 'ROUTED' } })
    expect(startWorkflowRun).toHaveBeenCalledOnce()
  })

  it('starts nothing when a replayed key finds a RECEIVED request no launch is working on', async () => {
    const { h, target, startWorkflowRun } = setup()
    const input = params()
    // Why the store directly: a migrated or restart-stranded request is RECEIVED with no launch.
    const recorded = h.requests.submit(FIXTURE_ONLY_PRINCIPAL, input, FIXTURE_ONLY_WORKSPACE)
    const replay = submitWorkbenchRequest(target, input)
    await settleWorkbenchLaunches()
    expect(replay).toMatchObject({
      duplicate: true,
      request: { requestId: recorded.request.requestId }
    })
    expect(startWorkflowRun).not.toHaveBeenCalled()
    expect(stored(h, recorded.request.requestId)).toMatchObject({ status: 'RECEIVED', revision: 1 })
  })

  it('refuses a replayed key with different bytes and starts nothing more', async () => {
    const { target, startWorkflowRun } = setup()
    const input = params()
    submitWorkbenchRequest(target, input)
    expect(() =>
      submitWorkbenchRequest(target, { ...input, objective: 'Something else.' })
    ).toThrow(OrchestrationError)
    await settleWorkbenchLaunches()
    expect(startWorkflowRun).toHaveBeenCalledOnce()
  })
})

describe('a launch failure blocks the request with exactly one blocker', () => {
  it('records an unavailable coordinator route and creates no run', async () => {
    const { h, target } = setup({ runs: { mode: 'route_unavailable' } })
    const blocked = await submitAndSettle(target)
    expect(blocked).toMatchObject({
      status: 'ROUTING_BLOCKED',
      routingBlocker: { reason: 'launch_blocked', detail: 'coordinator_route_unavailable' },
      workflowRunId: null
    })
    expect(h.events(blocked.requestId)).toEqual(['accepted', 'launch_started', 'launch_blocked'])
    expect(getWorkflowRunStore(h.owner).getByRequestId(blocked.requestId)).toBeNull()
  })

  it('links a run the launch created before its outcome became unknown', async () => {
    const { h, target } = setup({ runs: { mode: 'unverifiable_after_spawn' } })
    const blocked = await submitAndSettle(target)
    const run = getWorkflowRunStore(h.owner).getByRequestId(blocked.requestId)
    expect(blocked).toMatchObject({
      status: 'ROUTING_BLOCKED',
      routingBlocker: { reason: 'launch_blocked', detail: 'launch_unverifiable' },
      workflowRunId: run?.runId
    })
  })

  it.each([
    ['before', 'throws_before_run', 'launch_refused', false],
    ['after', 'throws_after_run', 'launch_unverifiable', true]
  ] as const)(
    'blocks once when the start throws %s creating a run',
    async (_when, mode, detail, linked) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { h, target } = setup({ runs: { mode } })
      const blocked = await submitAndSettle(target)
      expect(blocked.routingBlocker).toEqual({ reason: 'launch_blocked', detail })
      expect(blocked.workflowRunId !== null).toBe(linked)
      expect(h.events(blocked.requestId).filter((kind) => kind === 'launch_blocked')).toHaveLength(
        1
      )
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/fixture launcher failure/)
    }
  )

  it('blocks without starting anything when no workflow runtime is installed', async () => {
    const { h, target } = setup({ runs: 'none' })
    const blocked = await submitAndSettle(target)
    expect(blocked).toMatchObject({
      status: 'ROUTING_BLOCKED',
      routingBlocker: { reason: 'launch_blocked', detail: 'launch_refused' },
      workflowRunId: null
    })
    expect(h.events(blocked.requestId)).toEqual(['accepted', 'launch_blocked'])
  })

  it('starts nothing for a request canceled before its launch began', async () => {
    const { h, target, startWorkflowRun } = setup()
    const { request } = submitWorkbenchRequest(target, params())
    const canceled = await cancelWorkbenchRequest(target, cancelParams(request))
    await waitForWorkbenchLaunch(request.requestId)
    expect(canceled).toMatchObject({ changed: true, request: { status: 'CANCELED' } })
    expect(startWorkflowRun).not.toHaveBeenCalled()
    expect(stored(h, request.requestId)).toMatchObject({ status: 'CANCELED', revision: 2 })
  })
})

describe('intake stays decoupled from Clef while it launches runs', () => {
  it('makes no Clef call, no spend reservation and no raw response record', async () => {
    const { h, target } = setup()
    setWorkbenchRoutingRuntime(createWorkbenchRoutingRuntime({ ...h.deps, admin: h.admin }))
    for (let count = 0; count < 3; count += 1) {
      expect((await submitAndSettle(target, `Plan item ${count}.`)).status).toBe('ROUTED')
    }
    expect(h.transport).not.toHaveBeenCalled()
    expect(h.spendRows()).toEqual([])
    expect(h.rawRows()).toEqual([])
  })
})

describe('cancel', () => {
  it('cancels a received request through the original store call', async () => {
    const { h, target } = setup()
    const { request } = submitWorkbenchRequest(target, params())
    const cancel = vi.spyOn(h.requests, 'cancel')
    const input = cancelParams(request)
    await expect(cancelWorkbenchRequest(target, input)).resolves.toMatchObject({
      changed: true,
      request: { status: 'CANCELED' }
    })
    expect(cancel).toHaveBeenCalledExactlyOnceWith(
      FIXTURE_ONLY_PRINCIPAL,
      input,
      FIXTURE_ONLY_WORKSPACE
    )
  })

  it('stops the primary of a launched request, ends the run and records the cancel', async () => {
    const { h, target, stopPrimarySession } = setup()
    const launched = await submitAndSettle(target)
    const result = await cancelWorkbenchRequest(target, cancelParams(launched))
    expect(stopPrimarySession).toHaveBeenCalledExactlyOnceWith(
      launched.workflowRunId,
      'user_canceled'
    )
    expect(result).toMatchObject({ changed: true, request: { status: 'CANCELED' } })
    expect(getWorkflowRunStore(h.owner).getByRequestId(launched.requestId)).toMatchObject({
      status: 'canceled',
      endReason: 'user_canceled'
    })
    expect(h.events(launched.requestId).at(-1)).toBe('canceled')
  })

  it('records a dot cancel with its own end reason', async () => {
    const { h, target, stopPrimarySession } = setup({ principalId: DOT_INGRESS_PRINCIPAL_ID })
    const launched = await submitAndSettle(target)
    await cancelWorkbenchRequest(target, cancelParams(launched))
    expect(stopPrimarySession).toHaveBeenCalledWith(launched.workflowRunId, 'dot_canceled')
    expect(getWorkflowRunStore(h.owner).getByRequestId(launched.requestId)?.endReason).toBe(
      'dot_canceled'
    )
  })

  it('waits for a launch in flight, then stops the run it started', async () => {
    const gate = manualGate()
    const { h, target, stopPrimarySession } = setup({ runs: { gate: gate.gate } })
    const { request } = submitWorkbenchRequest(target, params())
    await vi.waitFor(() =>
      expect(stored(h, request.requestId)).toMatchObject({ status: 'LAUNCHING' })
    )
    const canceling = cancelWorkbenchRequest(target, {
      ...cancelParams(request),
      expectedRevision: 2
    })
    gate.open()
    await expect(canceling).resolves.toMatchObject({
      changed: true,
      request: { status: 'CANCELED' }
    })
    expect(stopPrimarySession).toHaveBeenCalledOnce()
    expect(getWorkflowRunStore(h.owner).getByRequestId(request.requestId)?.status).toBe('canceled')
  })

  it('joins a second cancel of the same request instead of stopping twice', async () => {
    const { target, stopPrimarySession } = setup()
    const launched = await submitAndSettle(target)
    const [first, second] = await Promise.all([
      cancelWorkbenchRequest(target, cancelParams(launched)),
      cancelWorkbenchRequest(target, cancelParams(launched))
    ])
    expect(first).toEqual(second)
    expect(stopPrimarySession).toHaveBeenCalledOnce()
  })

  it('refuses the cancel and keeps the request launched when the stop is not confirmed', async () => {
    const { h, target } = setup({ runs: { stop: 'stop_unconfirmed' } })
    const launched = await submitAndSettle(target)
    await expect(cancelWorkbenchRequest(target, cancelParams(launched))).rejects.toMatchObject({
      code: 'workbench_run_stop_unconfirmed'
    })
    expect(stored(h, launched.requestId)).toMatchObject({ status: 'LAUNCHED', revision: 3 })
    expect(getWorkflowRunStore(h.owner).getByRequestId(launched.requestId)?.status).toBe('active')
  })

  it('refuses the cancel while the primary is still starting', async () => {
    const { target } = setup({ runs: { stop: 'refused_starting' } })
    const launched = await submitAndSettle(target)
    await expect(cancelWorkbenchRequest(target, cancelParams(launched))).rejects.toMatchObject({
      code: 'workbench_run_stop_refused',
      data: { stopCode: 'autopilot_owner_starting' }
    })
  })

  it('never records a completed run as canceled', async () => {
    const { h, target, stopPrimarySession } = setup()
    const launched = await submitAndSettle(target)
    const runs = getWorkflowRunStore(h.owner)
    const run = runs.getByRequestId(launched.requestId)
    const timestamp = '2026-10-05T00:00:02.000Z'
    if (!run) {
      throw new Error('run')
    }
    const completing = runs.transition({
      runId: run.runId,
      from: 'active',
      to: 'completing',
      expectedRevision: run.revision,
      reason: null,
      timestamp
    })
    runs.transition({
      runId: run.runId,
      from: 'completing',
      to: 'completed',
      expectedRevision: completing.revision,
      reason: null,
      timestamp
    })
    await expect(cancelWorkbenchRequest(target, cancelParams(launched))).rejects.toMatchObject({
      code: 'workbench_run_completed'
    })
    expect(stopPrimarySession).not.toHaveBeenCalled()
    expect(stored(h, launched.requestId)).toMatchObject({ status: 'LAUNCHED' })
  })

  it('cancels a launch-blocked request as a receipt only', async () => {
    const { target, stopPrimarySession } = setup({ runs: { mode: 'route_unavailable' } })
    const blocked = await submitAndSettle(target)
    await expect(cancelWorkbenchRequest(target, cancelParams(blocked))).resolves.toMatchObject({
      changed: true,
      request: { status: 'CANCELED' }
    })
    expect(stopPrimarySession).not.toHaveBeenCalled()
  })

  it('refuses a stale revision and changes nothing', async () => {
    const { h, target } = setup()
    const launched = await submitAndSettle(target)
    await expect(
      cancelWorkbenchRequest(target, { ...cancelParams(launched), expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'workbench_revision_conflict' })
    expect(stored(h, launched.requestId)).toMatchObject({ status: 'LAUNCHED' })
  })

  it('is idempotent: canceling again reports no change', async () => {
    const { target } = setup()
    const launched = await submitAndSettle(target)
    const input = cancelParams(launched)
    expect((await cancelWorkbenchRequest(target, input)).changed).toBe(true)
    expect((await cancelWorkbenchRequest(target, input)).changed).toBe(false)
  })
})

describe('listWorkbenchRequests', () => {
  const listParams = { workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId, limit: 10 }

  it('keeps the original store call and lists launched requests from local state', async () => {
    const { h, target } = setup()
    const launched = await submitAndSettle(target)
    const list = vi.spyOn(h.requests, 'list')
    const result = listWorkbenchRequests(target, listParams)
    expect(list).toHaveBeenCalledExactlyOnceWith(
      FIXTURE_ONLY_PRINCIPAL,
      listParams,
      FIXTURE_ONLY_WORKSPACE
    )
    expect(result.requests.map((item) => item.requestId)).toEqual([launched.requestId])
    expect(h.transport).not.toHaveBeenCalled()
  })
})
