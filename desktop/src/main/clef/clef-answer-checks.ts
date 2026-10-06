import {
  CLEF_CLASSIFIER_QUESTION_IDS,
  type ClefChoiceAnswer,
  type ClefClassifierQuestionId,
  type ClefNoulAnswer
} from '../../shared/clef/clef-answers'
import type { RouteBlocker, RouteBlockerDetail } from '../../shared/clef/clef-route-contract'
import type { ClefChoiceQuestion, ClefClassifierQuestions } from './clef-question-set'
import type { ClefVerifiedProfile } from './clef-verified-profile'

/** Response shape failures, kept apart from a missing or unsupported profile (contract_unverified). */
export const CLEF_RESPONSE_SHAPE_DETAIL: RouteBlockerDetail = 'response_schema_violation'

type ClefOptionKeyForm = ClefVerifiedProfile['optionKeyForm']

/** The verified-profile pins the answer checks read; the exhaustive switch below tracks new forms. */
export type ClefAnswerPins = Pick<ClefVerifiedProfile, 'optionKeyForm' | 'sumTolerance'>

/** Stored for audit and never used to decide (R39); noul answers carry none. */
export type ClefProviderConfidence = Readonly<Record<ClefClassifierQuestionId, number | null>>

export type ClassifierAnswerValues = {
  readonly taskType: ClefChoiceAnswer
  readonly needsDelegation: ClefNoulAnswer
}

export type CheckedClassifierAnswers =
  | {
      readonly ok: true
      readonly answers: ClassifierAnswerValues
      readonly providerConfidence: ClefProviderConfidence
    }
  | { readonly ok: false; readonly blocker: RouteBlocker }

type Checked<T> =
  | {
      readonly ok: true
      readonly value: T
      readonly confidence: number | null
      readonly tie: boolean
    }
  | { readonly ok: false; readonly detail: RouteBlockerDetail }

const TIE_BLOCKER: RouteBlocker = { reason: 'ambiguous', detail: 'low_margin' }
const SHAPE_FAILURE = { ok: false, detail: CLEF_RESPONSE_SHAPE_DETAIL } as const

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads only own properties so inherited names such as `constructor` never pass as fields. */
export function ownField(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function hasExactKeys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return (
    Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key))
  )
}

/** Keys exactly as sent, values in [0, 1], sum within the pinned tolerance; entries in key order. */
function readProbabilities(
  raw: unknown,
  keys: readonly string[],
  tolerance: number
): (readonly [string, number])[] | null {
  if (!isRecord(raw) || !hasExactKeys(raw, keys)) {
    return null
  }
  const entries = keys.map((key) => [key, raw[key]] as const)
  if (!entries.every((entry): entry is readonly [string, number] => isUnitInterval(entry[1]))) {
    return null
  }
  const sum = entries.reduce((total, [, value]) => total + value, 0)
  return Math.abs(sum - 1) <= tolerance ? entries : null
}

function answerOfType(raw: unknown, type: string): Readonly<Record<string, unknown>> | null {
  return isRecord(raw) && ownField(raw, 'type') === type ? raw : null
}

/** Choice and probability keys, as the verified profile pins them. */
function choiceOptionKeys(question: ClefChoiceQuestion, form: ClefOptionKeyForm): string[] {
  switch (form) {
    case 'sent_option_id':
      return Object.keys(question.criteria)
  }
}

function checkChoiceAnswer(
  raw: unknown,
  question: ClefChoiceQuestion,
  pins: ClefAnswerPins
): Checked<ClefChoiceAnswer> {
  const answer = answerOfType(raw, 'choice')
  const choice = answer ? ownField(answer, 'choice') : undefined
  if (answer === null || typeof choice !== 'string') {
    return SHAPE_FAILURE
  }
  const optionIds = choiceOptionKeys(question, pins.optionKeyForm)
  if (!optionIds.includes(choice)) {
    return { ok: false, detail: 'choice_outside_legal_set' }
  }
  const entries = readProbabilities(ownField(answer, 'probabilities'), optionIds, pins.sumTolerance)
  const confidence = ownField(answer, 'confidence')
  if (entries === null || !isUnitInterval(confidence)) {
    return SHAPE_FAILURE
  }
  const probabilities = Object.fromEntries(entries)
  const top = Math.max(...Object.values(probabilities))
  const leaders = optionIds.filter((id) => probabilities[id] === top)
  if (!leaders.includes(choice)) {
    return SHAPE_FAILURE
  }
  return { ok: true, value: { choice, probabilities }, confidence, tie: leaders.length > 1 }
}

function checkNoulAnswer(raw: unknown): Checked<ClefNoulAnswer> {
  const answer = answerOfType(raw, 'noul')
  const value = answer ? ownField(answer, 'noul') : undefined
  return isUnitInterval(value)
    ? { ok: true, value: { value }, confidence: null, tie: false }
    : SHAPE_FAILURE
}

function firstFailureDetail(checks: readonly Checked<unknown>[]): RouteBlockerDetail {
  for (const check of checks) {
    if (!check.ok) {
      return check.detail
    }
  }
  return CLEF_RESPONSE_SHAPE_DETAIL
}

/** Section 6 answer checks for the two classifier questions; any invalid answer outranks a tie. */
export function checkClassifierAnswers(
  rawAnswers: unknown,
  questions: ClefClassifierQuestions,
  pins: ClefAnswerPins
): CheckedClassifierAnswers {
  if (!isRecord(rawAnswers) || !hasExactKeys(rawAnswers, CLEF_CLASSIFIER_QUESTION_IDS)) {
    return { ok: false, blocker: { reason: 'invalid_output', detail: CLEF_RESPONSE_SHAPE_DETAIL } }
  }
  const taskType = checkChoiceAnswer(rawAnswers.task_type, questions.task_type, pins)
  const needsDelegation = checkNoulAnswer(rawAnswers.needs_delegation)
  if (!taskType.ok || !needsDelegation.ok) {
    return {
      ok: false,
      blocker: {
        reason: 'invalid_output',
        detail: firstFailureDetail([taskType, needsDelegation])
      }
    }
  }
  if (taskType.tie) {
    return { ok: false, blocker: TIE_BLOCKER }
  }
  return {
    ok: true,
    answers: { taskType: taskType.value, needsDelegation: needsDelegation.value },
    providerConfidence: { task_type: taskType.confidence, needs_delegation: null }
  }
}
