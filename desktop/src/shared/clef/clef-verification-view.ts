import { z } from 'zod'
import { CLEF_IDENTIFIER_PATTERN } from './clef-answers'
import { RouteBlockerSchema, RoutingStatusSchema } from './clef-route-contract'

/**
 * Renderer-safe results of the opt-in Clef verification (spec section 14): the redacted report,
 * the verify result and the pin result. The report carries only our own question ids, counts,
 * numbers, short field names and a strictly shaped model name; every object is strict, so a field
 * the contract does not name (a body, a URL, a token) fails the parse instead of reaching the UI.
 */

/** Everything that stops a report from being pinned; the order is the profile check's order. */
export const CLEF_PROFILE_PROBLEMS = [
  'http_status',
  'envelope_unrecognized',
  'envelope_not_successful',
  'response_model_unobserved',
  'response_model_disallowed',
  'answer_keys_mismatch',
  'option_ids_not_echoed',
  'probability_out_of_range',
  'probability_sum_out_of_tolerance',
  'usage_missing',
  'pin_invalid'
] as const
export type ClefProfileProblem = (typeof CLEF_PROFILE_PROBLEMS)[number]

const CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/)
const NumberSchema = z.number().finite()
// Why letters only: the same short-key rule the report applies, so no id or token can pass as a key.
const FieldNameSchema = z.string().regex(/^[A-Za-z_]{1,31}$/)
const FieldNamesSchema = z.array(FieldNameSchema).max(32)
const QuestionIdSchema = z.string().regex(CLEF_IDENTIFIER_PATTERN)
const MAX_QUESTIONS = 64
// Why: the only server string a report copies; a model path or a documented short name in bounded lower case.
const ModelNameSchema = z
  .string()
  .regex(/^(?:@cf\/[a-z][a-z0-9-]{0,39}\/[a-z][a-z0-9.-]{0,59}|clef|clef-flash)$/)

const KeyCoverageSchema = z
  .object({
    expected: CountSchema,
    observed: CountSchema,
    missing: CountSchema,
    extra: CountSchema
  })
  .strict()

const QuestionReportSchema = z
  .object({
    id: QuestionIdSchema,
    kind: z.enum(['choice', 'noul']),
    present: z.boolean(),
    answerFieldNames: FieldNamesSchema,
    keyCoverage: KeyCoverageSchema.nullable(),
    probabilitySum: NumberSchema.nullable(),
    sumDeviation: NumberSchema.nullable(),
    maxFractionDigits: CountSchema.nullable(),
    valuesInRange: z.boolean().nullable()
  })
  .strict()

const EnvelopeSchema = z
  .object({
    shape: z.enum(['cf_result_wrapper', 'bare', 'unrecognized']),
    success: z.boolean().nullable(),
    errorCount: CountSchema.nullable(),
    messageCount: CountSchema.nullable(),
    topLevelKeys: FieldNamesSchema,
    bodyKeys: FieldNamesSchema,
    withheldKeyCount: CountSchema
  })
  .strict()

export const ClefVerificationReportViewSchema = z
  .object({
    reportVersion: z.literal(2),
    httpStatus: z.number().int().min(100).max(599),
    rawSha256: Sha256HexSchema,
    rawByteLength: CountSchema,
    bodyKind: z.enum(['json_object', 'json_other', 'not_json']),
    envelope: EnvelopeSchema,
    model: z.object({ observed: ModelNameSchema.nullable(), withheld: z.boolean() }).strict(),
    answerKeys: z
      .object({
        matchQuestionIds: z.boolean(),
        missing: z.array(QuestionIdSchema).max(MAX_QUESTIONS),
        extraCount: CountSchema
      })
      .strict(),
    optionIdEcho: z.enum(['exact', 'altered', 'missing']),
    questions: z.array(QuestionReportSchema).max(MAX_QUESTIONS),
    maxSumDeviation: NumberSchema.nullable(),
    usage: z
      .object({
        inputTokens: CountSchema.nullable(),
        outputTokens: CountSchema.nullable(),
        estimatedInputTokens: CountSchema,
        inputToEstimateRatio: NumberSchema.nullable()
      })
      .strict()
  })
  .strict()
export type ClefVerificationReportView = z.infer<typeof ClefVerificationReportViewSchema>

const PinVerdictSchema = z
  .object({ pinnable: z.boolean(), problems: z.array(z.enum(CLEF_PROFILE_PROBLEMS)).max(32) })
  .strict()
  .refine((verdict) => verdict.pinnable === (verdict.problems.length === 0), {
    message: 'A report is pinnable exactly when it has no problems'
  })

const ReportedVerifySchema = z
  .object({
    outcome: z.literal('reported'),
    report: ClefVerificationReportViewSchema,
    /** Canonical hash of the full report; the pin call must send it back unchanged. */
    reportSha256: Sha256HexSchema,
    pin: PinVerdictSchema
  })
  .strict()

const FailedVerifySchema = z
  .object({
    outcome: z.literal('call_failed'),
    blocker: RouteBlockerSchema,
    httpStatus: z.number().int().min(100).max(599).nullable(),
    attempts: CountSchema
  })
  .strict()

export const ClefVerifyResultSchema = z.discriminatedUnion('outcome', [
  ReportedVerifySchema,
  FailedVerifySchema
])
export type ClefVerifyResult = z.infer<typeof ClefVerifyResultSchema>

export const ClefProfilePinResultSchema = z
  .object({
    pinned: z.literal(true),
    /** Hash of the pinned profile, which every later routing decision records. */
    profileHash: Sha256HexSchema,
    verifiedAt: z.iso.datetime({ offset: true }),
    routingStatus: RoutingStatusSchema
  })
  .strict()
export type ClefProfilePinResult = z.infer<typeof ClefProfilePinResultSchema>

/** Null for anything that is not exactly a report, so the renderer never trusts a widened payload. */
export function parseClefVerificationReportView(value: unknown): ClefVerificationReportView | null {
  const parsed = ClefVerificationReportViewSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseClefVerifyResult(value: unknown): ClefVerifyResult | null {
  const parsed = ClefVerifyResultSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseClefProfilePinResult(value: unknown): ClefProfilePinResult | null {
  const parsed = ClefProfilePinResultSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
