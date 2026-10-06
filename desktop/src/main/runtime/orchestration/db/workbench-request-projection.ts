import { z } from 'zod'
import { OrchestrationError } from '../orchestration-error'
import {
  WorkbenchRequestSchema,
  type WorkbenchRequest,
  type WorkbenchRequestStatus
} from '../../../../shared/workbench-request'
import {
  WORKBENCH_STORED_STATUSES,
  type WorkbenchStoredStatus
} from './workbench-request-schema-definition'

/**
 * Section 1.2 view stabilization: the renderer keeps its four statuses. RECEIVED and LAUNCHING read
 * as ROUTING, LAUNCHED as ROUTED and LAUNCH_BLOCKED as ROUTING_BLOCKED with its launch blocker.
 */
export const WORKBENCH_VIEW_STATUS: Readonly<
  Record<WorkbenchStoredStatus, WorkbenchRequestStatus>
> = Object.freeze({
  RECEIVED: 'ROUTING',
  LAUNCHING: 'ROUTING',
  LAUNCHED: 'ROUTED',
  LAUNCH_BLOCKED: 'ROUTING_BLOCKED',
  CANCELED: 'CANCELED'
})

export const WORKBENCH_REQUEST_COLUMNS = `r.sequence, r.request_id, r.workspace_id, r.objective, r.status,
  r.revision, r.created_at, r.updated_at, r.blocker_reason, r.blocker_detail, r.workflow_run_id`

const StoredStatusSchema = z.enum(WORKBENCH_STORED_STATUSES)

function storedRowInvalid(): OrchestrationError {
  return new OrchestrationError(
    'workbench_recovery_required',
    'A stored request does not match the Workbench v3 layout.'
  )
}

export function storedWorkbenchStatus(row: Record<string, unknown>): WorkbenchStoredStatus {
  const status = StoredStatusSchema.safeParse(row.status)
  if (!status.success) {
    throw storedRowInvalid()
  }
  return status.data
}

export function projectWorkbenchRequest(row: Record<string, unknown>): WorkbenchRequest {
  const status = storedWorkbenchStatus(row)
  const blocked = row.blocker_reason !== null || row.blocker_detail !== null
  const view = WorkbenchRequestSchema.safeParse({
    schemaVersion: 1,
    requestId: row.request_id,
    sequence: row.sequence,
    workspaceId: row.workspace_id,
    objective: row.objective,
    status: WORKBENCH_VIEW_STATUS[status],
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accepted: true,
    deliveryState: 'not_delivered',
    routingBlocker: blocked ? { reason: row.blocker_reason, detail: row.blocker_detail } : null,
    permissionState: 'not_requested',
    workflowRunId: row.workflow_run_id,
    taskId: null,
    modelProfileId: null,
    executionSurface: null,
    pluginOperationId: null,
    clefDecisionId: null
  })
  if (!view.success) {
    throw storedRowInvalid()
  }
  return view.data
}
