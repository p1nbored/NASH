import { z } from 'zod'
import {
  WORKBENCH_DEFAULT_REQUEST_ACCESS,
  WORKBENCH_LIST_DEFAULT_LIMIT,
  WORKBENCH_LIST_MAX_LIMIT,
  WorkbenchObjectiveSchema,
  WorkbenchPositiveIntegerSchema,
  WorkbenchRequestAccessSchema,
  WorkbenchRequestIdSchema,
  WorkbenchWorkspaceIdSchema
} from '../workbench-request'

export const WorkbenchSubmitParams = z
  .object({
    workspaceId: WorkbenchWorkspaceIdSchema,
    objective: WorkbenchObjectiveSchema,
    idempotencyKey: z.uuid(),
    requestedAccess: WorkbenchRequestAccessSchema.default(WORKBENCH_DEFAULT_REQUEST_ACCESS)
  })
  .strict()

export const WorkbenchListParams = z
  .object({
    workspaceId: WorkbenchWorkspaceIdSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(WORKBENCH_LIST_MAX_LIMIT)
      .default(WORKBENCH_LIST_DEFAULT_LIMIT),
    beforeSequence: WorkbenchPositiveIntegerSchema.optional()
  })
  .strict()

export const WorkbenchCancelParams = z
  .object({
    workspaceId: WorkbenchWorkspaceIdSchema,
    requestId: WorkbenchRequestIdSchema,
    expectedRevision: WorkbenchPositiveIntegerSchema
  })
  .strict()

/** Verification takes no input: the synthetic request and its question set are fixed in code. */
export const WorkbenchClefVerifyParams = z.object({}).strict()

/** Only the hash of the report the user confirmed; the profile itself is never sent by a caller. */
export const WorkbenchClefProfilePinParams = z
  .object({ reportSha256: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict()

// Why the input type: callers may omit the defaulted access; the store parses and fills it.
export type WorkbenchSubmitInput = z.input<typeof WorkbenchSubmitParams>
export type WorkbenchListInput = z.infer<typeof WorkbenchListParams>
export type WorkbenchCancelInput = z.infer<typeof WorkbenchCancelParams>
export type WorkbenchClefProfilePinInput = z.infer<typeof WorkbenchClefProfilePinParams>
