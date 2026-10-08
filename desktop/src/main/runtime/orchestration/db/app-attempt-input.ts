import { z } from 'zod'
import type { MessageRow } from '../types'
import type { DispatchCreator } from './dispatch-depth'
import { AttemptExecutorSchema } from './app-attempt-route-guard'
import { hasNoControlCharacters } from './autopilot-json-column'
import { AutopilotIdSchema, ReasonCodeSchema, UtcTimestampSchema } from './autopilot-store-input'

export const ATTEMPT_NOTICE_BODY_MAX_CHARS = 2000
export const ATTEMPT_RESULT_MAX_CHARS = 1000

/** English text for the primary's mailbox. */
export const AttemptNoticeSchema = z
  .object({
    subject: z
      .string()
      .min(1)
      .max(200)
      .refine((text) => !/\p{Cc}/u.test(text)),
    body: z
      .string()
      .min(1)
      .max(ATTEMPT_NOTICE_BODY_MAX_CHARS)
      .refine(hasNoControlCharacters)
      .optional()
  })
  .strict()
export type AttemptNotice = z.infer<typeof AttemptNoticeSchema>

/** One line the task's `result` holds; the reasons and checks behind it live in the side tables. */
export const AttemptResultSchema = z
  .string()
  .min(1)
  .max(ATTEMPT_RESULT_MAX_CHARS)
  .refine((text) => !/\p{Cc}/u.test(text))

const CreatorSchema = z.custom<DispatchCreator>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'system' || value.kind === 'terminal' || value.kind === 'session'),
  { message: 'a Dispatch creator is required' }
)
const ReceiptText = z.string().min(1).max(256)
const MutationReceiptSchema = z
  .object({
    callerFingerprint: ReceiptText,
    requestId: ReceiptText,
    method: ReceiptText,
    payloadHash: ReceiptText
  })
  .strict()

export const AppAttemptStartInputSchema = z
  .object({
    taskId: AutopilotIdSchema,
    routeId: AutopilotIdSchema,
    executor: AttemptExecutorSchema,
    retryOf: AutopilotIdSchema.optional(),
    creator: CreatorSchema,
    maxDepth: z.number().int().positive(),
    runtimeEpoch: ReceiptText.optional(),
    mutationReceipt: MutationReceiptSchema.optional(),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type AppAttemptStartInput = z.input<typeof AppAttemptStartInputSchema>

const notice = AttemptNoticeSchema.optional()

export const MarkRunningInputSchema = z
  .object({
    dispatchId: AutopilotIdSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
export type MarkRunningInput = z.input<typeof MarkRunningInputSchema>

export const MarkStartOutcomeInputSchema = z
  .object({
    dispatchId: AutopilotIdSchema,
    reason: ReasonCodeSchema,
    timestamp: UtcTimestampSchema,
    notice
  })
  .strict()
export type MarkStartOutcomeInput = z.input<typeof MarkStartOutcomeInputSchema>

export const SettleClaimInputSchema = z
  .object({
    dispatchId: AutopilotIdSchema,
    timestamp: UtcTimestampSchema,
    notice
  })
  .strict()
export type SettleClaimInput = z.input<typeof SettleClaimInputSchema>

export const SettleFailureInputSchema = z
  .object({
    dispatchId: AutopilotIdSchema,
    outcome: z.literal('failed'),
    reason: ReasonCodeSchema,
    timestamp: UtcTimestampSchema,
    notice
  })
  .strict()
export type SettleFailureInput = z.input<typeof SettleFailureInputSchema>

/** What every settlement returns: Orca's rows as they stand after it. */
export type AppAttemptView = {
  dispatchId: string
  taskId: string
  taskStatus: string
  dispatchStatus: string
  workerState: string
  workerStage: string
  /** The mailbox message filed with the change, for the caller to announce; null when none was asked for. */
  notice: MessageRow | null
}
