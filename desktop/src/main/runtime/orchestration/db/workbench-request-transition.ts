import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { RouteBlocker } from '../../../../shared/clef/clef-route-contract'
import type {
  WorkbenchRequestEventKind,
  WorkbenchStoredStatus
} from './workbench-request-schema-definition'

export type WorkbenchRequestTransition = {
  requestId: string
  from: WorkbenchStoredStatus
  expectedRevision: number
  to: WorkbenchStoredStatus
  /** Only LAUNCH_BLOCKED carries a blocker, and only with the launch_blocked reason. */
  blocker: RouteBlocker | null
  /** Written by LAUNCHED, or by LAUNCH_BLOCKED after a run was created; a stored link is never cleared. */
  workflowRunId: string | null
  timestamp: string
}

export type WorkbenchRequestInsert = {
  requestId: string
  workspaceId: string
  workspaceBinding: string
  principalId: string
  idempotencyKey: string
  inputHash: string
  objective: string
  timestamp: string
}

/** Appends an audit event at the request's current revision. */
export function insertWorkbenchRequestEvent(
  db: Database.Database,
  requestId: string,
  kind: WorkbenchRequestEventKind,
  timestamp: string
): void {
  db.prepare(
    'INSERT INTO workbench_request_events (request_id, kind, revision, recorded_at, input_hash) SELECT request_id, ?, revision, ?, input_hash FROM workbench_requests WHERE request_id = ?'
  ).run(kind, timestamp, requestId)
}

/** A new receipt is RECEIVED at revision 1; only the intake door launches it. */
export function insertWorkbenchRequest(db: Database.Database, row: WorkbenchRequestInsert): void {
  db.prepare(`INSERT INTO workbench_requests
    (request_id, workspace_id, workspace_binding, principal_id, idempotency_key, input_hash, objective,
    status, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 1, ?, ?)`).run(
    row.requestId,
    row.workspaceId,
    row.workspaceBinding,
    row.principalId,
    row.idempotencyKey,
    row.inputHash,
    row.objective,
    row.timestamp,
    row.timestamp
  )
  insertWorkbenchRequestEvent(db, row.requestId, 'accepted', row.timestamp)
}

// Why: callers fence on status, but this primitive is exported and would accept any pair; CANCELED is final.
const ALLOWED_TRANSITIONS: Readonly<
  Record<WorkbenchStoredStatus, readonly WorkbenchStoredStatus[]>
> = Object.freeze({
  RECEIVED: ['LAUNCHING', 'LAUNCH_BLOCKED', 'CANCELED'],
  LAUNCHING: ['LAUNCHED', 'LAUNCH_BLOCKED', 'CANCELED'],
  LAUNCHED: ['CANCELED'],
  LAUNCH_BLOCKED: ['CANCELED'],
  CANCELED: []
})

const EVENT_FOR_TARGET: Readonly<Record<WorkbenchStoredStatus, WorkbenchRequestEventKind>> =
  Object.freeze({
    RECEIVED: 'accepted',
    LAUNCHING: 'launch_started',
    LAUNCHED: 'launched',
    LAUNCH_BLOCKED: 'launch_blocked',
    CANCELED: 'canceled'
  })

export function isWorkbenchRequestTransitionAllowed(
  from: WorkbenchStoredStatus,
  to: WorkbenchStoredStatus
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Moves one allowed edge under the caller's revision and status fence; returns the new revision. */
export function transitionWorkbenchRequest(
  db: Database.Database,
  transition: WorkbenchRequestTransition
): number {
  const { requestId, expectedRevision, blocker } = transition
  if (!isWorkbenchRequestTransitionAllowed(transition.from, transition.to)) {
    throw new OrchestrationError(
      'workbench_invalid_transition',
      `Request cannot move from ${transition.from} to ${transition.to}.`
    )
  }
  const changed = db
    .prepare(`UPDATE workbench_requests SET status = ?, revision = revision + 1, updated_at = ?,
      blocker_reason = ?, blocker_detail = ?, workflow_run_id = COALESCE(?, workflow_run_id)
      WHERE request_id = ? AND revision = ? AND status = ?`)
    .run(
      transition.to,
      transition.timestamp,
      blocker?.reason ?? null,
      blocker?.detail ?? null,
      transition.workflowRunId,
      requestId,
      expectedRevision,
      transition.from
    )
  if (Number(changed.changes) !== 1) {
    throw new OrchestrationError(
      'workbench_revision_conflict',
      'Request changed before this move. Nothing was written.'
    )
  }
  insertWorkbenchRequestEvent(db, requestId, EVENT_FOR_TARGET[transition.to], transition.timestamp)
  return expectedRevision + 1
}
