import { z } from 'zod'
import { isEnglishText } from '../../../shared/english-text'
import type { CheckStatus } from './validation-context'
import { recordLine } from './validation-record-text'

export const REVIEW_REASON_MAX_CHARS = 300
export const REVIEW_SUMMARY_MAX_CHARS = 500
/** A reviewer reply longer than this is not parsed. */
const REVIEW_OUTPUT_MAX_CHARS = 64 * 1024
const FENCED = /^```(?:json)?\r?\n([\s\S]*)\r?\n```$/

const EnglishLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => !/\p{Cc}/u.test(text) && text.trim() === text && isEnglishText(text))

const CriterionSchema = z
  .object({
    index: z.number().int().min(1),
    /** Null when the evidence does not let the reviewer judge the criterion. */
    met: z.boolean().nullable(),
    reason: EnglishLine(REVIEW_REASON_MAX_CHARS)
  })
  .strict()

const ReviewSchema = z
  .object({
    verdict: z.enum(['pass', 'fail', 'inconclusive']),
    criteria: z.array(CriterionSchema),
    summary: EnglishLine(REVIEW_SUMMARY_MAX_CHARS)
  })
  .strict()
export type ReviewVerdict = z.infer<typeof ReviewSchema>

export type ParsedReview =
  | { readonly ok: true; readonly review: ReviewVerdict }
  | { readonly ok: false; readonly problem: string }

/** The same shape for Codex's --output-schema; the runner re-validates against it, and so does parseReviewOutput. */
export const REVIEW_OUTPUT_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'criteria', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'met', 'reason'],
        properties: {
          index: { type: 'integer' },
          met: { type: ['boolean', 'null'] },
          reason: { type: 'string' }
        }
      }
    },
    summary: { type: 'string' }
  }
}

function consistencyProblem(review: ReviewVerdict, criteriaCount: number): string | null {
  if (review.criteria.length !== criteriaCount) {
    return 'The review does not answer every acceptance criterion exactly once.'
  }
  if (review.criteria.some((criterion, index) => criterion.index !== index + 1)) {
    return 'The review answers the criteria out of order.'
  }
  const unmet = review.criteria.some((criterion) => criterion.met === false)
  const allMet = review.criteria.every((criterion) => criterion.met === true)
  if (review.verdict === 'pass' && !allMet) {
    return 'The review passes work whose criteria it does not all find met.'
  }
  if (review.verdict === 'fail' && !unmet && criteriaCount > 0) {
    return 'The review fails work without naming an unmet criterion.'
  }
  if (review.verdict === 'inconclusive' && unmet) {
    return 'The review names an unmet criterion but does not fail the work.'
  }
  return null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The reviewer's reply in the one accepted shape; anything else makes the validation inconclusive. */
export function parseReviewOutput(text: string, criteriaCount: number): ParsedReview {
  if (text.length > REVIEW_OUTPUT_MAX_CHARS) {
    return { ok: false, problem: 'The review is too long.' }
  }
  const trimmed = text.trim()
  const body = FENCED.exec(trimmed)?.[1] ?? trimmed
  const parsed = ReviewSchema.safeParse(parseJson(body))
  if (!parsed.success) {
    return { ok: false, problem: 'The review is not in the required JSON shape.' }
  }
  const problem = consistencyProblem(parsed.data, criteriaCount)
  return problem ? { ok: false, problem } : { ok: true, review: parsed.data }
}

export type ReviewCheck = {
  readonly kind: string
  readonly status: CheckStatus
  readonly note: string
}

function criterionStatus(met: boolean | null): CheckStatus {
  return met === null ? 'inconclusive' : met ? 'pass' : 'fail'
}

/** One overall check for the review, then one per acceptance criterion, each an English line. */
export function reviewChecks(review: ReviewVerdict): ReviewCheck[] {
  return [
    {
      kind: 'model_review',
      status: review.verdict,
      note: recordLine(review.summary, { fallback: 'The reviewer gave a summary.' })
    },
    ...review.criteria.map((criterion) => ({
      kind: 'review_criterion',
      status: criterionStatus(criterion.met),
      note: recordLine(`Criterion ${criterion.index}: ${criterion.reason}`, {
        fallback: `Criterion ${criterion.index} was judged.`
      })
    }))
  ]
}
