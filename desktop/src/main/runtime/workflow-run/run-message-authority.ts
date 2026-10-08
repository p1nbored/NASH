import type { OrchestrationDb } from '../orchestration/db'
import type { RunMessageRecord } from '../orchestration/db/run-message-store'
import { dotCoordinatorControlEnabled } from '../orchestration/db/dot-coordinator-attachment'
import { findDotRequestOfRun } from '../dot-ingress/dot-ingress-run-link'

/** Rechecked at the write boundary, so a queued Dot message loses authority when access is revoked. */
export function runMessageSourceAllowed(
  db: OrchestrationDb,
  message: Pick<RunMessageRecord, 'runId' | 'source'>
): boolean {
  if (message.source !== 'dot') {
    return true
  }
  try {
    const request = findDotRequestOfRun(db, message.runId)
    return request !== null && dotCoordinatorControlEnabled(db, request.dotRequestId)
  } catch {
    return false
  }
}
