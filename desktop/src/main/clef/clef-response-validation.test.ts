import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ClefClassifierQuestionId } from '../../shared/clef/clef-answers'
import { buildClefRequest } from './clef-request-builder'
import {
  CLEF_TRUNCATION_INPUT_TOKENS,
  clefResponseProfileBlockerDetail,
  isSupportedClefResponseProfile,
  validateClefResponse,
  type ClefResponseProfile
} from './clef-response-validation'
import { CLEF_DEFAULT_SUM_TOLERANCE } from './clef-verified-profile'
import {
  FIXTURE_ONLY_RESPONSE_MODEL,
  encodeFixtureJson,
  syntheticCfEnvelope,
  syntheticClefBody
} from './fixtures/synthetic-clef-responses.test-fixture'

const built = buildClefRequest({ objective: 'Add a retry button to the Workbench queue.' })
if (!built.ok) {
  throw new Error('fixture request must build')
}
const { questions } = built.request.body
const estimate = built.request.estimatedInputTokens
const ANSWERS = { task_type: 'software_engineering', needs_delegation: 0.82 }
const WRAPPED: ClefResponseProfile = {
  envelopeMode: 'cf_result_wrapper',
  expectedResponseModel: FIXTURE_ONLY_RESPONSE_MODEL,
  optionKeyForm: 'sent_option_id',
  sumTolerance: CLEF_DEFAULT_SUM_TOLERANCE
}
const BARE: ClefResponseProfile = { ...WRAPPED, envelopeMode: 'bare' }

// Profile and estimate problems stay contract failures; malformed bodies are schema violations.
const contractFailure = { reason: 'invalid_output', detail: 'contract_unverified' }
const shapeFailure = { reason: 'invalid_output', detail: 'response_schema_violation' }

/** Profile values the type rules out, as an unchecked profile file could still carry them. */
function uncheckedProfile(change: Record<string, unknown>): ClefResponseProfile {
  return JSON.parse(JSON.stringify({ ...WRAPPED, ...change }))
}

function body() {
  return syntheticClefBody(questions, ANSWERS)
}

function withAnswer(id: ClefClassifierQuestionId, change: Record<string, unknown>) {
  const base = body()
  return { ...base, answers: { ...base.answers, [id]: { ...base.answers[id], ...change } } }
}

function validateBytes(rawBytes: Uint8Array, profile: ClefResponseProfile = WRAPPED) {
  return validateClefResponse({ rawBytes, questions, estimatedInputTokens: estimate, profile })
}

function validateWrapped(clefBody: unknown) {
  return validateBytes(encodeFixtureJson(syntheticCfEnvelope(clefBody)))
}

function blockerOf(result: ReturnType<typeof validateClefResponse>) {
  return result.ok ? null : result.blocker
}

describe('validateClefResponse envelopes', () => {
  it('accepts a wrapped response and normalizes both answers', () => {
    const result = validateWrapped(body())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.answers.taskType.choice).toBe('software_engineering')
    expect(Object.keys(result.answers.taskType.probabilities)).toEqual(
      Object.keys(questions.task_type.criteria)
    )
    expect(result.answers.needsDelegation).toEqual({ value: 0.82 })
    expect(result.answers.providerConfidence).toEqual({ task_type: 0.62, needs_delegation: null })
    expect(result.answers.responseModel).toBe(FIXTURE_ONLY_RESPONSE_MODEL)
    expect(result.answers.usage).toEqual({ inputTokens: 640, outputTokens: 48 })
  })

  it('carries no difficulty scoring, context scope, inputs or route in the result', () => {
    const result = validateWrapped(body())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(Object.keys(result).toSorted()).toEqual(['answers', 'ok', 'rawSha256'])
    expect(Object.keys(result.answers).toSorted()).toEqual([
      'needsDelegation',
      'providerConfidence',
      'responseModel',
      'taskType',
      'usage'
    ])
  })

  it('accepts a bare response under a bare profile', () => {
    expect(validateBytes(encodeFixtureJson(body()), BARE).ok).toBe(true)
  })

  it('rejects a bare body under the wrapper profile and a wrapped body under the bare profile', () => {
    expect(blockerOf(validateBytes(encodeFixtureJson(body()), WRAPPED))).toEqual(shapeFailure)
    const wrapped = encodeFixtureJson(syntheticCfEnvelope(body()))
    expect(blockerOf(validateBytes(wrapped, BARE))).toEqual(shapeFailure)
  })

  it.each([
    ['success false', { success: false }],
    ['success missing', { success: undefined }],
    ['a non-empty errors list', { errors: [{ code: 1000, message: 'x' }] }],
    ['errors that are not a list', { errors: 'none' }],
    ['no result', { result: undefined }],
    ['a result that is not an object', { result: [body()] }]
  ])('rejects a wrapper with %s', (_label, change) => {
    const raw = encodeFixtureJson({ ...syntheticCfEnvelope(body()), ...change })
    expect(blockerOf(validateBytes(raw))).toEqual(shapeFailure)
  })

  it('accepts absent errors and does not gate on messages', () => {
    const raw = encodeFixtureJson({
      ...syntheticCfEnvelope(body()),
      errors: undefined,
      messages: [{ code: 1, message: 'note' }]
    })
    expect(validateBytes(raw).ok).toBe(true)
  })

  it('tolerates unknown fields at every level', () => {
    const extended = {
      ...withAnswer('task_type', { rationale: 'ignored' }),
      latency_ms: 12,
      usage: { input_tokens: 640, output_tokens: 48, cached_tokens: 0 }
    }
    const raw = encodeFixtureJson({ ...syntheticCfEnvelope(extended), result_info: {} })
    expect(validateBytes(raw).ok).toBe(true)
  })
})

describe('validateClefResponse raw bytes', () => {
  it('hashes the raw bytes before parsing, on success and on failure', () => {
    const good = encodeFixtureJson(syntheticCfEnvelope(body()))
    expect(validateBytes(good).rawSha256).toBe(createHash('sha256').update(good).digest('hex'))
    const broken = new TextEncoder().encode('{"result": ')
    const result = validateBytes(broken)
    expect(result).toEqual({
      ok: false,
      blocker: shapeFailure,
      rawSha256: createHash('sha256').update(broken).digest('hex')
    })
  })

  it('rejects invalid UTF-8', () => {
    expect(blockerOf(validateBytes(new Uint8Array([0x7b, 0xff, 0x7d])))).toEqual(shapeFailure)
  })
})

describe('validateClefResponse identity and usage', () => {
  it('flags a different response model as model_identity_mismatch', () => {
    expect(blockerOf(validateWrapped({ ...body(), model: '@cf/cloudflare/clef-flash' }))).toEqual({
      reason: 'invalid_output',
      detail: 'model_identity_mismatch'
    })
  })

  it('rejects a missing model as a schema violation', () => {
    expect(blockerOf(validateWrapped({ ...body(), model: undefined }))).toEqual(shapeFailure)
  })

  it.each([
    ['negative input tokens', { input_tokens: -1, output_tokens: 0 }],
    ['fractional output tokens', { input_tokens: 10, output_tokens: 0.5 }],
    ['missing output tokens', { input_tokens: 10 }],
    ['string tokens', { input_tokens: '10', output_tokens: 0 }]
  ])('rejects %s', (_label, usage) => {
    expect(blockerOf(validateWrapped({ ...body(), usage }))).toEqual(shapeFailure)
  })

  it('flags input tokens at the truncation threshold as possible_truncation', () => {
    const usage = { input_tokens: CLEF_TRUNCATION_INPUT_TOKENS, output_tokens: 0 }
    expect(blockerOf(validateWrapped({ ...body(), usage }))).toEqual({
      reason: 'invalid_output',
      detail: 'possible_truncation'
    })
    const below = { input_tokens: CLEF_TRUNCATION_INPUT_TOKENS - 1, output_tokens: 0 }
    expect(blockerOf(validateWrapped({ ...body(), usage: below }))?.detail).toBe(
      'estimate_exceeded'
    )
  })

  it('checks identity before usage and usage before answers', () => {
    const everythingWrong = {
      ...withAnswer('task_type', { choice: 'codex_assistant.codex_exec' }),
      model: 'other',
      usage: { input_tokens: CLEF_TRUNCATION_INPUT_TOKENS, output_tokens: 0 }
    }
    expect(blockerOf(validateWrapped(everythingWrong))?.detail).toBe('model_identity_mismatch')
    const wrongUsageAndAnswer = { ...everythingWrong, model: FIXTURE_ONLY_RESPONSE_MODEL }
    expect(blockerOf(validateWrapped(wrongUsageAndAnswer))?.detail).toBe('possible_truncation')
  })

  it('flags input tokens above twice the local estimate as estimate_exceeded', () => {
    const atLimit = { input_tokens: estimate * 2, output_tokens: 0 }
    expect(validateWrapped({ ...body(), usage: atLimit }).ok).toBe(true)
    const over = { input_tokens: estimate * 2 + 1, output_tokens: 0 }
    expect(blockerOf(validateWrapped({ ...body(), usage: over }))).toEqual({
      reason: 'invalid_output',
      detail: 'estimate_exceeded'
    })
  })
})

describe('validateClefResponse answers and profile', () => {
  it('passes answer failures through as invalid_output', () => {
    const outside = withAnswer('task_type', { choice: 'planning' })
    expect(blockerOf(validateWrapped(outside))).toEqual({
      reason: 'invalid_output',
      detail: 'choice_outside_legal_set'
    })
    const { needs_delegation: _delegation, ...missing } = body().answers
    expect(blockerOf(validateWrapped({ ...body(), answers: missing }))).toEqual(shapeFailure)
  })

  it('passes a task type tie through as ambiguous / low_margin', () => {
    const [first, second] = Object.keys(questions.task_type.criteria)
    const rest = Object.keys(questions.task_type.criteria).slice(2)
    const tie = withAnswer('task_type', {
      choice: first,
      probabilities: {
        [first ?? '']: 0.4,
        [second ?? '']: 0.4,
        ...Object.fromEntries(rest.map((id) => [id, 0.2 / rest.length]))
      }
    })
    expect(blockerOf(validateWrapped(tie))).toEqual({ reason: 'ambiguous', detail: 'low_margin' })
  })

  it('never lets provider confidence change the verdict', () => {
    for (const confidence of [0, 0.01, 0.5, 1]) {
      const raw = withAnswer('task_type', { confidence })
      const result = validateWrapped(raw)
      expect(result.ok && result.answers.taskType.choice).toBe('software_engineering')
    }
  })

  it.each([
    ['an unknown envelope mode', { envelopeMode: 'auto' }],
    ['the retired envelope field name', { envelopeMode: undefined, envelope: 'bare' }],
    ['a blank expected model', { expectedResponseModel: '' }],
    ['a zero tolerance', { sumTolerance: 0 }],
    ['a missing tolerance', { sumTolerance: undefined }],
    ['a tolerance that voids the sum check', { sumTolerance: 0.5 }],
    ['an unknown option key form', { optionKeyForm: 'wire_option_id' }]
  ])('fails closed on a profile with %s', (_label, change) => {
    const profile = uncheckedProfile(change)
    expect(clefResponseProfileBlockerDetail(profile)).toBe('contract_unverified')
    expect(isSupportedClefResponseProfile(profile)).toBe(false)
    const result = validateClefResponse({
      rawBytes: encodeFixtureJson(syntheticCfEnvelope(body())),
      questions,
      estimatedInputTokens: estimate,
      profile
    })
    expect(blockerOf(result)).toEqual(contractFailure)
  })

  it('fails closed on a NaN tolerance', () => {
    const profile: ClefResponseProfile = { ...WRAPPED, sumTolerance: Number.NaN }
    expect(isSupportedClefResponseProfile(profile)).toBe(false)
    expect(
      blockerOf(validateBytes(encodeFixtureJson(syntheticCfEnvelope(body())), profile))
    ).toEqual(contractFailure)
  })

  it('reports an unpinned response model as clef_identity_unpinned before reading the body', () => {
    const profile: ClefResponseProfile = { ...WRAPPED, expectedResponseModel: null }
    expect(clefResponseProfileBlockerDetail(profile)).toBe('clef_identity_unpinned')
    expect(blockerOf(validateBytes(new TextEncoder().encode('not json'), profile))).toEqual({
      reason: 'invalid_output',
      detail: 'clef_identity_unpinned'
    })
  })

  it('reports a missing profile as contract_unverified and accepts both supported envelopes', () => {
    expect(clefResponseProfileBlockerDetail(null)).toBe('contract_unverified')
    expect(isSupportedClefResponseProfile(null)).toBe(false)
    for (const profile of [WRAPPED, BARE]) {
      expect(clefResponseProfileBlockerDetail(profile)).toBeNull()
      expect(isSupportedClefResponseProfile(profile)).toBe(true)
    }
  })

  it('needs no score key form: a profile that carries one is no longer the response profile', () => {
    const withScoreForm = uncheckedProfile({ scoreKeyForm: 'level_index' })
    // Why: the projection copies only the pins the validator reads, so a leftover field never matters.
    expect(clefResponseProfileBlockerDetail(withScoreForm)).toBeNull()
  })

  it('fails closed on a non-positive local estimate', () => {
    const rawBytes = encodeFixtureJson(syntheticCfEnvelope(body()))
    for (const estimatedInputTokens of [0, -1, 1.5]) {
      const result = validateClefResponse({
        rawBytes,
        questions,
        estimatedInputTokens,
        profile: WRAPPED
      })
      expect(blockerOf(result)).toEqual(contractFailure)
    }
  })
})
