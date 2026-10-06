// FIXTURE_ONLY: synthetic Clef responses for offline tests; production code never imports this.
// Shape derived from Cloudflare's published Workers AI Clef schema-output.json (Cloudflare
// documentation, CC-BY-4.0, https://creativecommons.org/licenses/by/4.0/).
// Changes: every value is invented and no live response was observed (no official example exists).

import type { ClefClassifierQuestionId } from '../../../shared/clef/clef-answers'
import type { ClefChoiceQuestion, ClefClassifierQuestions } from '../clef-question-set'

/** Invented pin for tests; the real value is pinned only after live verification. */
export const FIXTURE_ONLY_RESPONSE_MODEL = '@cf/cloudflare/clef'
export const FIXTURE_ONLY_INPUT_TOKENS = 640
export const FIXTURE_ONLY_OUTPUT_TOKENS = 48

const CHOSEN_PROBABILITY = 0.7

export type SyntheticClefBody = {
  readonly model: string
  readonly answers: Readonly<Record<ClefClassifierQuestionId, Record<string, unknown>>>
  readonly usage: Readonly<Record<string, number>>
}

/** The task type Clef chooses and the probability it gives to needing a separate executor. */
export type SyntheticAnswerValues = {
  readonly task_type: string
  readonly needs_delegation: number
}

export const DEFAULT_SYNTHETIC_ANSWERS: SyntheticAnswerValues = {
  task_type: 'software_engineering',
  needs_delegation: 0.82
}

export function syntheticChoiceAnswer(
  question: ClefChoiceQuestion,
  choice: string
): Record<string, unknown> {
  const optionIds = Object.keys(question.criteria)
  const others = optionIds.filter((id) => id !== choice)
  const otherShare = (1 - CHOSEN_PROBABILITY) / Math.max(others.length, 1)
  const probabilities = Object.fromEntries(
    optionIds.map((id) => [id, id === choice ? CHOSEN_PROBABILITY : otherShare])
  )
  return { type: 'choice', choice, probabilities, confidence: 0.62 }
}

/** The documented noul answer: `{type: 'noul', noul: <0..1>}`. */
export function syntheticNoulAnswer(value: number): Record<string, unknown> {
  return { type: 'noul', noul: value }
}

/** A schema-shaped Clef body that answers the sent questions consistently. */
export function syntheticClefBody(
  questions: ClefClassifierQuestions,
  answers: SyntheticAnswerValues = DEFAULT_SYNTHETIC_ANSWERS
): SyntheticClefBody {
  return {
    model: FIXTURE_ONLY_RESPONSE_MODEL,
    answers: {
      task_type: syntheticChoiceAnswer(questions.task_type, answers.task_type),
      needs_delegation: syntheticNoulAnswer(answers.needs_delegation)
    },
    usage: { input_tokens: FIXTURE_ONLY_INPUT_TOKENS, output_tokens: FIXTURE_ONLY_OUTPUT_TOKENS }
  }
}

/** The generic Cloudflare v4 REST envelope; unverified for Clef until live verification. */
export function syntheticCfEnvelope(body: unknown): Record<string, unknown> {
  return { result: body, success: true, errors: [], messages: [] }
}

export function encodeFixtureJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}
