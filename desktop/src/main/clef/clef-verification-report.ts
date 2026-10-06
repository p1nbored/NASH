import { createHash } from 'node:crypto'
import {
  optionEcho,
  questionReport,
  type ClefQuestionReport,
  type ClefSentQuestionSummary
} from './clef-verification-report-answers'
import { isJsonObject, rounded, safeKeys, type JsonObject } from './clef-verification-report-json'
import type { ClefEnvelopeMode } from './clef-verified-profile'

export type {
  ClefKeyCoverage,
  ClefQuestionReport,
  ClefSentQuestionSummary
} from './clef-verification-report-answers'

/**
 * Redacted structural report of one live verification call (spec section 14).
 * Server text is never copied in: only our own IDs, counts, numbers, short field names and a strictly shaped model value.
 * Answers are read in the documented output schema: `{type, choice|noul, ...}`.
 */

export type ClefSentRequestSummary = {
  questions: readonly ClefSentQuestionSummary[]
  estimatedInputTokens: number
}

export type ClefRawResponse = { status: number; bytes: Uint8Array }

export type ClefVerificationReport = {
  reportVersion: 2
  httpStatus: number
  rawSha256: string
  rawByteLength: number
  bodyKind: 'json_object' | 'json_other' | 'not_json'
  envelope: {
    shape: ClefEnvelopeMode | 'unrecognized'
    success: boolean | null
    errorCount: number | null
    messageCount: number | null
    topLevelKeys: readonly string[]
    bodyKeys: readonly string[]
    withheldKeyCount: number
  }
  model: { observed: string | null; withheld: boolean }
  answerKeys: { matchQuestionIds: boolean; missing: readonly string[]; extraCount: number }
  optionIdEcho: 'exact' | 'altered' | 'missing'
  questions: readonly ClefQuestionReport[]
  maxSumDeviation: number | null
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    estimatedInputTokens: number
    inputToEstimateRatio: number | null
  }
}

// Why strict: the only server string echoed into the report. A model path (`@cf/<vendor>/<name>`) or a documented short
// name, in bounded lower-case form, so no token, id or free text can pass as a model identity.
const MODEL_PATTERN = /^(?:@cf\/[a-z][a-z0-9-]{0,39}\/[a-z][a-z0-9.-]{0,59}|clef|clef-flash)$/
const RATIO_DECIMALS = 3

function decodeJson(bytes: Uint8Array): {
  kind: ClefVerificationReport['bodyKind']
  value: unknown
} {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return { kind: isJsonObject(value) ? 'json_object' : 'json_other', value }
  } catch {
    return { kind: 'not_json', value: undefined }
  }
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null
}

function readEnvelope(value: unknown): {
  envelope: ClefVerificationReport['envelope']
  body: JsonObject | null
} {
  const top = isJsonObject(value) ? value : null
  const wrapped = top !== null && 'result' in top && typeof top.success === 'boolean'
  const shape = wrapped ? 'cf_result_wrapper' : top && 'answers' in top ? 'bare' : 'unrecognized'
  const body = wrapped ? (isJsonObject(top.result) ? top.result : null) : top
  const topKeys = safeKeys(top)
  const bodyKeys = safeKeys(body)
  return {
    envelope: {
      shape,
      success: wrapped ? top.success === true : null,
      errorCount: wrapped ? arrayLength(top.errors) : null,
      messageCount: wrapped ? arrayLength(top.messages) : null,
      topLevelKeys: topKeys.keys,
      bodyKeys: bodyKeys.keys,
      withheldKeyCount: topKeys.withheld + (wrapped ? bodyKeys.withheld : 0)
    },
    body: shape === 'unrecognized' ? null : body
  }
}

function readModel(body: JsonObject | null): ClefVerificationReport['model'] {
  const model = body?.model
  if (model === undefined || model === null) {
    return { observed: null, withheld: false }
  }
  const safe = typeof model === 'string' && MODEL_PATTERN.test(model)
  return safe ? { observed: model, withheld: false } : { observed: null, withheld: true }
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readUsage(body: JsonObject | null, estimated: number): ClefVerificationReport['usage'] {
  const usage = isJsonObject(body?.usage) ? body.usage : null
  const inputTokens = tokenCount(usage?.input_tokens)
  return {
    inputTokens,
    outputTokens: tokenCount(usage?.output_tokens),
    estimatedInputTokens: estimated,
    inputToEstimateRatio:
      inputTokens !== null && estimated > 0
        ? rounded(inputTokens / estimated, RATIO_DECIMALS)
        : null
  }
}

function readAnswerKeys(
  answers: JsonObject | null,
  questionIds: readonly string[]
): ClefVerificationReport['answerKeys'] {
  const keys = answers ? Object.keys(answers) : []
  const missing = questionIds.filter((id) => !keys.includes(id))
  const extraCount = keys.filter((key) => !questionIds.includes(key)).length
  return { matchQuestionIds: missing.length === 0 && extraCount === 0, missing, extraCount }
}

export function buildClefVerificationReport(
  raw: ClefRawResponse,
  sent: ClefSentRequestSummary
): ClefVerificationReport {
  const decoded = decodeJson(raw.bytes)
  const { envelope, body } = readEnvelope(decoded.value)
  const answers = isJsonObject(body?.answers) ? body.answers : null
  const answerOf = (id: string): unknown =>
    answers && Object.hasOwn(answers, id) ? answers[id] : undefined
  const questions = sent.questions.map((question) =>
    questionReport(question, answerOf(question.id))
  )
  const deviations = questions.flatMap((question) =>
    question.sumDeviation === null ? [] : [question.sumDeviation]
  )
  return {
    reportVersion: 2,
    httpStatus: raw.status,
    rawSha256: createHash('sha256').update(raw.bytes).digest('hex'),
    rawByteLength: raw.bytes.byteLength,
    bodyKind: decoded.kind,
    envelope,
    model: readModel(body),
    answerKeys: readAnswerKeys(
      answers,
      sent.questions.map((question) => question.id)
    ),
    optionIdEcho: optionEcho(questions),
    questions,
    maxSumDeviation: deviations.length > 0 ? Math.max(...deviations) : null,
    usage: readUsage(body, sent.estimatedInputTokens)
  }
}
