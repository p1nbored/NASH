import { createHash } from 'node:crypto'
import {
  ValidatedClefAnswersSchema,
  type ClefUsage,
  type ValidatedClefAnswers
} from '../../shared/clef/clef-answers'
import type { RouteBlocker, RouteBlockerDetail } from '../../shared/clef/clef-route-contract'
import {
  CLEF_RESPONSE_SHAPE_DETAIL,
  checkClassifierAnswers,
  isRecord,
  ownField
} from './clef-answer-checks'
import type { ClefClassifierQuestions } from './clef-question-set'
import {
  ClefVerifiedProfileSchema,
  type ClefEnvelopeMode,
  type ClefVerifiedProfile
} from './clef-verified-profile'

export const CLEF_TRUNCATION_INPUT_TOKENS = 60_000
const ESTIMATE_OVERRUN_FACTOR = 2

/** The response-shape pins of the verified profile; a whole profile record also fits. */
export type ClefResponseProfile = Pick<
  ClefVerifiedProfile,
  'envelopeMode' | 'expectedResponseModel' | 'optionKeyForm' | 'sumTolerance'
>
type PinnedResponseProfile = ClefResponseProfile & { readonly expectedResponseModel: string }

const ResponseProfileSchema = ClefVerifiedProfileSchema.pick({
  envelopeMode: true,
  expectedResponseModel: true,
  optionKeyForm: true,
  sumTolerance: true
})

export type ClefResponseValidationInput = {
  readonly rawBytes: Uint8Array
  readonly questions: ClefClassifierQuestions
  readonly estimatedInputTokens: number
  readonly profile: ClefResponseProfile
}

/** `rawSha256` is computed before parsing and returned either way, so the raw record always has it. */
export type ClefResponseValidationResult =
  | { readonly ok: true; readonly answers: ValidatedClefAnswers; readonly rawSha256: string }
  | { readonly ok: false; readonly blocker: RouteBlocker; readonly rawSha256: string }

type BodyOutcome =
  | { readonly ok: true; readonly answers: ValidatedClefAnswers }
  | { readonly ok: false; readonly blocker: RouteBlocker }

type ProfileRead =
  | { readonly ok: true; readonly profile: PinnedResponseProfile }
  | { readonly ok: false; readonly detail: 'contract_unverified' | 'clef_identity_unpinned' }

const PARSE_FAILED = Symbol('clef_parse_failed')

function invalid(detail: RouteBlockerDetail): BodyOutcome {
  return { ok: false, blocker: { reason: 'invalid_output', detail } }
}

function readResponseProfile(profile: ClefResponseProfile | null): ProfileRead {
  if (profile === null) {
    return { ok: false, detail: 'contract_unverified' }
  }
  // Why: project the pins so a whole profile record passes the strict schema.
  const parsed = ResponseProfileSchema.safeParse({
    envelopeMode: profile.envelopeMode,
    expectedResponseModel: profile.expectedResponseModel,
    optionKeyForm: profile.optionKeyForm,
    sumTolerance: profile.sumTolerance
  })
  if (!parsed.success) {
    return { ok: false, detail: 'contract_unverified' }
  }
  const { expectedResponseModel } = parsed.data
  return expectedResponseModel === null
    ? { ok: false, detail: 'clef_identity_unpinned' }
    : { ok: true, profile: { ...parsed.data, expectedResponseModel } }
}

/** For G0 before billing: the configuration detail that blocks this profile, or null when usable. */
export function clefResponseProfileBlockerDetail(
  profile: ClefResponseProfile | null
): 'contract_unverified' | 'clef_identity_unpinned' | null {
  const read = readResponseProfile(profile)
  return read.ok ? null : read.detail
}

export function isSupportedClefResponseProfile(profile: ClefResponseProfile | null): boolean {
  return readResponseProfile(profile).ok
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    // Why: malformed bytes are an invalid_output verdict, not an exception; the raw hash keeps the evidence.
    return PARSE_FAILED
  }
}

function unwrapEnvelope(
  parsed: unknown,
  mode: ClefEnvelopeMode
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(parsed)) {
    return null
  }
  switch (mode) {
    case 'bare':
      return parsed
    case 'cf_result_wrapper': {
      const errors = ownField(parsed, 'errors')
      const errorsClear = errors === undefined || (Array.isArray(errors) && errors.length === 0)
      const result = ownField(parsed, 'result')
      // `messages` is preserved in the raw bytes and never gates.
      return ownField(parsed, 'success') === true && errorsClear && isRecord(result) ? result : null
    }
  }
}

function readUsage(raw: unknown): ClefUsage | null {
  if (!isRecord(raw)) {
    return null
  }
  const inputTokens = ownField(raw, 'input_tokens')
  const outputTokens = ownField(raw, 'output_tokens')
  return isTokenCount(inputTokens) && isTokenCount(outputTokens)
    ? { inputTokens, outputTokens }
    : null
}

function truncationDetail(inputTokens: number, estimate: number): RouteBlockerDetail | null {
  if (inputTokens >= CLEF_TRUNCATION_INPUT_TOKENS) {
    return 'possible_truncation'
  }
  return inputTokens > estimate * ESTIMATE_OVERRUN_FACTOR ? 'estimate_exceeded' : null
}

function validateBody(input: ClefResponseValidationInput): BodyOutcome {
  const read = readResponseProfile(input.profile)
  if (!read.ok) {
    return invalid(read.detail)
  }
  const { profile } = read
  const estimate = input.estimatedInputTokens
  if (!isTokenCount(estimate) || estimate === 0) {
    return invalid('contract_unverified')
  }
  const parsed = parseJsonBytes(input.rawBytes)
  const body = parsed === PARSE_FAILED ? null : unwrapEnvelope(parsed, profile.envelopeMode)
  const model = body ? ownField(body, 'model') : undefined
  if (body === null || typeof model !== 'string') {
    return invalid(CLEF_RESPONSE_SHAPE_DETAIL)
  }
  if (model !== profile.expectedResponseModel) {
    return invalid('model_identity_mismatch')
  }
  const usage = readUsage(ownField(body, 'usage'))
  if (usage === null) {
    return invalid(CLEF_RESPONSE_SHAPE_DETAIL)
  }
  const truncation = truncationDetail(usage.inputTokens, estimate)
  if (truncation) {
    return invalid(truncation)
  }
  const checked = checkClassifierAnswers(ownField(body, 'answers'), input.questions, profile)
  if (!checked.ok) {
    return checked
  }
  const normalized = ValidatedClefAnswersSchema.safeParse({
    ...checked.answers,
    providerConfidence: checked.providerConfidence,
    responseModel: model,
    usage
  })
  if (!normalized.success) {
    return invalid(CLEF_RESPONSE_SHAPE_DETAIL)
  }
  return { ok: true, answers: normalized.data }
}

/** Section 6 validation; every failure is final (never retried). Unknown extra fields are tolerated. */
export function validateClefResponse(
  input: ClefResponseValidationInput
): ClefResponseValidationResult {
  const rawSha256 = createHash('sha256').update(input.rawBytes).digest('hex')
  const outcome = validateBody(input)
  return outcome.ok ? { ...outcome, rawSha256 } : { ok: false, blocker: outcome.blocker, rawSha256 }
}
