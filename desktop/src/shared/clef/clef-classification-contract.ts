import { z } from 'zod'
import { ROUTING_TASK_TYPES } from '../routing-table/routing-table-taxonomy'
import {
  ClefOptionKeySchema,
  ClefProbabilitiesSchema,
  ClefProbabilitySchema,
  ClefProviderConfidenceSchema,
  clefKeyedRecord
} from './clef-answers'

/** `classified` replaces the retired `routed`: Clef places a TaskSpec, it never picks a route. */
export const CLASSIFICATION_OUTCOMES = [
  'classified',
  'blocked',
  'invalid_output',
  'discarded_after_cancel'
] as const
export const ClassificationOutcomeSchema = z.enum(CLASSIFICATION_OUTCOMES)
export type ClassificationOutcome = z.infer<typeof ClassificationOutcomeSchema>

const MAX_RECORDED_QUESTIONS = 64

/** All Clef decides for one TaskSpec (D-016); no target, model or effort ever appears here. */
export const ClassificationResultSchema = z
  .object({ needsDelegation: z.boolean(), taskType: z.enum(ROUTING_TASK_TYPES) })
  .strict()
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>

/** Answer columns of a classification record; all null when Clef did not answer. */
export const RecordedClassificationAnswersSchema = z
  .object({
    /** The wire option Clef chose, kept even when it is `needs_clarification`. */
    taskType: ClefOptionKeySchema.nullable(),
    /** The probability that the TaskSpec needs a separate executor. */
    needsDelegation: ClefProbabilitySchema.nullable(),
    /** Verbatim probabilities keyed by question ID. */
    probabilities: clefKeyedRecord(ClefProbabilitiesSchema)
      .refine((byQuestion) => Object.keys(byQuestion).length <= MAX_RECORDED_QUESTIONS)
      .nullable(),
    providerConfidence: z
      .object({ status: z.literal('not_used'), values: ClefProviderConfidenceSchema })
      .strict()
      .nullable()
  })
  .strict()
export const RECORDED_CLASSIFICATION_ANSWER_KEYS =
  RecordedClassificationAnswersSchema.keyof().options

export type RecordedClassificationAnswers = z.infer<typeof RecordedClassificationAnswersSchema>
