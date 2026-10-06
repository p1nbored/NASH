import { isJsonObject, rounded, safeKeys } from './clef-verification-report-json'

/** Per-question reading of a verification response, in the documented output schema (spec section 14). */

export type ClefSentQuestionSummary =
  | { id: string; kind: 'choice'; optionIds: readonly string[] }
  | { id: string; kind: 'noul' }

export type ClefKeyCoverage = { expected: number; observed: number; missing: number; extra: number }

export type ClefQuestionReport = {
  id: string
  kind: ClefSentQuestionSummary['kind']
  present: boolean
  answerFieldNames: readonly string[]
  keyCoverage: ClefKeyCoverage | null
  probabilitySum: number | null
  sumDeviation: number | null
  maxFractionDigits: number | null
  valuesInRange: boolean | null
}

const REPORT_DECIMALS = 12

function fractionDigits(value: number): number {
  const [mantissa, exponent] = String(value).split('e')
  const decimals = mantissa.split('.')[1]?.length ?? 0
  return Math.max(0, decimals - Number(exponent ?? 0))
}

function coverage(observed: readonly string[], expected: readonly string[]): ClefKeyCoverage {
  const missing = expected.filter((key) => !observed.includes(key)).length
  const extra = observed.filter((key) => !expected.includes(key)).length
  return { expected: expected.length, observed: observed.length, missing, extra }
}

function mismatch(entry: ClefKeyCoverage): number {
  return entry.missing + entry.extra
}

function inUnitRange(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/** The documented noul answer is `{type: 'noul', noul: <0..1>}`; no other field or shape is read. */
function noulReport(base: ClefQuestionReport, answer: unknown): ClefQuestionReport {
  const value = isJsonObject(answer) && answer.type === 'noul' ? answer.noul : undefined
  return { ...base, valuesInRange: base.present ? inUnitRange(value) : null }
}

export function questionReport(
  question: ClefSentQuestionSummary,
  answer: unknown
): ClefQuestionReport {
  const base: ClefQuestionReport = {
    id: question.id,
    kind: question.kind,
    present: answer !== undefined,
    answerFieldNames: safeKeys(answer).keys,
    keyCoverage: null,
    probabilitySum: null,
    sumDeviation: null,
    maxFractionDigits: null,
    valuesInRange: null
  }
  if (question.kind === 'noul') {
    return noulReport(base, answer)
  }
  const probabilities = isJsonObject(answer) ? answer.probabilities : undefined
  if (!isJsonObject(probabilities)) {
    return base
  }
  const keys = Object.keys(probabilities)
  const values = Object.values(probabilities)
  const numbers = values.filter((value): value is number => typeof value === 'number')
  const sum = numbers.reduce((total, value) => total + value, 0)
  return {
    ...base,
    keyCoverage: coverage(keys, question.optionIds),
    probabilitySum: rounded(sum, REPORT_DECIMALS),
    sumDeviation: rounded(Math.abs(sum - 1), REPORT_DECIMALS),
    maxFractionDigits: numbers.reduce((max, value) => Math.max(max, fractionDigits(value)), 0),
    valuesInRange: values.every(inUnitRange)
  }
}

export function optionEcho(
  questions: readonly ClefQuestionReport[]
): 'exact' | 'altered' | 'missing' {
  const choices = questions.filter((question) => question.kind === 'choice')
  const covered = choices.flatMap((question) =>
    question.keyCoverage ? [question.keyCoverage] : []
  )
  if (covered.length === 0) {
    return 'missing'
  }
  const exact = covered.length === choices.length && covered.every((entry) => mismatch(entry) === 0)
  return exact ? 'exact' : 'altered'
}
