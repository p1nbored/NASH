import { z } from 'zod'
import { DotRequestAccessSchema, DotWorkspaceRefSchema } from '../dot-ingress/dot-ingress-params'
import { DotWorkspaceLabelSchema } from '../dot-ingress/dot-ingress-request'
import { WORKBENCH_LIST_MAX_LIMIT } from '../workbench-request'
import { DOT_REMOTE_CONTRACT_VERSION, DOT_REMOTE_ONLINE_WINDOW_SECONDS } from './dot-remote-limits'
import {
  DotRemoteAppVersionSchema,
  DotRemoteGenerationSchema,
  DotRemoteSha256Schema,
  DotRemoteTimestampSchema
} from './dot-remote-primitives'

// What NASH publishes about itself: that it is online, and which workspaces dot may target. A
// workspace is an opaque dws_ ref with the user's display name and its access maximum; a path never
// leaves the PC.

export const DotRemoteHeartbeatRequestSchema = z
  .object({
    generation: DotRemoteGenerationSchema,
    appVersion: DotRemoteAppVersionSchema,
    contractVersion: z.literal(DOT_REMOTE_CONTRACT_VERSION),
    sentAt: DotRemoteTimestampSchema
  })
  .strict()

export const DotRemoteHeartbeatResponseSchema = z
  .object({ serverTime: DotRemoteTimestampSchema })
  .strict()

export const DotRemoteWorkspaceSchema = z
  .object({
    workspaceRef: DotWorkspaceRefSchema,
    displayName: DotWorkspaceLabelSchema,
    /** v4 (D-034): the most access a task here may ask for, set by the user in NASH. */
    maxAccess: DotRequestAccessSchema
  })
  .strict()

const WorkspaceListSchema = z
  .array(DotRemoteWorkspaceSchema)
  .max(WORKBENCH_LIST_MAX_LIMIT)
  .refine(
    (workspaces) =>
      new Set(workspaces.map((entry) => entry.workspaceRef)).size === workspaces.length,
    'Workspace refs must be unique'
  )

/** Replaces the whole list; NASH publishes it again whenever the user changes it. */
export const DotRemoteWorkspaceListRequestSchema = z
  .object({
    generation: DotRemoteGenerationSchema,
    publishedAt: DotRemoteTimestampSchema,
    workspaces: WorkspaceListSchema
  })
  .strict()

export const DotRemoteWorkspaceListResponseSchema = z
  .object({ storedAt: DotRemoteTimestampSchema })
  .strict()

/** What dot reads from nash_status: the Site's record of the last heartbeat. */
export const DotRemoteStatusViewSchema = z
  .object({
    paired: z.boolean(),
    online: z.boolean(),
    lastSeenAt: DotRemoteTimestampSchema.nullable(),
    appVersion: DotRemoteAppVersionSchema.nullable(),
    contractVersion: z.literal(DOT_REMOTE_CONTRACT_VERSION).nullable(),
    onlineWindowSeconds: z.literal(DOT_REMOTE_ONLINE_WINDOW_SECONDS),
    /** The manifestSha256 of the manifest copy the Site serves from; it names no owner or device. */
    manifestSha256: DotRemoteSha256Schema
  })
  .strict()
  .refine((status) => !status.online || (status.paired && status.lastSeenAt !== null), {
    message: 'Online needs a pairing and a last heartbeat',
    path: ['online']
  })

export const DotRemoteWorkspaceListViewSchema = z
  .object({ workspaces: WorkspaceListSchema, publishedAt: DotRemoteTimestampSchema.nullable() })
  .strict()
