import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import { runLifecycleWriteTransaction } from './orchestration/db/lifecycle-write-transaction-runner'
import type { OrchestrationDb } from './orchestration/db/orchestration-db'
import { requireIdleWorkbenchConnection } from './orchestration/db/workbench-connection-guard'
import type { WorkbenchStoredStatus } from './orchestration/db/workbench-request-schema-definition'
import { getWorkbenchRequestStore } from './orchestration/db/workbench-request-store'
import { transitionWorkbenchRequest } from './orchestration/db/workbench-request-transition'
import { getWorkflowRunStore, type WorkflowRunRecord } from './orchestration/db/workflow-run-store'
import { errorCodeOf } from './workflow-run/primary-session-ports'
import { isWorkbenchLaunchInFlight } from './workbench-intake-launch'

export type WorkbenchLaunchReconcileReport = {
  readonly launched: number
  readonly blocked: number
  readonly canceled: number
  /** Launches still in flight in this process, and rows another writer moved first. */
  readonly skipped: number
}

type Settlement = {
  readonly to: Extract<WorkbenchStoredStatus, 'LAUNCHED' | 'LAUNCH_BLOCKED' | 'CANCELED'>
  readonly blocker: RouteBlocker | null
  readonly workflowRunId: string | null
}

function blockedAs(
  detail: 'launch_refused' | 'launch_unverifiable',
  runId: string | null
): Settlement {
  return {
    to: 'LAUNCH_BLOCKED',
    blocker: { reason: 'launch_blocked', detail },
    workflowRunId: runId
  }
}

/** What the run record proves about a launch that a restart interrupted. */
function settlementFor(status: WorkbenchStoredStatus, run: WorkflowRunRecord | null): Settlement {
  if (status === 'RECEIVED' || run === null) {
    return blockedAs('launch_refused', null)
  }
  switch (run.status) {
    case 'active':
    case 'completing':
    case 'completed':
      return { to: 'LAUNCHED', blocker: null, workflowRunId: run.runId }
    case 'canceled':
      return { to: 'CANCELED', blocker: null, workflowRunId: null }
    case 'failed':
      return blockedAs('launch_refused', run.runId)
    default:
      return blockedAs('launch_unverifiable', run.runId)
  }
}

type PendingRow = { requestId: string; status: WorkbenchStoredStatus; revision: number }

function pendingRows(owner: OrchestrationDb): PendingRow[] {
  return owner.db
    .prepare(
      "SELECT request_id, status, revision FROM workbench_requests WHERE status IN ('RECEIVED', 'LAUNCHING') ORDER BY sequence"
    )
    .all()
    .map((row) => ({
      requestId: String(row.request_id),
      status: row.status === 'LAUNCHING' ? 'LAUNCHING' : 'RECEIVED',
      revision: Number(row.revision)
    }))
}

/**
 * Startup, once, after the primary-session reconcile and before any submit is accepted. The door
 * launches a request only right after recording it, so a RECEIVED or LAUNCHING row found now was
 * interrupted by a restart: it is settled from the run record, and never relaunched.
 */
export function reconcileWorkbenchLaunches(
  owner: OrchestrationDb,
  now: () => Date = () => new Date()
): WorkbenchLaunchReconcileReport {
  getWorkbenchRequestStore(owner)
  const runs = getWorkflowRunStore(owner)
  const counts = { launched: 0, blocked: 0, canceled: 0, skipped: 0 }
  for (const row of pendingRows(owner)) {
    if (isWorkbenchLaunchInFlight(row.requestId)) {
      counts.skipped += 1
      continue
    }
    const settlement = settlementFor(row.status, runs.getByRequestId(row.requestId))
    try {
      requireIdleWorkbenchConnection(owner.db)
      runLifecycleWriteTransaction(owner.db, 'workbench_request', () =>
        transitionWorkbenchRequest(owner.db, {
          requestId: row.requestId,
          from: row.status,
          expectedRevision: row.revision,
          ...settlement,
          timestamp: now().toISOString()
        })
      )
    } catch (error) {
      console.warn(`[workbench-intake] reconcile skipped a request: ${errorCodeOf(error)}`)
      counts.skipped += 1
      continue
    }
    const key =
      settlement.to === 'LAUNCHED'
        ? 'launched'
        : settlement.to === 'CANCELED'
          ? 'canceled'
          : 'blocked'
    counts[key] += 1
  }
  return counts
}
