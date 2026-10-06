import { CLEF_IDENTIFIER_PATTERN } from '../../shared/clef/clef-answers'
import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import type { ClefQuestion } from './clef-question-set'
import type { ClefState } from './clef-state-builder'

// Description-only limits from the Workers AI input schema (R05).
const CLEF_MIN_QUESTIONS = 1
const CLEF_MAX_QUESTIONS = 64
const CLEF_MIN_CHOICE_OPTIONS = 2
const CLEF_MAX_CHOICE_OPTIONS = 255

/** Local caps far below the 13 MiB body and 65,536-token context, because overflow truncates silently. */
export const CLEF_MAX_BODY_BYTES = 64 * 1024
export const CLEF_MAX_ESTIMATED_INPUT_TOKENS = 12_000
export const CLEF_CHARS_PER_TOKEN = 4

const REQUEST_REJECTED: RouteBlocker = {
  reason: 'classifier_unavailable',
  detail: 'request_rejected'
}
const ESTIMATE_EXCEEDED: RouteBlocker = {
  reason: 'classifier_unavailable',
  detail: 'estimate_exceeded'
}

export type ClefPreflightInput = {
  readonly questions: Readonly<Record<string, ClefQuestion>>
  readonly bodyByteLength: number
  readonly estimatedInputTokens: number
}

function isNonBlank(text: string): boolean {
  return text.trim().length > 0
}

function isWithin(count: number, min: number, max: number): boolean {
  return count >= min && count <= max
}

function questionIsWellFormed(question: ClefQuestion): boolean {
  if (!isNonBlank(question.instructions)) {
    return false
  }
  switch (question.type) {
    case 'choice': {
      const optionIds = Object.keys(question.criteria)
      return (
        isWithin(optionIds.length, CLEF_MIN_CHOICE_OPTIONS, CLEF_MAX_CHOICE_OPTIONS) &&
        optionIds.every((id) => CLEF_IDENTIFIER_PATTERN.test(id))
      )
    }
    case 'noul':
      return isNonBlank(question.criteria.true) && isNonBlank(question.criteria.false)
  }
}

/** State plus questions (option text included) at four characters per token, rounded up. */
export function estimateClefInputTokens(
  state: ClefState,
  questions: Readonly<Record<string, ClefQuestion>>
): number {
  const characters = JSON.stringify(state).length + JSON.stringify(questions).length
  return Math.ceil(characters / CLEF_CHARS_PER_TOKEN)
}

/** Section 5 preflight; any failure blocks with no call. */
export function preflightClefRequest(input: ClefPreflightInput): RouteBlocker | null {
  const entries = Object.entries(input.questions)
  if (!isWithin(entries.length, CLEF_MIN_QUESTIONS, CLEF_MAX_QUESTIONS)) {
    return REQUEST_REJECTED
  }
  const wellFormed = entries.every(
    ([id, question]) => CLEF_IDENTIFIER_PATTERN.test(id) && questionIsWellFormed(question)
  )
  if (!wellFormed || input.bodyByteLength > CLEF_MAX_BODY_BYTES) {
    return REQUEST_REJECTED
  }
  return input.estimatedInputTokens > CLEF_MAX_ESTIMATED_INPUT_TOKENS ? ESTIMATE_EXCEEDED : null
}
