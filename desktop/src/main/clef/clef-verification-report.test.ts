import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildClefVerificationReport,
  type ClefSentRequestSummary
} from './clef-verification-report'
import {
  ClefVerifiedProfileSchema,
  clefVerificationReportSha256,
  clefVerifiedProfileFromReport
} from './clef-verified-profile'

// FIXTURE_ONLY: fake credential shapes so the redaction checks exercise real-looking values.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'
const FIXTURE_ONLY_URL = `https://api.cloudflare.com/client/v4/accounts/${FIXTURE_ONLY_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`

const TASK_TYPES = [
  'coordinator_reasoning',
  'complex_planning_reasoning',
  'software_engineering',
  'scientific_experiment_validation',
  'complex_pdf_evidence_analysis',
  'general_research_analysis',
  'routine_analysis_batch',
  'high_quality_writing',
  'fast_writing_or_alternative_draft',
  'configured_project_workflow',
  'needs_clarification'
]

const sent: ClefSentRequestSummary = {
  questions: [
    { id: 'task_type', kind: 'choice', optionIds: TASK_TYPES },
    { id: 'needs_delegation', kind: 'noul' }
  ],
  estimatedInputTokens: 1_000
}

function spread(keys: readonly string[], winner: string): Record<string, number> {
  const rest = Number((0.2 / (keys.length - 1)).toFixed(6))
  const entries = keys.map((key) => [key, key === winner ? 0 : rest] as const)
  const sumRest = entries.reduce((total, [, value]) => total + value, 0)
  return Object.fromEntries(
    entries.map(([key, value]) => [key, key === winner ? Number((1 - sumRest).toFixed(6)) : value])
  )
}

/** Answers in the documented output schema (spec: type plus choice or noul). */
function clefAnswers(): Record<string, unknown> {
  return {
    task_type: {
      type: 'choice',
      choice: 'software_engineering',
      probabilities: spread(TASK_TYPES, 'software_engineering'),
      confidence: 0.7
    },
    needs_delegation: { type: 'noul', noul: 0.9 }
  }
}

function clefBody(): Record<string, unknown> {
  return {
    model: '@cf/cloudflare/clef',
    answers: clefAnswers(),
    usage: { input_tokens: 1_200, output_tokens: 40 }
  }
}

function wrapped(body: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { result: body, success: true, errors: [], messages: [], ...extra }
}

function respond(json: unknown, status = 200) {
  return { status, bytes: new TextEncoder().encode(JSON.stringify(json)) }
}

const VERIFIED_AT = '2026-10-04T12:00:00.000Z'
const SCHEMA_PINS = {
  inputSchemaSha256: '9f6014fdb6f1d3cc32e1f8d01262b9f137743f0590402940c28f8a45114cb683',
  outputSchemaSha256: 'cd1e3d0ecbfa98b5b888b673ffa52587dbf920a12b3e19233c9be90f37b48865',
  docsRevision: 'ef0b61b412a348cf84e2f54eb821b12130b46164'
}

describe('clef verification report', () => {
  it('describes a successful wrapped response structurally', () => {
    const raw = respond(wrapped(clefBody()))
    const report = buildClefVerificationReport(raw, sent)
    expect(report).toMatchObject({
      reportVersion: 2,
      httpStatus: 200,
      rawSha256: createHash('sha256').update(raw.bytes).digest('hex'),
      rawByteLength: raw.bytes.byteLength,
      bodyKind: 'json_object',
      envelope: {
        shape: 'cf_result_wrapper',
        success: true,
        errorCount: 0,
        messageCount: 0,
        topLevelKeys: ['errors', 'messages', 'result', 'success'],
        withheldKeyCount: 0
      },
      model: { observed: '@cf/cloudflare/clef', withheld: false },
      answerKeys: { matchQuestionIds: true, missing: [], extraCount: 0 },
      optionIdEcho: 'exact',
      usage: {
        inputTokens: 1_200,
        outputTokens: 40,
        estimatedInputTokens: 1_000,
        inputToEstimateRatio: 1.2
      }
    })
    const taskType = report.questions.find((question) => question.id === 'task_type')
    expect(taskType).toEqual({
      id: 'task_type',
      kind: 'choice',
      present: true,
      answerFieldNames: ['choice', 'confidence', 'probabilities', 'type'],
      keyCoverage: { expected: 11, observed: 11, missing: 0, extra: 0 },
      probabilitySum: 1,
      sumDeviation: 0,
      maxFractionDigits: 2,
      valuesInRange: true
    })
    expect(report.questions.find((question) => question.id === 'needs_delegation')).toMatchObject({
      present: true,
      keyCoverage: null,
      valuesInRange: true
    })
  })

  it('has no score fields at all', () => {
    const report = buildClefVerificationReport(respond(wrapped(clefBody())), sent)
    expect(Object.keys(report)).not.toContain('scoreKeyForm')
    expect(Object.keys(report)).not.toContain('scoreLegendKeyForm')
    expect(report.questions.map((question) => question.kind)).toEqual(['choice', 'noul'])
  })

  it('never carries the URL, token or account id even when the server echoes them', () => {
    const body = { ...clefBody(), [FIXTURE_ONLY_ACCOUNT_ID]: FIXTURE_ONLY_TOKEN }
    const raw = respond(
      wrapped(body, {
        messages: [{ message: `${FIXTURE_ONLY_URL} Bearer ${FIXTURE_ONLY_TOKEN}` }],
        [`accounts_${FIXTURE_ONLY_ACCOUNT_ID}`]: FIXTURE_ONLY_URL
      })
    )
    const text = JSON.stringify(buildClefVerificationReport(raw, sent))
    expect(text).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    expect(text).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(text).not.toContain('api.cloudflare.com')
    expect(buildClefVerificationReport(raw, sent).envelope.withheldKeyCount).toBe(2)
  })

  it.each([
    '@cf/cloudflare/clef',
    '@cf/cloudflare/clef-flash',
    '@cf/vendor-1/model.v2-name',
    'clef',
    'clef-flash'
  ])('reports the documented model form %s', (model) => {
    const report = buildClefVerificationReport(respond(wrapped({ ...clefBody(), model })), sent)
    expect(report.model).toEqual({ observed: model, withheld: false })
  })

  it.each([
    ['the fixture token', FIXTURE_ONLY_TOKEN],
    ['an account id inside a path', `@cf/${FIXTURE_ONLY_ACCOUNT_ID}/clef`],
    ['a space', 'a b'],
    ['a 20 character lowercase token', 'abcdefghij0123456789'],
    ['a 24 character mixed token', 'Ab12Cd34Ef56Gh78Ij90Kl12'],
    ['a dotted token with short segments', 'abc123.def456.ghi789'],
    ['a JWT-like token', 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM'],
    ['a bare hex account id', FIXTURE_ONLY_ACCOUNT_ID],
    ['a path ending in a token', `@cf/cloudflare/${FIXTURE_ONLY_TOKEN}`],
    ['a trailing newline', '@cf/cloudflare/clef\n'],
    ['upper case letters', '@cf/Cloudflare/Clef'],
    ['a vendor over 40 characters', `@cf/${'a'.repeat(41)}/clef`],
    ['a name over 60 characters', `@cf/cloudflare/c${'a'.repeat(60)}`],
    ['a name that starts with a digit', '@cf/cloudflare/0clef'],
    ['a look-alike unicode letter', '@cf/cloudflare/clеf'],
    ['a bare unlisted name', 'some-other-model'],
    ['a number', 5],
    ['an object', { name: 'clef' }]
  ])('withholds a model value that is %s', (_label, model) => {
    const report = buildClefVerificationReport(respond(wrapped({ ...clefBody(), model })), sent)
    expect(report.model).toEqual({ observed: null, withheld: true })
    expect(JSON.stringify(report)).not.toContain(FIXTURE_ONLY_TOKEN)
  })

  it('copies no server string value into the report', () => {
    const marker = 'SERVER_TEXT_MARKER'
    const answers = clefAnswers()
    const body = {
      model: '@cf/cloudflare/clef',
      usage: { input_tokens: 1_200, output_tokens: 40, note: marker },
      answers: {
        ...answers,
        task_type: {
          type: 'choice',
          choice: marker,
          probabilities: spread(TASK_TYPES, 'software_engineering'),
          confidence: 0.7,
          rationale: marker
        },
        needs_delegation: { type: 'noul', noul: 0.9, explanation: marker }
      },
      trace: marker
    }
    const raw = respond(
      wrapped(body, { messages: [{ message: marker }], errors: [{ message: marker }] })
    )
    expect(JSON.stringify(buildClefVerificationReport(raw, sent))).not.toContain(marker)
  })

  it('reports a missing model as absent, not withheld', () => {
    const missing = buildClefVerificationReport(
      respond(wrapped({ ...clefBody(), model: undefined })),
      sent
    )
    expect(missing.model).toEqual({ observed: null, withheld: false })
  })

  it('reads a bare body at the top level', () => {
    const report = buildClefVerificationReport(respond(clefBody()), sent)
    expect(report.envelope).toMatchObject({ shape: 'bare', success: null, errorCount: null })
    expect(report.optionIdEcho).toBe('exact')
  })

  it('reports non-JSON, invalid UTF-8 and non-object bodies', () => {
    const notJson = buildClefVerificationReport(
      { status: 502, bytes: new TextEncoder().encode('<html>') },
      sent
    )
    expect(notJson).toMatchObject({ bodyKind: 'not_json', envelope: { shape: 'unrecognized' } })
    expect(
      buildClefVerificationReport({ status: 200, bytes: Uint8Array.of(0xff, 0xfe) }, sent).bodyKind
    ).toBe('not_json')
    expect(buildClefVerificationReport(respond([1, 2]), sent).bodyKind).toBe('json_other')
    expect(buildClefVerificationReport(respond({ other: 1 }), sent).envelope.shape).toBe(
      'unrecognized'
    )
  })

  it('detects altered option ids and missing or extra answers', () => {
    const body = clefBody()
    const answers = clefAnswers()
    const altered = {
      ...body,
      answers: {
        ...answers,
        task_type: { choice: 'x', probabilities: { software_engineering_x: 0.7, other: 0.3 } },
        needs_delegation: undefined,
        surprise: { value: 1 }
      }
    }
    const report = buildClefVerificationReport(respond(wrapped(altered)), sent)
    expect(report.optionIdEcho).toBe('altered')
    expect(report.answerKeys).toEqual({
      matchQuestionIds: false,
      missing: ['needs_delegation'],
      extraCount: 1
    })
    expect(report.questions.find((question) => question.id === 'task_type')?.keyCoverage).toEqual({
      expected: 11,
      observed: 2,
      missing: 11,
      extra: 2
    })
  })

  it('detects an answer that still carries the removed route or score questions', () => {
    const answers = { ...clefAnswers(), route: { type: 'choice' }, difficulty: { type: 'score' } }
    const report = buildClefVerificationReport(respond(wrapped({ ...clefBody(), answers })), sent)
    expect(report.answerKeys).toEqual({ matchQuestionIds: false, missing: [], extraCount: 2 })
  })

  it('records probability precision, sum deviation and out-of-range values', () => {
    const body = clefBody()
    const answers = clefAnswers()
    const skewed = {
      ...body,
      answers: {
        ...answers,
        task_type: {
          choice: 'software_engineering',
          probabilities: {
            ...Object.fromEntries(TASK_TYPES.map((id) => [id, 0])),
            coordinator_reasoning: 0.1234,
            software_engineering: 0.8566,
            complex_planning_reasoning: 1.5e-7
          }
        },
        needs_delegation: { type: 'noul', noul: 1.4 }
      }
    }
    const report = buildClefVerificationReport(respond(wrapped(skewed)), sent)
    const taskType = report.questions.find((question) => question.id === 'task_type')
    expect(taskType?.maxFractionDigits).toBe(8)
    expect(taskType?.sumDeviation).toBeCloseTo(0.02, 6)
    expect(report.maxSumDeviation).toBeCloseTo(0.02, 6)
    expect(
      report.questions.find((question) => question.id === 'needs_delegation')?.valuesInRange
    ).toBe(false)
  })

  it.each([
    ['a value in range', { type: 'noul', noul: 0.9 }, true],
    ['the lower bound', { type: 'noul', noul: 0 }, true],
    ['the upper bound', { type: 'noul', noul: 1 }, true],
    ['a value below zero', { type: 'noul', noul: -0.1 }, false],
    ['a value above one', { type: 'noul', noul: 1.0001 }, false],
    ['the undocumented value field', { type: 'noul', value: 0.9 }, false],
    ['the undocumented value field alone', { value: 0.9 }, false],
    ['a noul with the wrong answer type', { type: 'choice', noul: 0.9 }, false],
    ['a noul without a type', { noul: 0.9 }, false],
    ['a numeric string', { type: 'noul', noul: '0.9' }, false],
    ['a null value', { type: 'noul', noul: null }, false],
    ['a bare number', 0.9, false],
    ['an empty object', {}, false]
  ])('reads a noul answer only in the documented shape: %s', (_label, answer, inRange) => {
    const body = { ...clefBody(), answers: { ...clefAnswers(), needs_delegation: answer } }
    const report = buildClefVerificationReport(respond(wrapped(body)), sent)
    const noul = report.questions.find((question) => question.id === 'needs_delegation')
    expect(noul).toMatchObject({ present: true, keyCoverage: null, valuesInRange: inRange })
  })

  it('reports an absent noul answer as not present, with no range verdict', () => {
    const body = { ...clefBody(), answers: { ...clefAnswers(), needs_delegation: undefined } }
    const report = buildClefVerificationReport(respond(wrapped(body)), sent)
    expect(report.questions.find((question) => question.id === 'needs_delegation')).toMatchObject({
      present: false,
      valuesInRange: null
    })
  })

  it('reports usage as missing when it is malformed', () => {
    const body = { ...clefBody(), usage: { input_tokens: -3, output_tokens: 'x' } }
    const report = buildClefVerificationReport(respond(wrapped(body)), sent)
    expect(report.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      estimatedInputTokens: 1_000,
      inputToEstimateRatio: null
    })
  })

  it('hashes the report canonically', () => {
    const report = buildClefVerificationReport(respond(wrapped(clefBody())), sent)
    expect(clefVerificationReportSha256(report)).toMatch(/^[0-9a-f]{64}$/)
    expect(clefVerificationReportSha256({ ...report })).toBe(clefVerificationReportSha256(report))
  })
})

describe('clef verified profile from report', () => {
  it('pins a report that has no score question at all', () => {
    const report = buildClefVerificationReport(respond(wrapped(clefBody())), sent)
    expect(Object.keys(report)).not.toContain('scoreKeyForm')
    const result = clefVerifiedProfileFromReport(report, {
      verifiedAt: VERIFIED_AT,
      schemaPins: SCHEMA_PINS
    })
    expect(result).toEqual({
      ok: true,
      profile: {
        profileVersion: 2,
        envelopeMode: 'cf_result_wrapper',
        expectedResponseModel: '@cf/cloudflare/clef',
        optionKeyForm: 'sent_option_id',
        sumTolerance: 1e-3,
        verifiedAt: VERIFIED_AT,
        reportSha256: clefVerificationReportSha256(report),
        schemaPins: SCHEMA_PINS
      }
    })
    if (result.ok) {
      expect(ClefVerifiedProfileSchema.safeParse(result.profile).success).toBe(true)
    }
  })

  it('never reports a score problem, because no score question is sent', () => {
    const broken = buildClefVerificationReport(
      respond(wrapped({ model: FIXTURE_ONLY_TOKEN, answers: {} }, { success: false }), 500),
      sent
    )
    const result = clefVerifiedProfileFromReport(broken, {
      verifiedAt: VERIFIED_AT,
      schemaPins: SCHEMA_PINS
    })
    expect(result.ok).toBe(false)
    const problems = result.ok ? [] : result.problems
    expect(problems.filter((problem) => problem.startsWith('score_'))).toEqual([])
  })

  it('refuses to pin a clef-flash identity or an invalid pin', () => {
    const flash = buildClefVerificationReport(
      respond(wrapped({ ...clefBody(), model: '@cf/cloudflare/clef-flash' })),
      sent
    )
    expect(
      clefVerifiedProfileFromReport(flash, { verifiedAt: VERIFIED_AT, schemaPins: SCHEMA_PINS })
    ).toEqual({ ok: false, problems: ['response_model_disallowed'] })
    const clean = buildClefVerificationReport(respond(wrapped(clefBody())), sent)
    expect(
      clefVerifiedProfileFromReport(clean, { verifiedAt: 'today', schemaPins: SCHEMA_PINS })
    ).toEqual({ ok: false, problems: ['pin_invalid'] })
  })

  it('refuses to pin when a noul answer uses the undocumented value field', () => {
    const answers = { ...clefAnswers(), needs_delegation: { type: 'noul', value: 0.9 } }
    const report = buildClefVerificationReport(respond(wrapped({ ...clefBody(), answers })), sent)
    expect(
      clefVerifiedProfileFromReport(report, { verifiedAt: VERIFIED_AT, schemaPins: SCHEMA_PINS })
    ).toEqual({ ok: false, problems: ['probability_out_of_range'] })
  })

  it('refuses to pin when the server alters the sent option ids', () => {
    const answers = {
      ...clefAnswers(),
      task_type: { choice: 'x', probabilities: { other: 1 }, type: 'choice', confidence: 0.5 }
    }
    const report = buildClefVerificationReport(respond(wrapped({ ...clefBody(), answers })), sent)
    const result = clefVerifiedProfileFromReport(report, {
      verifiedAt: VERIFIED_AT,
      schemaPins: SCHEMA_PINS
    })
    expect(result.ok === false && result.problems).toContain('option_ids_not_echoed')
  })

  it('lists every problem that blocks pinning', () => {
    const answers = clefAnswers()
    const broken = {
      model: FIXTURE_ONLY_TOKEN,
      answers: {
        ...answers,
        task_type: { choice: 'x', probabilities: { other: 0.5 } },
        needs_delegation: { type: 'noul', noul: 2 }
      }
    }
    const report = buildClefVerificationReport(
      respond(wrapped(broken, { success: false, errors: [{ code: 1 }] }), 500),
      sent
    )
    const result = clefVerifiedProfileFromReport(report, {
      verifiedAt: VERIFIED_AT,
      schemaPins: SCHEMA_PINS
    })
    expect(result).toEqual({
      ok: false,
      problems: [
        'http_status',
        'envelope_not_successful',
        'response_model_unobserved',
        'option_ids_not_echoed',
        'probability_out_of_range',
        'probability_sum_out_of_tolerance',
        'usage_missing'
      ]
    })
    const unrecognized = buildClefVerificationReport(respond({ other: 1 }), sent)
    const second = clefVerifiedProfileFromReport(unrecognized, {
      verifiedAt: VERIFIED_AT,
      schemaPins: SCHEMA_PINS
    })
    expect(second.ok === false && second.problems.slice(0, 2)).toEqual([
      'envelope_unrecognized',
      'response_model_unobserved'
    ])
  })
})
