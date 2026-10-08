import { z } from 'zod'
import { RoutingTableEditSchema } from '../routing-table/routing-table-edit-schema'
import { WorkbenchWorkspaceIdSchema } from '../workbench-request'
import {
  WORKFLOW_RUN_LIST_DEFAULT_LIMIT,
  WORKFLOW_RUN_LIST_MAX_LIMIT,
  WorkflowRunIdSchema
} from '../workflow-run/workflow-run-view'

/**
 * Desktop-only params for workflow runs and the Routing Table (D-016, D-019). None of them names a
 * caller, a message source or a principal: the trusted desktop caller comes from the RPC context.
 */

/** UTF-16 units, twice the delivery service's 65,536 code point technical ceiling (D-027). */
export const WORKBENCH_RUN_MESSAGE_MAX_UNITS = 131_072

export const WorkbenchRunListParams = z
  .object({
    workspaceId: WorkbenchWorkspaceIdSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(WORKFLOW_RUN_LIST_MAX_LIMIT)
      .default(WORKFLOW_RUN_LIST_DEFAULT_LIMIT)
  })
  .strict()

export const WorkbenchRunShowParams = z.object({ runId: WorkflowRunIdSchema }).strict()

export const WorkbenchRunStopParams = z.object({ runId: WorkflowRunIdSchema }).strict()

/** D-019: the idempotency key becomes the message's source request id, so a retry is not resent. */
export const WorkbenchRunMessageParams = z
  .object({
    runId: WorkflowRunIdSchema,
    idempotencyKey: z.uuid(),
    text: z.string().min(1).max(WORKBENCH_RUN_MESSAGE_MAX_UNITS)
  })
  .strict()

export const WorkbenchRoutingTableListParams = z.object({}).strict()

export const WorkbenchRoutingTableSaveParams = RoutingTableEditSchema

/** "Check now": the active table only, table-wide; nothing on the wire chooses what is read. */
export const WorkbenchRoutingTableCheckRoutesParams = z.object({}).strict()

export type WorkbenchRunListInput = z.infer<typeof WorkbenchRunListParams>
export type WorkbenchRunMessageInput = z.infer<typeof WorkbenchRunMessageParams>
