import { z } from 'zod'
import { DeliverableLanguageSchema } from '../deliverable-language'
import {
  DOT_DEFAULT_REQUEST_ACCESS,
  DOT_SUBMISSION_FAILURES
} from '../dot-ingress/dot-ingress-limits'
import {
  DotClientDescriptorSchema,
  DotRequestAccessSchema,
  DotRequestIdSchema,
  DotWorkspaceRefSchema
} from '../dot-ingress/dot-ingress-params'
import { DotRunViewSchema, DotWorkspaceLabelSchema } from '../dot-ingress/dot-ingress-request'
import { DotRateLimitsSchema } from '../dot-ingress/dot-ingress-settings'
import { DOT_REQUEST_STATES } from '../dot-ingress/dot-ingress-status-text'
import {
  WORKBENCH_LIST_DEFAULT_LIMIT,
  WORKBENCH_LIST_MAX_LIMIT,
  WorkbenchObjectiveSchema,
  WorkbenchPositiveIntegerSchema,
  WorkbenchWorkspaceIdSchema
} from '../workbench-request'

// The desktop side of the dot interface: the switch, the caps, the workspaces enabled for dot with
// their access ceiling, and a read of what dot submitted. Only the trusted desktop caller reaches it.

/** Mirrors DOT_INGRESS_FAILURES of the ingress control port (parity-tested in the main process). */
export const WORKBENCH_DOT_INGRESS_FAILURES = [
  'listen_failed',
  'metadata_invalid',
  'metadata_write_failed',
  'metadata_not_secured'
] as const

export const WorkbenchDotIngressSetEnabledParams = z.object({ enabled: z.boolean() }).strict()

export const WorkbenchDotIngressSetRateLimitsParams = DotRateLimitsSchema

/** The access ceiling is set on every enable; omitting it keeps dot requests read-only. */
export const WorkbenchDotIngressEnableWorkspaceParams = z
  .object({
    workspaceId: WorkbenchWorkspaceIdSchema,
    label: DotWorkspaceLabelSchema,
    maxAccess: DotRequestAccessSchema.default(DOT_DEFAULT_REQUEST_ACCESS)
  })
  .strict()

export const WorkbenchDotIngressDisableWorkspaceParams = z
  .object({ workspaceRef: DotWorkspaceRefSchema })
  .strict()

export const WorkbenchDotIngressRequestsListParams = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(WORKBENCH_LIST_MAX_LIMIT)
      .default(WORKBENCH_LIST_DEFAULT_LIMIT),
    beforeSequence: WorkbenchPositiveIntegerSchema.optional()
  })
  .strict()

const TimestampSchema = z.iso.datetime({ offset: true })

export const WorkbenchDotIngressWorkspaceSchema = z
  .object({
    workspaceRef: DotWorkspaceRefSchema,
    workspaceId: WorkbenchWorkspaceIdSchema,
    label: DotWorkspaceLabelSchema,
    enabled: z.boolean(),
    maxAccess: DotRequestAccessSchema
  })
  .strict()

/** `connection` is a literal: the app can tell that it listens, never that a dot is linked. */
export const WorkbenchDotIngressSettingsResultSchema = z
  .object({
    enabled: z.boolean(),
    connection: z.literal('not_connected'),
    listening: z.boolean(),
    failure: z.enum(WORKBENCH_DOT_INGRESS_FAILURES).nullable(),
    rateLimits: DotRateLimitsSchema,
    updatedAt: TimestampSchema.nullable(),
    workspaces: z.array(WorkbenchDotIngressWorkspaceSchema).max(WORKBENCH_LIST_MAX_LIMIT)
  })
  .strict()

/** What dot submitted, for the desktop; the client descriptor is the sender's unverified claim. */
export const WorkbenchDotIngressRequestViewSchema = z
  .object({
    dotRequestId: DotRequestIdSchema,
    sequence: WorkbenchPositiveIntegerSchema,
    state: z.enum(DOT_REQUEST_STATES),
    workspaceRef: DotWorkspaceRefSchema,
    workspaceId: WorkbenchWorkspaceIdSchema,
    objective: WorkbenchObjectiveSchema,
    requestedAccess: DotRequestAccessSchema,
    deliverableLanguage: DeliverableLanguageSchema.nullable(),
    claimedClient: DotClientDescriptorSchema.nullable(),
    failureCode: z.enum(DOT_SUBMISSION_FAILURES).nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    run: DotRunViewSchema.nullable()
  })
  .strict()

export const WorkbenchDotIngressRequestsListResultSchema = z
  .object({
    requests: z.array(WorkbenchDotIngressRequestViewSchema).max(WORKBENCH_LIST_MAX_LIMIT),
    nextBeforeSequence: WorkbenchPositiveIntegerSchema.nullable()
  })
  .strict()

export type WorkbenchDotIngressSettingsResult = z.infer<
  typeof WorkbenchDotIngressSettingsResultSchema
>
export type WorkbenchDotIngressRequestView = z.infer<typeof WorkbenchDotIngressRequestViewSchema>
export type WorkbenchDotIngressRequestsListResult = z.infer<
  typeof WorkbenchDotIngressRequestsListResultSchema
>
