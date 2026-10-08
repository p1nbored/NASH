import { z } from 'zod'
import {
  PERMISSION_DECISION_DECIDERS,
  PERMISSION_DECISION_STATUSES,
  PERMISSION_SUMMARY_MAX_CHARS
} from './autopilot-run-schema-definition'
import {
  AutopilotIdSchema,
  AutopilotLimitSchema,
  AutopilotToolNameSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
  parseStoredRow
} from './autopilot-store-input'

export type PermissionDecisionStatus = (typeof PERMISSION_DECISION_STATUSES)[number]

/** Caps how many prompts one session can leave waiting, so a runaway caller cannot grow the table. */
export const PERMISSION_PENDING_LIMIT_PER_OWNER = 32
/** The relay waits 240 s by default; the longest accepted wait is 15 minutes. */
export const PERMISSION_DECISION_MAX_WAIT_MS = 900_000

// Why: a summary is one short line of names, never contents; a UTF-16 length over twice the cap
// cannot hold 500 code points.
const SUMMARY_MAX_UTF16_UNITS = PERMISSION_SUMMARY_MAX_CHARS * 2
const LINE_BREAK_OR_CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u

const SummarySchema = z.string().refine((summary) => {
  const codePoints = summary.length <= SUMMARY_MAX_UTF16_UNITS ? Array.from(summary).length : 0
  return (
    codePoints >= 1 &&
    codePoints <= PERMISSION_SUMMARY_MAX_CHARS &&
    !LINE_BREAK_OR_CONTROL.test(summary)
  )
})

export const PermissionDecisionCreateSchema = z
  .object({
    runId: AutopilotIdSchema,
    ownerId: AutopilotIdSchema,
    agentId: AutopilotIdSchema.nullable(),
    toolName: AutopilotToolNameSchema,
    summary: SummarySchema,
    requestSha256: Sha256HexSchema,
    deadlineAt: UtcTimestampSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
  .refine(
    (input) => {
      const wait = Date.parse(input.deadlineAt) - Date.parse(input.timestamp)
      return wait > 0 && wait <= PERMISSION_DECISION_MAX_WAIT_MS
    },
    { path: ['deadlineAt'] }
  )
export type PermissionDecisionCreate = z.infer<typeof PermissionDecisionCreateSchema>

export const PermissionAnswerSchema = z
  .object({
    decisionId: AutopilotIdSchema,
    decision: z.enum(['allowed', 'denied']),
    decidedBy: z.enum(['dot', 'desktop', 'primary']),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type PermissionAnswerInput = z.infer<typeof PermissionAnswerSchema>

export const PermissionTerminalAnswerSchema = z
  .object({ decisionId: AutopilotIdSchema, timestamp: UtcTimestampSchema })
  .strict()
export type PermissionTerminalAnswerInput = z.infer<typeof PermissionTerminalAnswerSchema>

export const PermissionDecisionListSchema = z
  .object({
    statuses: z.array(z.enum(PERMISSION_DECISION_STATUSES)).optional(),
    limit: AutopilotLimitSchema
  })
  .strict()

const RowSchema = z.object({
  decision_id: z.string(),
  run_id: z.string(),
  owner_id: z.string(),
  agent_id: z.string().nullable(),
  tool_name: z.string(),
  summary: z.string(),
  request_sha256: z.string(),
  status: z.enum(PERMISSION_DECISION_STATUSES),
  decided_by: z.enum(PERMISSION_DECISION_DECIDERS).nullable(),
  created_at: z.string(),
  deadline_at: z.string(),
  decided_at: z.string().nullable()
})

/** What dot and the desktop see: names and a hash, never the tool input or any file contents. */
export type PermissionDecisionRecord = {
  decisionId: string
  runId: string
  ownerId: string
  agentId: string | null
  toolName: string
  summary: string
  requestSha256: string
  status: PermissionDecisionStatus
  decidedBy: (typeof PERMISSION_DECISION_DECIDERS)[number] | null
  createdAt: string
  deadlineAt: string
  decidedAt: string | null
}

export type PermissionAnswerResult =
  | { outcome: 'decided'; record: PermissionDecisionRecord }
  | { outcome: 'already_decided'; record: PermissionDecisionRecord }
  | { outcome: 'not_found' }

export const PERMISSION_DECISION_COLUMNS = `decision_id, run_id, owner_id, agent_id, tool_name, summary, request_sha256, status,
  decided_by, created_at, deadline_at, decided_at`

export function toPermissionDecisionRecord(row: unknown): PermissionDecisionRecord {
  const stored = parseStoredRow(RowSchema, row, 'permission decision')
  return {
    decisionId: stored.decision_id,
    runId: stored.run_id,
    ownerId: stored.owner_id,
    agentId: stored.agent_id,
    toolName: stored.tool_name,
    summary: stored.summary,
    requestSha256: stored.request_sha256,
    status: stored.status,
    decidedBy: stored.decided_by,
    createdAt: stored.created_at,
    deadlineAt: stored.deadline_at,
    decidedAt: stored.decided_at
  }
}
