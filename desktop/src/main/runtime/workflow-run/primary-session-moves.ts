import type { OrchestrationDb } from '../orchestration/db'
import {
  PRIMARY_SESSION_TRANSITIONS,
  getPrimarySessionStore,
  type PrimarySessionRecord,
  type PrimarySessionState
} from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import {
  isWorkflowRunTransitionAllowed,
  type WorkflowRunStatus
} from '../orchestration/db/workflow-run-transition'

/**
 * Moves the run from whatever status it has now, when the frozen edge list allows it; otherwise the
 * current record is returned unchanged (another writer already settled it).
 */
export function moveWorkflowRun(
  db: OrchestrationDb,
  runId: string,
  to: WorkflowRunStatus,
  reason: string | null,
  timestamp: string
): WorkflowRunRecord | null {
  const runs = getWorkflowRunStore(db)
  const current = runs.get(runId)
  if (!current || current.status === to || !isWorkflowRunTransitionAllowed(current.status, to)) {
    return current
  }
  return runs.transition({
    runId,
    from: current.status,
    to,
    expectedRevision: current.revision,
    reason,
    timestamp
  })
}

/** The same for an owner: compare-and-set on its current state, never against a stale copy. */
export function moveOwner(
  db: OrchestrationDb,
  ownerId: string,
  to: PrimarySessionState,
  reason: string | null,
  timestamp: string
): PrimarySessionRecord | null {
  const sessions = getPrimarySessionStore(db)
  const current = sessions.get(ownerId)
  if (
    !current ||
    current.state === to ||
    !PRIMARY_SESSION_TRANSITIONS[current.state].includes(to)
  ) {
    return current
  }
  return sessions.transition({ ownerId, from: current.state, to, reason, timestamp })
}
