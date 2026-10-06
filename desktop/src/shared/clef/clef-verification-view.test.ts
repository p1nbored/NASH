import { describe, expect, it } from 'vitest'
import {
  CLEF_PROFILE_PROBLEMS,
  ClefVerificationReportViewSchema,
  parseClefProfilePinResult,
  parseClefVerificationReportView,
  parseClefVerifyResult,
  type ClefProfilePinResult,
  type ClefVerificationReportView,
  type ClefVerifyResult
} from './clef-verification-view'

const SHA = 'a'.repeat(64)

const REPORT: ClefVerificationReportView = {
  reportVersion: 2,
  httpStatus: 200,
  rawSha256: SHA,
  rawByteLength: 2_048,
  bodyKind: 'json_object',
  envelope: {
    shape: 'cf_result_wrapper',
    success: true,
    errorCount: 0,
    messageCount: 0,
    topLevelKeys: ['errors', 'messages', 'result', 'success'],
    bodyKeys: ['answers', 'model', 'usage'],
    withheldKeyCount: 0
  },
  model: { observed: '@cf/cloudflare/clef', withheld: false },
  answerKeys: { matchQuestionIds: true, missing: [], extraCount: 0 },
  optionIdEcho: 'exact',
  questions: [
    {
      id: 'task_type',
      kind: 'choice',
      present: true,
      answerFieldNames: ['choice', 'confidence', 'probabilities', 'type'],
      keyCoverage: { expected: 11, observed: 11, missing: 0, extra: 0 },
      probabilitySum: 1,
      sumDeviation: 0,
      maxFractionDigits: 6,
      valuesInRange: true
    },
    {
      id: 'needs_delegation',
      kind: 'noul',
      present: true,
      answerFieldNames: ['noul', 'type'],
      keyCoverage: null,
      probabilitySum: null,
      sumDeviation: null,
      maxFractionDigits: null,
      valuesInRange: true
    }
  ],
  maxSumDeviation: 0,
  usage: {
    inputTokens: 3_100,
    outputTokens: 60,
    estimatedInputTokens: 3_000,
    inputToEstimateRatio: 1.033
  }
}

const REPORTED: ClefVerifyResult = {
  outcome: 'reported',
  report: REPORT,
  reportSha256: SHA,
  pin: { pinnable: true, problems: [] }
}
const FAILED: ClefVerifyResult = {
  outcome: 'call_failed',
  blocker: { reason: 'classifier_unavailable', detail: 'auth_or_account' },
  httpStatus: 401,
  attempts: 1
}
const PINNED: ClefProfilePinResult = {
  pinned: true,
  profileHash: SHA,
  verifiedAt: '2026-10-04T12:00:00.000Z',
  routingStatus: 'ready'
}

describe('clef verification report view', () => {
  it('accepts the redacted report structure', () => {
    expect(parseClefVerificationReportView(REPORT)).toEqual(REPORT)
  })

  it('accepts a report for an unrecognized body', () => {
    const unrecognized: ClefVerificationReportView = {
      ...REPORT,
      bodyKind: 'not_json',
      envelope: {
        shape: 'unrecognized',
        success: null,
        errorCount: null,
        messageCount: null,
        topLevelKeys: [],
        bodyKeys: [],
        withheldKeyCount: 0
      },
      model: { observed: null, withheld: false },
      questions: [],
      maxSumDeviation: null,
      usage: {
        inputTokens: null,
        outputTokens: null,
        estimatedInputTokens: 3_000,
        inputToEstimateRatio: null
      }
    }
    expect(parseClefVerificationReportView(unrecognized)).toEqual(unrecognized)
  })

  it.each([undefined, null, 'report', [], {}])(
    'rejects a value that is not a report: %j',
    (value) => {
      expect(parseClefVerificationReportView(value)).toBeNull()
    }
  )

  // Why: the only server string a report may carry is a strictly shaped model name.
  it.each([
    'Bearer fixture-only-clef-token-0000',
    'https://api.example.test/accounts/0123456789abcdef0123456789abcdef',
    '@cf/cloudflare/clef\nextra',
    'x'.repeat(200)
  ])('rejects a model value that is not a model name: %s', (observed) => {
    const widened = { ...REPORT, model: { observed, withheld: false } }
    expect(parseClefVerificationReportView(widened)).toBeNull()
  })

  it.each(['clef', 'clef-flash', '@cf/cloudflare/clef'])(
    'accepts the model name %s',
    (observed) => {
      const named = { ...REPORT, model: { observed, withheld: false } }
      expect(parseClefVerificationReportView(named)).not.toBeNull()
    }
  )

  it('rejects a field name that is not a short plain key', () => {
    const widened = {
      ...REPORT,
      envelope: { ...REPORT.envelope, bodyKeys: ['0123456789abcdef0123456789abcdef'] }
    }
    expect(parseClefVerificationReportView(widened)).toBeNull()
  })

  it('rejects an unsupported report version, a hash that is not SHA-256 and a bad status', () => {
    expect(parseClefVerificationReportView({ ...REPORT, reportVersion: 1 })).toBeNull()
    expect(parseClefVerificationReportView({ ...REPORT, reportVersion: 3 })).toBeNull()
    expect(parseClefVerificationReportView({ ...REPORT, rawSha256: 'abc' })).toBeNull()
    expect(parseClefVerificationReportView({ ...REPORT, httpStatus: 20 })).toBeNull()
  })

  it('has no score fields: the report of the two-question bundle names none', () => {
    expect(Object.keys(REPORT)).not.toContain('scoreKeyForm')
    expect(Object.keys(REPORT)).not.toContain('scoreLegendKeyForm')
    expect(parseClefVerificationReportView({ ...REPORT, scoreKeyForm: 'level_index' })).toBeNull()
    expect(
      parseClefVerificationReportView({ ...REPORT, scoreLegendKeyForm: 'level_index' })
    ).toBeNull()
    const scoreQuestion = { ...REPORT.questions[0], kind: 'score' }
    expect(parseClefVerificationReportView({ ...REPORT, questions: [scoreQuestion] })).toBeNull()
  })

  it.each([
    ['top level', { ...REPORT, body: '{"answers":{}}' }],
    ['envelope', { ...REPORT, envelope: { ...REPORT.envelope, raw: 'x' } }],
    ['model', { ...REPORT, model: { ...REPORT.model, url: 'x' } }],
    ['usage', { ...REPORT, usage: { ...REPORT.usage, requestId: 'x' } }],
    ['question', { ...REPORT, questions: [{ ...REPORT.questions[0], text: 'x' }] }]
  ])('rejects an extra field at the %s', (_label, widened) => {
    expect(ClefVerificationReportViewSchema.safeParse(widened).success).toBe(false)
  })
})

describe('clef verify result', () => {
  it('accepts a reported call and a failed call', () => {
    expect(parseClefVerifyResult(REPORTED)).toEqual(REPORTED)
    expect(parseClefVerifyResult(FAILED)).toEqual(FAILED)
  })

  it('accepts a report that cannot be pinned together with its problems', () => {
    const unpinnable: ClefVerifyResult = {
      ...REPORTED,
      pin: { pinnable: false, problems: ['option_ids_not_echoed', 'usage_missing'] }
    }
    expect(parseClefVerifyResult(unpinnable)).toEqual(unpinnable)
  })

  it('refuses a pinnable verdict that lists problems and a refusal that lists none', () => {
    expect(
      parseClefVerifyResult({ ...REPORTED, pin: { pinnable: true, problems: ['usage_missing'] } })
    ).toBeNull()
    expect(
      parseClefVerifyResult({ ...REPORTED, pin: { pinnable: false, problems: [] } })
    ).toBeNull()
  })

  it('lists every pin problem the profile check can report, none of them about scores', () => {
    expect(new Set(CLEF_PROFILE_PROBLEMS).size).toBe(CLEF_PROFILE_PROBLEMS.length)
    expect(CLEF_PROFILE_PROBLEMS).toEqual([
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
    ])
    for (const problem of CLEF_PROFILE_PROBLEMS) {
      const result = { ...REPORTED, pin: { pinnable: false, problems: [problem] } }
      expect(parseClefVerifyResult(result)).not.toBeNull()
    }
  })

  it('rejects an unknown outcome, an unknown problem and extra fields', () => {
    expect(parseClefVerifyResult({ ...REPORTED, outcome: 'ok' })).toBeNull()
    expect(
      parseClefVerifyResult({
        ...REPORTED,
        pin: { pinnable: false, problems: ['looks_wrong'] }
      })
    ).toBeNull()
    expect(parseClefVerifyResult({ ...REPORTED, url: 'https://example.test' })).toBeNull()
    expect(parseClefVerifyResult({ ...FAILED, token: 'FIXTURE_ONLY' })).toBeNull()
  })

  it('rejects a failed call that carries a report and a reported call that carries a blocker', () => {
    expect(parseClefVerifyResult({ ...FAILED, report: REPORT })).toBeNull()
    expect(
      parseClefVerifyResult({
        ...REPORTED,
        blocker: { reason: 'classifier_unavailable', detail: 'interrupted' }
      })
    ).toBeNull()
  })

  // Why: D-022 shows no cost and no budget, so a result from a build that still reported them is refused.
  it('carries no cost and no spend figures', () => {
    const cost = { estimatedInputTokens: 3_000, reservedMicroUsd: 2_100 }
    const spend = { capMicroUsd: 5_000_000, spentMicroUsd: 744, remainingMicroUsd: 4_999_256 }
    expect(parseClefVerifyResult({ ...REPORTED, cost })).toBeNull()
    expect(parseClefVerifyResult({ ...REPORTED, spend })).toBeNull()
    expect(parseClefVerifyResult({ ...FAILED, cost })).toBeNull()
    expect(parseClefVerifyResult({ ...FAILED, spend })).toBeNull()
  })
})

describe('clef profile pin result', () => {
  it('accepts a pinned profile', () => {
    expect(parseClefProfilePinResult(PINNED)).toEqual(PINNED)
  })

  it('rejects an unpinned result, a bad hash and extra fields', () => {
    expect(parseClefProfilePinResult({ ...PINNED, pinned: false })).toBeNull()
    expect(parseClefProfilePinResult({ ...PINNED, profileHash: 'abc' })).toBeNull()
    expect(parseClefProfilePinResult({ ...PINNED, routingStatus: 'connected' })).toBeNull()
    expect(parseClefProfilePinResult({ ...PINNED, path: 'C:\\profile.json' })).toBeNull()
    expect(parseClefProfilePinResult(undefined)).toBeNull()
  })
})
