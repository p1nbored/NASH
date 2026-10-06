import { z } from 'zod'
import { PERMISSION_RELAY_WAIT_SECONDS } from '../workflow-run/autopilot-cli-commands'
import { AutopilotIdSchema, AutopilotToolNameSchema } from './autopilot-identifier-fields'
import {
  PERMISSION_DECISION_DECIDERS,
  PERMISSION_DECISION_STATUSES
} from './permission-decision-values'

/**
 * The permission relay's wire contract (D-016, D-017). The PermissionRequest hook command sends
 * only tool, command and file names; file contents never leave the hook process. The decision it
 * prints is validated against the shape documented in Claude Code's hooks reference
 * ("PermissionRequest decision control"); `updatedPermissions` and `updatedInput` are never sent.
 */

/** The tool_input keys the hook forwards: commands and file names, never contents (D-017). */
export const PERMISSION_RELAY_INPUT_KEYS = [
  'command',
  'file_path',
  'notebook_path',
  'path',
  'pattern'
] as const
export type PermissionRelayInputKey = (typeof PERMISSION_RELAY_INPUT_KEYS)[number]

/** A longer field is not relayed: the terminal dialog answers it. */
export const PERMISSION_RELAY_FIELD_MAX_CHARS = 16_384
export const PERMISSION_RELAY_WAIT_MS = PERMISSION_RELAY_WAIT_SECONDS * 1000
/** Each server wait returns within this, below the socket idle limit, so the CLI loops. */
export const PERMISSION_WAIT_SLICE_MAX_MS = 20_000

/** The store's own values, so the view and the CHECK lists cannot drift apart. */
export const PERMISSION_DECISION_VIEW_STATUSES = PERMISSION_DECISION_STATUSES

const RelayIdentifier = AutopilotIdSchema
const ToolName = AutopilotToolNameSchema
const RelayField = z.string().min(1).max(PERMISSION_RELAY_FIELD_MAX_CHARS)
const Timestamp = z.iso.datetime({ offset: true })

export const PermissionRelayToolInput = z
  .object({
    command: RelayField.optional(),
    file_path: RelayField.optional(),
    notebook_path: RelayField.optional(),
    path: RelayField.optional(),
    pattern: RelayField.optional()
  })
  .strict()

export const PermissionRequestParams = z
  .object({
    toolName: ToolName,
    agentId: RelayIdentifier.nullable(),
    cwd: z.string().min(1).max(4096).nullable(),
    toolInput: PermissionRelayToolInput,
    requestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    // Why: the hook says how long it can still wait, so the relay never outlasts its timeout.
    waitBudgetMs: z.number().int().min(1_000).max(PERMISSION_RELAY_WAIT_MS)
  })
  .strict()
export type PermissionRequestInput = z.infer<typeof PermissionRequestParams>

export const PermissionWaitParams = z
  .object({
    decisionId: RelayIdentifier,
    waitMs: z.number().int().min(1).max(PERMISSION_WAIT_SLICE_MAX_MS)
  })
  .strict()
export type PermissionWaitInput = z.infer<typeof PermissionWaitParams>

const PermissionHookDecisionSchema = z.discriminatedUnion('behavior', [
  z.object({ behavior: z.literal('allow') }).strict(),
  z.object({ behavior: z.literal('deny'), message: z.string().min(1).max(500) }).strict()
])

/** hooks.md: `hookSpecificOutput.hookEventName` plus a `decision` with `behavior` (and `message` on deny). */
export const PermissionHookOutputSchema = z
  .object({
    hookSpecificOutput: z
      .object({
        hookEventName: z.literal('PermissionRequest'),
        decision: PermissionHookDecisionSchema
      })
      .strict()
  })
  .strict()
export type PermissionHookOutput = z.infer<typeof PermissionHookOutputSchema>

export const PermissionRequestResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({ outcome: z.literal('relayed'), decisionId: RelayIdentifier, deadlineAt: Timestamp })
    .strict(),
  z.object({ outcome: z.literal('not_relayed'), reason: z.enum(['terminal_only_tool']) }).strict()
])
export type PermissionRequestResult = z.infer<typeof PermissionRequestResultSchema>

/** `no_decision`: print nothing, so Claude Code shows its own dialog (or already took a terminal answer). */
export const PermissionWaitResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending') }).strict(),
  z.object({ state: z.literal('decided'), hookOutput: PermissionHookOutputSchema }).strict(),
  z.object({ state: z.literal('no_decision') }).strict()
])
export type PermissionWaitResult = z.infer<typeof PermissionWaitResultSchema>

export const WorkbenchPermissionListParams = z
  .object({
    runId: RelayIdentifier.optional(),
    statuses: z.array(z.enum(PERMISSION_DECISION_VIEW_STATUSES)).max(5).optional(),
    limit: z.number().int().min(1).max(200).optional()
  })
  .strict()
export type WorkbenchPermissionListInput = z.infer<typeof WorkbenchPermissionListParams>

export const WorkbenchPermissionAnswerParams = z
  .object({ decisionId: RelayIdentifier, decision: z.enum(['allow', 'deny']) })
  .strict()
export type WorkbenchPermissionAnswerInput = z.infer<typeof WorkbenchPermissionAnswerParams>

/** What the desktop shows: names and state only, the same redacted summary dot gets. */
export const WorkbenchPermissionDecisionViewSchema = z
  .object({
    decisionId: RelayIdentifier,
    runId: RelayIdentifier,
    agentId: RelayIdentifier.nullable(),
    toolName: ToolName,
    summary: z.string().min(1).max(1000),
    status: z.enum(PERMISSION_DECISION_VIEW_STATUSES),
    decidedBy: z.enum(PERMISSION_DECISION_DECIDERS).nullable(),
    createdAt: Timestamp,
    deadlineAt: Timestamp,
    decidedAt: Timestamp.nullable(),
    desktopOnly: z.boolean(),
    answerable: z.boolean()
  })
  .strict()
export type WorkbenchPermissionDecisionView = z.infer<typeof WorkbenchPermissionDecisionViewSchema>

export const WorkbenchPermissionListResultSchema = z
  .object({ decisions: z.array(WorkbenchPermissionDecisionViewSchema) })
  .strict()
export type WorkbenchPermissionListResult = z.infer<typeof WorkbenchPermissionListResultSchema>

/** `closed`: the relay wait is over (or no hook waits any more), so the prompt is answered in the terminal. */
export const WorkbenchPermissionAnswerResultSchema = z
  .object({
    outcome: z.enum(['decided', 'already_decided', 'closed', 'not_found']),
    decision: WorkbenchPermissionDecisionViewSchema.nullable()
  })
  .strict()
export type WorkbenchPermissionAnswerResult = z.infer<typeof WorkbenchPermissionAnswerResultSchema>
