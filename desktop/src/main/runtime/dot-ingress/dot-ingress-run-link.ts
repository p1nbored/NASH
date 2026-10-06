import { DOT_INGRESS_PRINCIPAL_ID } from '../../../shared/dot-ingress/dot-ingress-limits'
import { getDotIngressStore, type DotRequestRecord } from '../orchestration/db/dot-ingress-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import { readWorkflowRunOrigin } from '../workflow-run/workflow-run-origin'
import { dotRefusal } from './dot-ingress-refusals'

// Ownership (RG7, D-019): dot never names a run. A run is reached only from the dot request that
// started it, and every cancel, message and permission answer first proves that origin.

/** Probes sqlite_master so a read never creates the app tables on a database that has none. */
export function hasAppTable(db: OrchestrationDb, name: string): boolean {
  return (
    db.db
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  )
}

/**
 * The Workbench request a dot intake already created under the dot principal, found by the intake's
 * stable Workbench key without calling the door; null while the Workbench has not accepted it.
 */
export function findAcceptedWorkbenchRequestId(
  db: OrchestrationDb,
  workbenchIdempotencyKey: string
): string | null {
  if (!hasAppTable(db, 'workbench_requests')) {
    return null
  }
  const row = db.db
    .prepare(
      'SELECT request_id FROM workbench_requests WHERE principal_id = ? AND idempotency_key = ?'
    )
    .get(DOT_INGRESS_PRINCIPAL_ID, workbenchIdempotencyKey)
  return typeof row?.request_id === 'string' ? row.request_id : null
}

/**
 * The run the request's intake started, or null while none exists. A run whose origin evidence does
 * not say it came from this dot request is refused as inconsistent, never handed out.
 */
export function findDotRequestRun(
  db: OrchestrationDb,
  record: DotRequestRecord
): WorkflowRunRecord | null {
  const requestId = record.workbenchRequestId
  if (requestId === null || !hasAppTable(db, 'workflow_runs')) {
    return null
  }
  const run = getWorkflowRunStore(db).getByRequestId(requestId)
  if (!run) {
    return null
  }
  const origin = readWorkflowRunOrigin(db, run.runId)
  if (!origin.found || origin.origin !== 'dot' || origin.requestId !== requestId) {
    throw dotRefusal('dot_recovery_required')
  }
  return run
}

/** The dot request that started the run, or null for a run of any other origin. */
export function findDotRequestOfRun(db: OrchestrationDb, runId: string): DotRequestRecord | null {
  if (!hasAppTable(db, 'workflow_runs') || !hasAppTable(db, 'dot_ingress_requests')) {
    return null
  }
  const run = getWorkflowRunStore(db).get(runId)
  const origin = run ? readWorkflowRunOrigin(db, run.runId) : null
  if (!run || !origin?.found || origin.origin !== 'dot' || origin.requestId !== run.requestId) {
    return null
  }
  return getDotIngressStore(db).findByWorkbenchRequestId(run.requestId)
}
