import { z } from 'zod'
import {
  DOT_REQUEST_ACCESS_LEVELS,
  DOT_SUBMISSION_FAILURES,
  type DotRequestAccess,
  type DotSubmissionFailure
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import {
  DotCorrelationIdSchema,
  DotRequestIdSchema,
  DotWorkspaceRefSchema
} from '../../../../shared/dot-ingress/dot-ingress-params'
import {
  DOT_REQUEST_STATES,
  type DotRequestState
} from '../../../../shared/dot-ingress/dot-ingress-status-text'
import { parseDotRow } from './dot-ingress-store-input'

/**
 * The ingress-facing view of one row. It has no objective, no workspace id and no path: the columns
 * below never read them, so nothing built from a record can leak them to the dot.
 */
export type DotRequestRecord = {
  dotRequestId: string
  sequence: number
  revision: number
  state: DotRequestState
  workspaceRef: string
  requestedAccess: DotRequestAccess
  replyCorrelationId: string | null
  workbenchRequestId: string | null
  failureCode: DotSubmissionFailure | null
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

/**
 * What the caller of the single intake door needs for one row whose intake has not finished: the
 * door is called under the dot principal with `workbenchIdempotencyKey`, so a replay after a crash
 * returns the same Workbench request instead of creating a second one.
 */
export type DotIntakeHandle = {
  dotRequestId: string
  workspaceRef: string
  workspaceId: string
  workspaceBinding: string
  objective: string
  requestedAccess: DotRequestAccess
  workbenchIdempotencyKey: string
}

export const DOT_RECORD_COLUMNS = `sequence, dot_request_id, workspace_ref, requested_access,
  reply_correlation_id, state, revision, workbench_request_id, failure_code, created_at, updated_at, ended_at`

export const DOT_INTAKE_COLUMNS = `dot_request_id, workspace_ref, workspace_id, workspace_binding, objective,
  requested_access, workbench_idempotency_key`

const RecordRowSchema = z.object({
  sequence: z.number().int().positive(),
  dot_request_id: DotRequestIdSchema,
  workspace_ref: DotWorkspaceRefSchema,
  requested_access: z.enum(DOT_REQUEST_ACCESS_LEVELS),
  reply_correlation_id: DotCorrelationIdSchema.nullable(),
  state: z.enum(DOT_REQUEST_STATES),
  revision: z.number().int().positive(),
  workbench_request_id: z.string().min(1).nullable(),
  failure_code: z.enum(DOT_SUBMISSION_FAILURES).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  ended_at: z.string().nullable()
})

const IntakeRowSchema = z.object({
  dot_request_id: DotRequestIdSchema,
  workspace_ref: DotWorkspaceRefSchema,
  workspace_id: z.string().min(1),
  workspace_binding: z.string().length(64),
  objective: z.string().min(1),
  requested_access: z.enum(DOT_REQUEST_ACCESS_LEVELS),
  workbench_idempotency_key: z.uuid()
})

export function toDotRequestRecord(row: unknown): DotRequestRecord {
  const stored = parseDotRow(RecordRowSchema, row)
  return {
    dotRequestId: stored.dot_request_id,
    sequence: stored.sequence,
    revision: stored.revision,
    state: stored.state,
    workspaceRef: stored.workspace_ref,
    requestedAccess: stored.requested_access,
    replyCorrelationId: stored.reply_correlation_id,
    workbenchRequestId: stored.workbench_request_id,
    failureCode: stored.failure_code,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
    endedAt: stored.ended_at
  }
}

export function toDotIntakeHandle(row: unknown): DotIntakeHandle {
  const stored = parseDotRow(IntakeRowSchema, row)
  return {
    dotRequestId: stored.dot_request_id,
    workspaceRef: stored.workspace_ref,
    workspaceId: stored.workspace_id,
    workspaceBinding: stored.workspace_binding,
    objective: stored.objective,
    requestedAccess: stored.requested_access,
    workbenchIdempotencyKey: stored.workbench_idempotency_key
  }
}
