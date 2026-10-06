import { z } from 'zod'
import {
  RouteBlockerSchema,
  RoutingStatusSchema,
  type RouteBlocker
} from './clef/clef-route-contract'

export const WORKBENCH_SCHEMA_VERSION = 1 as const
export const WORKBENCH_WORKSPACE_ID_MAX_LENGTH = 512
export const WORKBENCH_REQUEST_ID_MAX_LENGTH = 512
export const WORKBENCH_OBJECTIVE_MAX_LENGTH = 12_000
export const WORKBENCH_LIST_DEFAULT_LIMIT = 50
export const WORKBENCH_LIST_MAX_LIMIT = 100
const WORKBENCH_LINK_ID_MAX_LENGTH = 512
const WORKBENCH_RETIRED_BINDING_MAX_LENGTH = 128

/**
 * View statuses the renderer switches over. Stored v3 statuses project onto them: RECEIVED and
 * LAUNCHING show as ROUTING, LAUNCHED as ROUTED, LAUNCH_BLOCKED as ROUTING_BLOCKED.
 */
export const WORKBENCH_REQUEST_STATUSES = [
  'ROUTING_BLOCKED',
  'ROUTING',
  'ROUTED',
  'CANCELED'
] as const
export const WorkbenchRequestStatusSchema = z.enum(WORKBENCH_REQUEST_STATUSES)

/** Access a submitter asks for (D-018); it is recorded as given and never upgraded. */
export const WORKBENCH_REQUEST_ACCESS_LEVELS = ['read_only', 'workspace_write'] as const
export const WorkbenchRequestAccessSchema = z.enum(WORKBENCH_REQUEST_ACCESS_LEVELS)
export type WorkbenchRequestAccess = z.infer<typeof WorkbenchRequestAccessSchema>
export const WORKBENCH_DEFAULT_REQUEST_ACCESS: WorkbenchRequestAccess = 'read_only'

/** G0 outcome for intake while Clef is not configured. */
export const WORKBENCH_NOT_CONFIGURED_BLOCKER: RouteBlocker = Object.freeze({
  reason: 'classifier_unavailable',
  detail: 'not_configured'
})

export const WorkbenchWorkspaceIdSchema = z
  .string()
  .max(WORKBENCH_WORKSPACE_ID_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, 'Workspace ID must not be blank')
  .refine(
    (value) => value.isWellFormed() && !value.includes('\0'),
    'Workspace ID must be valid Unicode without null characters'
  )

export const WorkbenchRequestIdSchema = z
  .string()
  .max(WORKBENCH_REQUEST_ID_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, 'Request ID must not be blank')
  .refine(
    (value) => value.isWellFormed() && !value.includes('\0'),
    'Request ID must be valid Unicode without null characters'
  )

export const WorkbenchObjectiveSchema = z
  .string()
  .max(WORKBENCH_OBJECTIVE_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, 'Objective must not be blank')
  .refine((value) => value.isWellFormed(), 'Objective must contain valid Unicode')
  .refine((value) => !value.includes('\0'), 'Objective must not contain null characters')

export const WorkbenchPositiveIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

/** Orca run and task ids linked to a request; null until a run exists. */
const WorkbenchLinkIdSchema = z.string().min(1).max(WORKBENCH_LINK_ID_MAX_LENGTH)

// Why nullable strings: D-016 removed intake routing, so main always writes null; renderer fixtures still set them.
const RetiredBindingSchema = z.string().min(1).max(WORKBENCH_RETIRED_BINDING_MAX_LENGTH).nullable()

const requestFields = {
  schemaVersion: z.literal(WORKBENCH_SCHEMA_VERSION),
  requestId: WorkbenchRequestIdSchema,
  sequence: WorkbenchPositiveIntegerSchema,
  workspaceId: WorkbenchWorkspaceIdSchema,
  objective: WorkbenchObjectiveSchema,
  revision: WorkbenchPositiveIntegerSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  accepted: z.literal(true),
  deliveryState: z.literal('not_delivered'),
  permissionState: z.literal('not_requested'),
  workflowRunId: WorkbenchLinkIdSchema.nullable(),
  taskId: WorkbenchLinkIdSchema.nullable(),
  modelProfileId: RetiredBindingSchema,
  executionSurface: RetiredBindingSchema,
  pluginOperationId: RetiredBindingSchema,
  clefDecisionId: RetiredBindingSchema
}

export const WorkbenchRequestSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...requestFields,
      status: z.literal('ROUTING_BLOCKED'),
      routingBlocker: RouteBlockerSchema
    })
    .strict(),
  z.object({ ...requestFields, status: z.literal('ROUTING'), routingBlocker: z.null() }).strict(),
  z.object({ ...requestFields, status: z.literal('ROUTED'), routingBlocker: z.null() }).strict(),
  z.object({ ...requestFields, status: z.literal('CANCELED'), routingBlocker: z.null() }).strict()
])

export const WorkbenchListResultSchema = z
  .object({
    requests: z.array(WorkbenchRequestSchema).max(WORKBENCH_LIST_MAX_LIMIT),
    nextBeforeSequence: WorkbenchPositiveIntegerSchema.nullable(),
    capabilities: z
      .object({
        submit: z.literal(true),
        cancelPending: z.literal(true),
        dispatch: z.boolean()
      })
      .strict(),
    /** Current routing status summary; `ready` means routing is not blocked. */
    blocker: RoutingStatusSchema
  })
  .strict()
  .refine(
    (list) => !list.capabilities.dispatch || list.blocker === 'ready',
    'Dispatch capability requires ready routing'
  )

export const WorkbenchSubmitResultSchema = z
  .object({ request: WorkbenchRequestSchema, duplicate: z.boolean() })
  .strict()

export const WorkbenchCancelResultSchema = z
  .object({ request: WorkbenchRequestSchema, changed: z.boolean() })
  .strict()

export type WorkbenchRequest = z.infer<typeof WorkbenchRequestSchema>
export type WorkbenchRequestStatus = WorkbenchRequest['status']
export type WorkbenchListResult = z.infer<typeof WorkbenchListResultSchema>
export type WorkbenchSubmitResult = z.infer<typeof WorkbenchSubmitResultSchema>
export type WorkbenchCancelResult = z.infer<typeof WorkbenchCancelResultSchema>
