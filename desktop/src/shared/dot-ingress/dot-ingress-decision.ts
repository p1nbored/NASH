import { z } from 'zod'
import { WORKBENCH_LIST_MAX_LIMIT } from '../workbench-request'
import { DOT_DECISION_SUMMARY_MAX_CHARS, DOT_INGRESS_CONTRACT_VERSION } from './dot-ingress-limits'
import { DotDecisionIdSchema, DotRequestIdSchema } from './dot-ingress-params'

// D-017: dot sees tool, command and file names with secrets masked, never file contents. The summary
// is the only text field of a decision view, and no objective of any request appears here.

const ContractVersionSchema = z.literal(DOT_INGRESS_CONTRACT_VERSION)
const TimestampSchema = z.iso.datetime({ offset: true })

export const DOT_DECISION_STATUSES = [
  'pending',
  'allowed',
  'denied',
  'answered_in_terminal',
  'expired'
] as const
export const DOT_DECISION_DECIDERS = ['dot', 'desktop', 'terminal'] as const

// Why: a summary is one short line of names; a UTF-16 length over twice the cap cannot hold 500 code points.
const SUMMARY_MAX_UTF16_UNITS = DOT_DECISION_SUMMARY_MAX_CHARS * 2
const CONTROL_OR_LINE_SEPARATOR = /[\p{Cc}\p{Zl}\p{Zp}]/u

const DecisionSummarySchema = z.string().refine((summary) => {
  const codePoints = summary.length <= SUMMARY_MAX_UTF16_UNITS ? Array.from(summary).length : 0
  return (
    codePoints >= 1 &&
    codePoints <= DOT_DECISION_SUMMARY_MAX_CHARS &&
    !CONTROL_OR_LINE_SEPARATOR.test(summary)
  )
}, `Summary must be one line of 1 to ${DOT_DECISION_SUMMARY_MAX_CHARS} characters`)

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)

/** Mirrors the stored decision rules: who may have decided depends on the status. */
function isConsistentDecision(view: {
  status: (typeof DOT_DECISION_STATUSES)[number]
  decidedBy: (typeof DOT_DECISION_DECIDERS)[number] | null
  decidedAt: string | null
}): boolean {
  switch (view.status) {
    case 'pending':
      return view.decidedBy === null && view.decidedAt === null
    case 'allowed':
    case 'denied':
      return (view.decidedBy === 'dot' || view.decidedBy === 'desktop') && view.decidedAt !== null
    case 'answered_in_terminal':
      return view.decidedBy === 'terminal' && view.decidedAt !== null
    case 'expired':
      return view.decidedBy === null && view.decidedAt !== null
  }
}

/** Always tied to a request of the dot: a prompt of a run the dot did not start is never shown to it. */
export const DotDecisionViewSchema = z
  .object({
    decisionId: DotDecisionIdSchema,
    dotRequestId: DotRequestIdSchema,
    toolName: IdentifierSchema,
    agentId: IdentifierSchema.nullable(),
    summary: DecisionSummarySchema,
    status: z.enum(DOT_DECISION_STATUSES),
    decidedBy: z.enum(DOT_DECISION_DECIDERS).nullable(),
    createdAt: TimestampSchema,
    deadlineAt: TimestampSchema,
    decidedAt: TimestampSchema.nullable()
  })
  .strict()
  .refine(isConsistentDecision, {
    message: 'Decision status and decider disagree',
    path: ['status']
  })

export const DotDecisionsListResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    decisions: z.array(DotDecisionViewSchema).max(WORKBENCH_LIST_MAX_LIMIT)
  })
  .strict()

/** `already_decided` is a normal outcome: the first answer won and this view shows it. */
export const DotDecisionAnswerResultSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    outcome: z.enum(['decided', 'already_decided']),
    decision: DotDecisionViewSchema
  })
  .strict()

export type DotDecisionView = z.infer<typeof DotDecisionViewSchema>
export type DotDecisionsListResult = z.infer<typeof DotDecisionsListResultSchema>
export type DotDecisionAnswerResult = z.infer<typeof DotDecisionAnswerResultSchema>
