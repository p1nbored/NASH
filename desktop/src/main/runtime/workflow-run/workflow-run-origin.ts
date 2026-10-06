import { DOT_INGRESS_PRINCIPAL_ID } from '../../../shared/dot-ingress/dot-ingress-limits'
import type { OrchestrationDb } from '../orchestration/db'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'

/** Who submitted the request a run was started for. */
export type WorkflowRunOrigin = 'dot' | 'desktop' | 'unknown'

export type WorkflowRunOriginRead =
  | { readonly found: false }
  | { readonly found: true; readonly origin: WorkflowRunOrigin; readonly requestId: string }

// The principal the desktop caller in workbench-caller.ts files its requests under.
const DESKTOP_PRINCIPAL_ID = 'local-desktop-ui'

function tableExists(db: OrchestrationDb, name: string): boolean {
  return Boolean(
    db.db
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name)
  )
}

function intakePrincipal(db: OrchestrationDb, requestId: string): string | null {
  if (!tableExists(db, 'workbench_requests')) {
    return null
  }
  const row = db.db
    .prepare('SELECT principal_id FROM workbench_requests WHERE request_id = ?')
    .get(requestId)
  return typeof row?.principal_id === 'string' ? row.principal_id : null
}

function hasDotIngressLink(db: OrchestrationDb, requestId: string): boolean {
  return (
    tableExists(db, 'dot_ingress_requests') &&
    Boolean(
      db.db
        .prepare(
          'SELECT 1 AS found FROM dot_ingress_requests WHERE workbench_request_id = ? LIMIT 1'
        )
        .get(requestId)
    )
  )
}

/**
 * The read D4 uses so dot can message only the runs dot started (D-019). The intake principal and the
 * dot ingress link are the evidence; none, or evidence for both sides, reads as unknown. Read-only:
 * a missing intake table is no evidence and is never created here.
 */
export function readWorkflowRunOrigin(db: OrchestrationDb, runId: string): WorkflowRunOriginRead {
  const run = getWorkflowRunStore(db).get(runId)
  if (!run) {
    return { found: false }
  }
  const principal = intakePrincipal(db, run.requestId)
  const dotEvidence = principal === DOT_INGRESS_PRINCIPAL_ID || hasDotIngressLink(db, run.requestId)
  const desktopEvidence = principal === DESKTOP_PRINCIPAL_ID
  const origin: WorkflowRunOrigin =
    dotEvidence === desktopEvidence ? 'unknown' : dotEvidence ? 'dot' : 'desktop'
  return { found: true, origin, requestId: run.requestId }
}
