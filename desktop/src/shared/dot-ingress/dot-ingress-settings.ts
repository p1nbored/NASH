import { z } from 'zod'
import { WORKBENCH_LIST_MAX_LIMIT, WorkbenchWorkspaceIdSchema } from '../workbench-request'
import {
  DOT_INGRESS_RATE_PER_MINUTE_MAX,
  DOT_INGRESS_RATE_PER_UTC_DAY_MAX
} from './dot-ingress-limits'
import { DotWorkspaceRefSchema } from './dot-ingress-params'
import { DotWorkspaceLabelSchema } from './dot-ingress-request'

// Desktop-only views of the dot interface settings. They are never sent through the ingress endpoint,
// whose registry has no method returning them.

const TimestampSchema = z.iso.datetime({ offset: true })

/** The desktop sees the Workbench workspace id; dot never does. */
export const DotAllowedWorkspaceSchema = z
  .object({
    workspaceRef: DotWorkspaceRefSchema,
    workspaceId: WorkbenchWorkspaceIdSchema,
    label: DotWorkspaceLabelSchema,
    enabled: z.boolean()
  })
  .strict()

/** The two user-changeable caps; the user may change them at any time without a per-task step. */
export const DotRateLimitsSchema = z
  .object({
    ratePerMinute: z.number().int().min(1).max(DOT_INGRESS_RATE_PER_MINUTE_MAX),
    ratePerUtcDay: z.number().int().min(1).max(DOT_INGRESS_RATE_PER_UTC_DAY_MAX)
  })
  .strict()

/** `connection` is a literal: the interface exists, and no link to a dot is ever established or verified. */
export const DotIngressSettingsViewSchema = z
  .object({
    enabled: z.boolean(),
    connection: z.literal('not_connected'),
    rateLimits: DotRateLimitsSchema,
    updatedAt: TimestampSchema.nullable(),
    workspaces: z.array(DotAllowedWorkspaceSchema).max(WORKBENCH_LIST_MAX_LIMIT)
  })
  .strict()

export type DotAllowedWorkspace = z.infer<typeof DotAllowedWorkspaceSchema>
export type DotRateLimits = z.infer<typeof DotRateLimitsSchema>
export type DotIngressSettingsView = z.infer<typeof DotIngressSettingsViewSchema>
