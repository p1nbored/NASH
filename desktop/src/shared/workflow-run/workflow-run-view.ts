import { z } from 'zod'
import { WORKBENCH_OBJECTIVE_MAX_LENGTH, WorkbenchWorkspaceIdSchema } from '../workbench-request'

/**
 * The desktop view of one workflow run (D-016 plan 1.2, D-019): the app's run record, its primary
 * session and, for `show`, what the session is doing now. Internal fields (workspace binding,
 * terminal handle, process incarnation, launch-token hash, receipts) never reach it.
 */

export const WORKFLOW_RUN_VIEW_STATUSES = [
  'launching',
  'active',
  'completing',
  'completed',
  'failed',
  'canceled',
  'unverifiable'
] as const
export const WORKFLOW_RUN_VIEW_ORIGINS = ['dot', 'desktop', 'unknown'] as const
export const WORKFLOW_RUN_VIEW_ACCESS_LEVELS = ['read_only', 'workspace_write'] as const
// D-027: every policy level a coordinator may run at, where the Claude CLI lists it.
export const WORKFLOW_RUN_VIEW_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
] as const
export const PRIMARY_SESSION_VIEW_STATES = [
  'starting',
  'running',
  'stopping',
  'stopped',
  'exited',
  'unverifiable'
] as const
export const PRIMARY_SESSION_VIEW_PERMISSION_MODES = ['manual', 'acceptEdits', 'plan'] as const
export const PRIMARY_AGENT_VIEW_ACTIVITIES = ['working', 'dialog_open', 'idle', 'unknown'] as const
export const PRIMARY_SESSION_VIEW_UNVERIFIABLE_REASONS = [
  'handle_unresolved',
  'incarnation_mismatch',
  'status_unreadable'
] as const
export const RUN_MESSAGE_VIEW_OUTCOMES = ['delivered', 'queued', 'refused'] as const
export const RUN_MESSAGE_VIEW_STATES = ['received', 'held', 'delivered', 'refused'] as const

export const WORKFLOW_RUN_LIST_DEFAULT_LIMIT = 50
export const WORKFLOW_RUN_LIST_MAX_LIMIT = 100

export const WorkflowRunIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
/** Reason codes as the stores record them; never free text. */
const ReasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const ModelIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const TimestampSchema = z.iso.datetime({ offset: true })
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

/** What the main agent in the primary pane is doing; the terminal handle stays in main. */
export const PrimarySessionLiveViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('live'), activity: z.enum(PRIMARY_AGENT_VIEW_ACTIVITIES) }).strict(),
  z.object({ kind: z.literal('agent_absent') }).strict(),
  z
    .object({
      kind: z.literal('unverifiable'),
      reason: z.enum(PRIMARY_SESSION_VIEW_UNVERIFIABLE_REASONS)
    })
    .strict(),
  z.object({ kind: z.literal('starting') }).strict(),
  z.object({ kind: z.literal('ended'), state: z.enum(['stopped', 'exited']) }).strict()
])
export type PrimarySessionLiveView = z.infer<typeof PrimarySessionLiveViewSchema>

export const PrimarySessionViewSchema = z
  .object({
    generation: z.number().int().min(1),
    state: z.enum(PRIMARY_SESSION_VIEW_STATES),
    permissionMode: z.enum(PRIMARY_SESSION_VIEW_PERMISSION_MODES),
    model: ModelIdSchema,
    effort: z.enum(WORKFLOW_RUN_VIEW_EFFORTS),
    /** Lets the desktop reveal the visible terminal tab; null until the pane exists. */
    paneKey: z.string().min(1).max(512).nullable(),
    endReason: ReasonCodeSchema.nullable(),
    startedAt: TimestampSchema,
    updatedAt: TimestampSchema,
    endedAt: TimestampSchema.nullable(),
    /** Read from the terminal for `show`; null in a list, which reads stored records only. */
    live: PrimarySessionLiveViewSchema.nullable()
  })
  .strict()
export type PrimarySessionView = z.infer<typeof PrimarySessionViewSchema>

export const WorkflowRunViewSchema = z
  .object({
    runId: WorkflowRunIdSchema,
    requestId: WorkflowRunIdSchema,
    /** Who submitted the request the run was started for (dot or the desktop). */
    origin: z.enum(WORKFLOW_RUN_VIEW_ORIGINS),
    workspaceId: WorkbenchWorkspaceIdSchema,
    /** The submitted objective from the intake receipt; null when the receipt is gone. */
    objective: z.string().max(WORKBENCH_OBJECTIVE_MAX_LENGTH).nullable(),
    status: z.enum(WORKFLOW_RUN_VIEW_STATUSES),
    revision: z.number().int().min(1),
    requestedAccess: z.enum(WORKFLOW_RUN_VIEW_ACCESS_LEVELS),
    deliverableLanguage: z.string().min(2).max(35).nullable(),
    routingTable: z.object({ version: z.number().int().min(1), sha256: Sha256Schema }).strict(),
    coordinator: z
      .object({ model: ModelIdSchema, effort: z.enum(WORKFLOW_RUN_VIEW_EFFORTS) })
      .strict(),
    endReason: ReasonCodeSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    endedAt: TimestampSchema.nullable(),
    /** The latest primary session; null before the launch recorded one. */
    primary: PrimarySessionViewSchema.nullable()
  })
  .strict()
export type WorkflowRunView = z.infer<typeof WorkflowRunViewSchema>

export const WorkflowRunListResultSchema = z
  .object({
    runs: z.array(WorkflowRunViewSchema).max(WORKFLOW_RUN_LIST_MAX_LIMIT),
    hasMore: z.boolean()
  })
  .strict()
export const WorkflowRunShowResultSchema = z.object({ run: WorkflowRunViewSchema }).strict()
export const WorkflowRunStopResultSchema = z
  .object({ run: WorkflowRunViewSchema, changed: z.boolean() })
  .strict()

/** D-019: what happened to a follow-up message; the message text is never echoed back. */
export const RunMessageSendResultSchema = z
  .object({
    outcome: z.enum(RUN_MESSAGE_VIEW_OUTCOMES),
    reason: ReasonCodeSchema.nullable(),
    messageId: WorkflowRunIdSchema.nullable(),
    state: z.enum(RUN_MESSAGE_VIEW_STATES).nullable(),
    duplicate: z.boolean()
  })
  .strict()

export type WorkflowRunListResult = z.infer<typeof WorkflowRunListResultSchema>
export type WorkflowRunShowResult = z.infer<typeof WorkflowRunShowResultSchema>
export type WorkflowRunStopResult = z.infer<typeof WorkflowRunStopResultSchema>
export type RunMessageSendResult = z.infer<typeof RunMessageSendResultSchema>
