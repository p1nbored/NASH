import { z } from 'zod'

export const CLEF_QUESTION_KINDS = ['choice', 'noul'] as const
export type ClefQuestionKind = (typeof CLEF_QUESTION_KINDS)[number]

/** Classifier question IDs in pinned send order (bundle question_set_version 2). */
export const CLEF_CLASSIFIER_QUESTION_IDS = ['task_type', 'needs_delegation'] as const
export type ClefClassifierQuestionId = (typeof CLEF_CLASSIFIER_QUESTION_IDS)[number]

export const CLEF_CLASSIFIER_QUESTION_KINDS: Readonly<
  Record<ClefClassifierQuestionId, ClefQuestionKind>
> = Object.freeze({
  task_type: 'choice',
  needs_delegation: 'noul'
})

/** Extra option on task_type; choosing it blocks as missing_inputs. */
export const NEEDS_CLARIFICATION_OPTION_ID = 'needs_clarification'

/** Documented Clef question-ID charset; wire option IDs share it. */
export const CLEF_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/

const CLEF_MAX_CHOICE_OPTIONS = 255

/** A finite value in [0, 1] (zod 4 numbers already reject NaN and infinities). */
export const ClefProbabilitySchema = z.number().min(0).max(1)

export const ClefOptionKeySchema = z.string().regex(CLEF_IDENTIFIER_PATTERN)

function hasNoProtoKey(value: unknown): boolean {
  return typeof value !== 'object' || value === null || !Object.hasOwn(value, '__proto__')
}

/** Record keyed by Clef identifiers. */
export function clefKeyedRecord<T extends z.ZodType>(valueSchema: T) {
  return (
    z
      .unknown()
      // Why: zod records skip an own `__proto__` key silently, which would hide an extra option.
      .refine(hasNoProtoKey, 'Reserved key')
      .pipe(z.record(ClefOptionKeySchema, valueSchema))
  )
}

export const ClefProbabilitiesSchema = clefKeyedRecord(ClefProbabilitySchema).refine(
  (probabilities) => {
    const count = Object.keys(probabilities).length
    return count >= 1 && count <= CLEF_MAX_CHOICE_OPTIONS
  },
  'Probabilities need 1-255 options'
)

export const ClefTokenCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const ClefUsageSchema = z
  .object({ inputTokens: ClefTokenCountSchema, outputTokens: ClefTokenCountSchema })
  .strict()

/** Model identifiers such as `@cf/cloudflare/clef`: visible ASCII only. */
export const ClefModelLabelSchema = z.string().regex(/^[\x21-\x7E]{1,200}$/)

export const ClefChoiceAnswerSchema = z
  .object({ choice: ClefOptionKeySchema, probabilities: ClefProbabilitiesSchema })
  .strict()
  .refine(
    (answer) => Object.hasOwn(answer.probabilities, answer.choice),
    'Choice must be one of the probability keys'
  )

export const ClefNoulAnswerSchema = z.object({ value: ClefProbabilitySchema }).strict()

/** Stored for audit, never used to decide (R39). */
export const ClefProviderConfidenceSchema = clefKeyedRecord(ClefProbabilitySchema.nullable())

/** The classifier answer set after response validation; argmax and key coverage are the validator's checks. */
export const ValidatedClefAnswersSchema = z
  .object({
    taskType: ClefChoiceAnswerSchema,
    needsDelegation: ClefNoulAnswerSchema,
    providerConfidence: ClefProviderConfidenceSchema,
    responseModel: ClefModelLabelSchema,
    usage: ClefUsageSchema
  })
  .strict()

export type ClefProbabilities = z.infer<typeof ClefProbabilitiesSchema>
export type ClefUsage = z.infer<typeof ClefUsageSchema>
export type ClefChoiceAnswer = z.infer<typeof ClefChoiceAnswerSchema>
export type ClefNoulAnswer = z.infer<typeof ClefNoulAnswerSchema>
export type ValidatedClefAnswers = z.infer<typeof ValidatedClefAnswersSchema>
