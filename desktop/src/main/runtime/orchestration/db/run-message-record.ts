import { z } from 'zod'
import {
  RUN_MESSAGE_OUTCOMES,
  RUN_MESSAGE_SOURCES,
  RUN_MESSAGE_STATES,
  RUN_MESSAGE_TEXT_MAX_CHARS
} from './autopilot-message-schema-definition'
import {
  AutopilotIdSchema,
  ReasonCodeSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
  parseStoredRow
} from './autopilot-store-input'

export type RunMessageSource = (typeof RUN_MESSAGE_SOURCES)[number]
export type RunMessageState = (typeof RUN_MESSAGE_STATES)[number]
export type RunMessageOutcome = (typeof RUN_MESSAGE_OUTCOMES)[number]

export type RunMessageRecord = {
  sequence: number
  messageId: string
  runId: string
  source: RunMessageSource
  sourceRequestId: string
  /** Null only for a refusal whose text failed the content checks: such text is never stored. */
  text: string | null
  textSha256: string
  state: RunMessageState
  /** The first answer the sender got; null while the first delivery attempt is in flight. */
  outcome: RunMessageOutcome | null
  reason: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
}

const MessageTextSchema = z
  .string()
  .min(1)
  .refine((text) => Array.from(text).length <= RUN_MESSAGE_TEXT_MAX_CHARS)

const BaseInputSchema = z.object({
  runId: AutopilotIdSchema,
  source: z.enum(RUN_MESSAGE_SOURCES),
  sourceRequestId: AutopilotIdSchema,
  textSha256: Sha256HexSchema,
  timestamp: UtcTimestampSchema
})

export const RunMessageReceivedSchema = BaseInputSchema.extend({ text: MessageTextSchema }).strict()
export type RunMessageReceived = z.infer<typeof RunMessageReceivedSchema>

export const RunMessageHeldSchema = BaseInputSchema.extend({
  text: MessageTextSchema,
  reason: ReasonCodeSchema
}).strict()
export type RunMessageHeld = z.infer<typeof RunMessageHeldSchema>

export const RunMessageRefusedSchema = BaseInputSchema.extend({
  text: MessageTextSchema.nullable(),
  reason: ReasonCodeSchema
}).strict()
export type RunMessageRefused = z.infer<typeof RunMessageRefusedSchema>

export const RunMessageSettleSchema = z
  .object({
    to: z.enum(['held', 'delivered', 'refused']),
    /** Used only when no answer was given yet, so a replay keeps reporting the first one. */
    firstOutcome: z.enum(RUN_MESSAGE_OUTCOMES),
    reason: ReasonCodeSchema.nullable(),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type RunMessageSettle = z.infer<typeof RunMessageSettleSchema>

/** Which states each settle target may leave; delivered and refused are final. */
export const RUN_MESSAGE_SETTLE_FROM: Readonly<
  Record<RunMessageSettle['to'], readonly RunMessageState[]>
> = Object.freeze({
  held: Object.freeze(['received'] as const),
  delivered: Object.freeze(['received', 'held'] as const),
  refused: Object.freeze(['received', 'held'] as const)
})

const RowSchema = z.object({
  sequence: z.number(),
  message_id: z.string(),
  run_id: z.string(),
  source: z.enum(RUN_MESSAGE_SOURCES),
  source_request_id: z.string(),
  text: z.string().nullable(),
  text_sha256: z.string(),
  state: z.enum(RUN_MESSAGE_STATES),
  outcome: z.enum(RUN_MESSAGE_OUTCOMES).nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  delivered_at: z.string().nullable()
})

export const RUN_MESSAGE_COLUMNS = `sequence, message_id, run_id, source, source_request_id, text,
  text_sha256, state, outcome, reason, created_at, updated_at, delivered_at`

export function toRunMessageRecord(row: unknown): RunMessageRecord {
  const stored = parseStoredRow(RowSchema, row, 'run message')
  return {
    sequence: stored.sequence,
    messageId: stored.message_id,
    runId: stored.run_id,
    source: stored.source,
    sourceRequestId: stored.source_request_id,
    text: stored.text,
    textSha256: stored.text_sha256,
    state: stored.state,
    outcome: stored.outcome,
    reason: stored.reason,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
    deliveredAt: stored.delivered_at
  }
}
