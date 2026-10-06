import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { WorkbenchStoredStatus } from './workbench-request-schema-definition'
import { transitionWorkbenchRequest } from './workbench-request-transition'

export type WorkbenchCancelTarget = {
  readonly requestId: string
  readonly status: WorkbenchStoredStatus
  readonly revision: number
}

/**
 * Cancels a received or launch-blocked request. A launching or launched request belongs to its
 * workflow run: the intake door stops that run first and then records the cancel (D3).
 */
export function cancelWorkbenchRequestRow(
  db: Database.Database,
  request: WorkbenchCancelTarget,
  timestamp: string
): void {
  if (request.status === 'CANCELED') {
    return
  }
  if (request.status === 'LAUNCHING' || request.status === 'LAUNCHED') {
    throw new OrchestrationError(
      'workbench_request_handed_off',
      'The request was handed to its workflow run. Stop the run to cancel it.'
    )
  }
  transitionWorkbenchRequest(db, {
    requestId: request.requestId,
    from: request.status,
    expectedRevision: request.revision,
    to: 'CANCELED',
    blocker: null,
    workflowRunId: null,
    timestamp
  })
}
