import { z } from 'zod'
import { WORKBENCH_LIST_DEFAULT_LIMIT, WORKBENCH_LIST_MAX_LIMIT } from '../workbench-request'
import { DotRequestIdSchema } from './dot-ingress-params'
import { DOT_INGRESS_CONTRACT_VERSION_THREE } from './dot-ingress-versions'

// Contract version 3 (G7): the inconclusive validations of runs dot started, which dot may waive or
// reject. A narrow exception to U32 chosen by the user ("Title, reason, summary"): a view carries
// these fields and nothing else; never a path, worktree, branch, base commit, model, route, effort,
// artifact, deliverable content or progress. Title and summary are masked on the desktop before they
// leave main, and a summary the content scan still flags is withheld.

export const DOT_VALIDATION_TITLE_MAX_CHARS = 200
export const DOT_VALIDATION_SUMMARY_MAX_CHARS = 500

/** Why the validation could not decide, as a fixed code; an unmapped internal reason is `other`. */
export const DOT_VALIDATION_REASONS = [
  // Only the executor's claim: no check showed that the work was done.
  'claim_only',
  // The primary session did the task itself, so its own report is not enough (D-027).
  'primary_did_task',
  // The primary filed no matching task report for an in-session attempt.
  'report_missing',
  // No independent reviewer could run, or the review was cut off.
  'review_unavailable',
  // The reviewer ran but could not decide.
  'review_inconclusive',
  // A machine check could not decide.
  'checks_inconclusive',
  'other'
] as const
export type DotValidationReason = (typeof DOT_VALIDATION_REASONS)[number]

export const DOT_VALIDATION_DECISIONS = ['waive', 'reject'] as const
/** `already_decided`: the desktop or another dot decision won first; `closed`: nothing waits any more. */
export const DOT_VALIDATION_DECIDE_OUTCOMES = ['decided', 'already_decided', 'closed'] as const
/** How a pending decision ended, as the remote events report it. */
export const DOT_VALIDATION_SETTLED_OUTCOMES = ['waived', 'rejected', 'closed'] as const

const Version = z.literal(DOT_INGRESS_CONTRACT_VERSION_THREE)
const TimestampSchema = z.iso.datetime({ offset: true })

/** Opaque: the desktop's validation id, which holds no path or name. */
export const DotValidationIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)

// Why a code-point pattern: JSON Schema consumers count code points; controls, bidi and format
// characters, and line or paragraph separators never reach dot (the desktop neutralised them).
function dotLine(maxChars: number, description: string) {
  return z
    .string()
    .max(maxChars * 2)
    .regex(new RegExp(`^[^\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]{1,${maxChars}}$`, 'u'))
    .describe(description)
}

export const DotValidationViewSchema = z
  .object({
    validationId: DotValidationIdSchema,
    dotRequestId: DotRequestIdSchema,
    title: dotLine(
      DOT_VALIDATION_TITLE_MAX_CHARS,
      'The task title or the first line of its objective, masked'
    ),
    reason: z.enum(DOT_VALIDATION_REASONS),
    summary: dotLine(
      DOT_VALIDATION_SUMMARY_MAX_CHARS,
      "The primary's task report, the reviewer's reason or the check's reason line, masked"
    ).nullable(),
    /** True when the content scan still flagged the masked summary, so it was not sent. */
    summaryWithheld: z.boolean(),
    /** When the result became inconclusive and started waiting for a decision. */
    createdAt: TimestampSchema
  })
  .strict()
  .refine((view) => !view.summaryWithheld || view.summary === null, {
    message: 'A withheld summary is null',
    path: ['summary']
  })

const limitField = z
  .number()
  .int()
  .min(1)
  .max(WORKBENCH_LIST_MAX_LIMIT)
  .default(WORKBENCH_LIST_DEFAULT_LIMIT)

/** Waiting decisions of the runs dot started, oldest first, optionally for one request of dot. */
export const DotValidationsListParamsV3 = z
  .object({
    contractVersion: Version,
    dotRequestId: DotRequestIdSchema.optional(),
    limit: limitField
  })
  .strict()

export const DotValidationsListResultV3Schema = z
  .object({
    contractVersion: Version,
    validations: z.array(DotValidationViewSchema).max(WORKBENCH_LIST_MAX_LIMIT),
    /** More decisions wait than this page shows. */
    hasMore: z.boolean()
  })
  .strict()

/** decisionId is dot's idempotency key: a replay returns the first outcome. No reason text, no decider. */
export const DotValidationDecideParamsV3 = z
  .object({
    contractVersion: Version,
    decisionId: z.uuid(),
    validationId: DotValidationIdSchema,
    decision: z.enum(DOT_VALIDATION_DECISIONS)
  })
  .strict()

export const DotValidationDecideResultV3Schema = z
  .object({
    contractVersion: Version,
    decisionId: z.uuid(),
    validationId: DotValidationIdSchema,
    dotRequestId: DotRequestIdSchema,
    outcome: z.enum(DOT_VALIDATION_DECIDE_OUTCOMES),
    /** When the winning decision was made; null when the decision closed without one. */
    decidedAt: TimestampSchema.nullable(),
    /** True when this decisionId was answered before and this is its first outcome again. */
    duplicate: z.boolean()
  })
  .strict()
  .refine((result) => (result.outcome === 'closed') === (result.decidedAt === null), {
    message: 'Only a closed decision has no decision time',
    path: ['decidedAt']
  })

/** A decision that stopped waiting: waived or rejected (by the desktop or dot), or closed without one. */
export const DotValidationSettledSchema = z
  .object({
    validationId: DotValidationIdSchema,
    outcome: z.enum(DOT_VALIDATION_SETTLED_OUTCOMES),
    decidedAt: TimestampSchema.nullable()
  })
  .strict()
  .refine((settled) => (settled.outcome === 'closed') === (settled.decidedAt === null), {
    message: 'Only a closed decision has no decision time',
    path: ['decidedAt']
  })

export type DotValidationView = z.infer<typeof DotValidationViewSchema>
export type DotValidationDecision = (typeof DOT_VALIDATION_DECISIONS)[number]
export type DotValidationDecideOutcome = (typeof DOT_VALIDATION_DECIDE_OUTCOMES)[number]
export type DotValidationSettled = z.infer<typeof DotValidationSettledSchema>
export type DotValidationsListInput = z.infer<typeof DotValidationsListParamsV3>
export type DotValidationDecideInput = z.infer<typeof DotValidationDecideParamsV3>
export type DotValidationsListResultV3 = z.infer<typeof DotValidationsListResultV3Schema>
export type DotValidationDecideResultV3 = z.infer<typeof DotValidationDecideResultV3Schema>
