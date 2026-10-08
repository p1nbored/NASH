import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WORKFLOW_RUN_STATUSES } from '../orchestration/db/autopilot-run-schema-definition'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { submitDotRequest } from './dot-ingress-intake'
import { findDotRequestOfRun, findDotRequestRun } from './dot-ingress-run-link'
import { projectDotRun } from './dot-ingress-run-projection'
import { createDotHarness, fixtureUuid, type DotHarness } from './dot-ingress-service.test-fixture'

function codeOf(operation: () => unknown): string | null {
  try {
    operation()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

// FIXTURE_ONLY: raw edits stand in for states the stores reach only through other packages.
function setWorkbenchStatus(
  harness: DotHarness,
  requestId: string,
  status: string,
  detail?: string
) {
  harness.owner.db
    .prepare(
      `UPDATE workbench_requests SET status = ?, blocker_reason = ?, blocker_detail = ?,
        workflow_run_id = CASE WHEN ? = 'LAUNCHED' THEN workflow_run_id ELSE NULL END WHERE request_id = ?`
    )
    .run(status, detail ? 'launch_blocked' : null, detail ?? null, status, requestId)
}

describe('dot run link: a run is addressed only through the dot request that started it', () => {
  let harness: DotHarness
  beforeEach(() => {
    harness = createDotHarness()
  })
  afterEach(() => harness.close())

  it('finds the run of a submitted request and proves its dot origin', async () => {
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    const run = findDotRequestRun(harness.owner, record)
    expect(run).toMatchObject({ requestId: record.workbenchRequestId, status: 'active' })
    expect(findDotRequestOfRun(harness.owner, run?.runId ?? '')?.dotRequestId).toBe(
      record.dotRequestId
    )
  })

  it('has no run before the door launched one, or for a request that never reached it', async () => {
    harness.door.launch = 'received'
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    expect(findDotRequestRun(harness.owner, record)).toBeNull()
    harness.door.failNextSubmit = new OrchestrationError('workbench_capacity_exceeded', 'fixture')
    const failed = await submitDotRequest(
      harness.deps,
      harness.submitRequest({ idempotencyKey: fixtureUuid(2) })
    )
    expect(findDotRequestRun(harness.owner, failed.record)).toBeNull()
  })

  it('refuses a run whose origin evidence no longer says dot', async () => {
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    harness.owner.db
      .prepare(
        "UPDATE workbench_requests SET principal_id = 'local-desktop-ui' WHERE request_id = ?"
      )
      .run(record.workbenchRequestId)
    expect(codeOf(() => findDotRequestRun(harness.owner, record))).toBe('dot_recovery_required')
  })

  it('does not attribute a run of another origin to any dot request', () => {
    getWorkflowRunStore(harness.owner).create({
      runId: 'run-desktop-1',
      requestId: 'request-desktop-1',
      workspaceId: 'fixture-repo::/fixture/repo',
      workspaceBinding: 'c'.repeat(64),
      requestedAccess: 'read_only',
      routingTableVersion: 1,
      routingTableSha256: 'b'.repeat(64),
      coordinatorAgent: 'claude',
      coordinatorModel: 'claude-opus-5-5',
      coordinatorEffort: 'max',
      timestamp: '2026-10-05T00:00:10.000Z'
    })
    expect(findDotRequestOfRun(harness.owner, 'run-desktop-1')).toBeNull()
    expect(findDotRequestOfRun(harness.owner, 'run-missing')).toBeNull()
  })

  it('never creates the app run tables on a database that has none', () => {
    const bare = new OrchestrationDb(':memory:')
    try {
      expect(findDotRequestOfRun(bare, 'run-1')).toBeNull()
      const tables = bare.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('workflow_runs', 'workbench_requests')"
        )
        .all()
      expect(tables).toEqual([])
    } finally {
      bare.close()
    }
  })
})

describe('dot run projection: coarse state only (U32)', () => {
  let harness: DotHarness
  beforeEach(() => {
    harness = createDotHarness()
  })
  afterEach(() => harness.close())

  it('shows the run state of a launched request', async () => {
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    expect(projectDotRun(harness.owner, record)).toEqual({ state: 'active', blocker: null })
  })

  it('maps every run status to a coarse dot state of the same name', async () => {
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    for (const status of WORKFLOW_RUN_STATUSES) {
      harness.owner.db
        .prepare(
          'UPDATE workflow_runs SET status = ?, end_reason = ?, ended_at = ? WHERE request_id = ?'
        )
        .run(
          status,
          ['failed', 'canceled', 'unverifiable'].includes(status) ? 'fixture' : null,
          ['completed', 'failed', 'canceled'].includes(status) ? '2026-10-05T00:01:00.000Z' : null,
          record.workbenchRequestId
        )
      expect(projectDotRun(harness.owner, record), status).toEqual({ state: status, blocker: null })
    }
  })

  it.each([
    ['coordinator_route_unavailable', 'coordinator_route_unavailable'],
    ['launch_refused', 'launch_failed'],
    ['launch_unverifiable', 'launch_failed'],
    ['budget_exhausted', 'other']
  ])('shows a blocked launch with detail %s as blocker %s', async (detail, blocker) => {
    harness.door.launch = 'received'
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    setWorkbenchStatus(harness, record.workbenchRequestId ?? '', 'LAUNCH_BLOCKED', detail)
    expect(projectDotRun(harness.owner, record)).toEqual({ state: 'blocked', blocker })
  })

  it.each([
    ['RECEIVED', 'not_started'],
    ['LAUNCHING', 'launching'],
    ['CANCELED', 'canceled']
  ])('shows a request in %s with no run as %s', async (status, state) => {
    harness.door.launch = 'received'
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    setWorkbenchStatus(harness, record.workbenchRequestId ?? '', status)
    expect(projectDotRun(harness.owner, record)).toEqual({ state, blocker: null })
  })

  it('reads as unverifiable when the request says launched but no run record exists', async () => {
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    harness.owner.db
      .prepare('DELETE FROM workflow_runs WHERE request_id = ?')
      .run(record.workbenchRequestId)
    expect(projectDotRun(harness.owner, record)).toEqual({ state: 'unverifiable', blocker: null })
  })

  it('shows not_started while the intake is unfinished, and no run once canceled or failed', async () => {
    harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    expect(projectDotRun(harness.owner, record)).toEqual({ state: 'not_started', blocker: null })
    const failed = getDotIngressStore(harness.owner).markFailed({
      dotRequestId: record.dotRequestId,
      failure: 'intake_refused',
      timestamp: '2026-10-05T00:01:00.000Z'
    }).record
    expect(projectDotRun(harness.owner, failed)).toBeNull()
  })
})
