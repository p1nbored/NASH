import { z } from 'zod'
import { DotRequestIdSchema } from './dot-ingress-params'
import { DOT_INGRESS_CONTRACT_VERSION_TWO } from './dot-ingress-versions'

// D-019: a follow-up message to the run a dot request started. It is addressed by the dot request id,
// never by a run id, and the app applies the same checks as a new task before typing it into the
// run's Claude Code terminal. The text never comes back to dot.

/** The dot v2 bound in code points; the run message store holds more since D-027 (pinned remote manifest). */
export const DOT_MESSAGE_TEXT_MAX_CHARS = 4_000
// Why twice: the app counts code points, and one code point is at most two UTF-16 units.
const TEXT_MAX_UTF16_UNITS = DOT_MESSAGE_TEXT_MAX_CHARS * 2

export const DOT_MESSAGE_OUTCOMES = ['delivered', 'queued', 'refused'] as const
export type DotMessageOutcome = (typeof DOT_MESSAGE_OUTCOMES)[number]

/** Coarse codes only; `other` stands for any delivery reason this contract does not name. */
export const DOT_MESSAGE_REASONS = [
  'agent_busy',
  'dialog_open',
  'behind_held_message',
  'run_not_started',
  'run_not_active',
  'primary_not_live',
  'text_empty',
  'text_too_long',
  'control_characters',
  'secret_shaped',
  'too_many_quoted_spans',
  'not_english',
  'hold_capacity_exceeded',
  'hold_expired',
  'terminal_unavailable',
  'delivery_incomplete',
  'delivery_unconfirmed',
  'other'
] as const
export type DotMessageReason = (typeof DOT_MESSAGE_REASONS)[number]

const ContractVersionSchema = z.literal(DOT_INGRESS_CONTRACT_VERSION_TWO)

/** The message id is the dot's idempotency key: a replay returns the first outcome. */
export const DotMessageParams = z
  .object({
    contractVersion: ContractVersionSchema,
    dotRequestId: DotRequestIdSchema,
    messageId: z.uuid(),
    text: z.string().min(1).max(TEXT_MAX_UTF16_UNITS)
  })
  .strict()

export const DotMessageResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    dotRequestId: DotRequestIdSchema,
    messageId: z.uuid(),
    outcome: z.enum(DOT_MESSAGE_OUTCOMES),
    reason: z.enum(DOT_MESSAGE_REASONS).nullable(),
    duplicate: z.boolean()
  })
  .strict()
  .refine((result) => result.outcome !== 'refused' || result.reason !== null, {
    message: 'A refused message names its reason',
    path: ['reason']
  })

export type DotMessageInput = z.infer<typeof DotMessageParams>
export type DotMessageResult = z.infer<typeof DotMessageResultSchema>
