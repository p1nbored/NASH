import { describe, expect, it } from 'vitest'
import type { ClefClassifierQuestions } from './clef-question-set'
import { buildClefRequest } from './clef-request-builder'
import {
  clefResponseProfileBlockerDetail,
  validateClefResponse,
  type ClefResponseProfile
} from './clef-response-validation'
import {
  buildClefVerificationReport,
  type ClefSentRequestSummary
} from './clef-verification-report'
import {
  CLEF_ENVELOPE_MODES,
  clefVerifiedProfileFromReport,
  type ClefEnvelopeMode
} from './clef-verified-profile'
import {
  encodeFixtureJson,
  syntheticCfEnvelope,
  syntheticClefBody
} from './fixtures/synthetic-clef-responses.test-fixture'

// FIXTURE_ONLY: invented schema pins; real ones come from the pinned Cloudflare schema files.
const FIXTURE_ONLY_SCHEMA_PINS = {
  inputSchemaSha256: '1'.repeat(64),
  outputSchemaSha256: '2'.repeat(64),
  docsRevision: 'fixture-only-revision'
}
const VERIFIED_AT = '2026-10-04T12:00:00.000Z'
const HTTP_OK = 200
const ANSWERS = { task_type: 'software_engineering', needs_delegation: 0.82 }

const built = buildClefRequest({ objective: 'Add a retry button to the Workbench queue.' })
if (!built.ok) {
  throw new Error('fixture request must build')
}
const { questions } = built.request.body
const estimate = built.request.estimatedInputTokens

function sentSummary(sent: ClefClassifierQuestions): ClefSentRequestSummary {
  return {
    questions: [
      { id: 'task_type', kind: 'choice', optionIds: Object.keys(sent.task_type.criteria) },
      { id: 'needs_delegation', kind: 'noul' }
    ],
    estimatedInputTokens: estimate
  }
}

function encodeIn(envelope: ClefEnvelopeMode, body: unknown): Uint8Array {
  return encodeFixtureJson(envelope === 'bare' ? body : syntheticCfEnvelope(body))
}

/** A response shaped as the documented output schema. */
function responseBytes(envelope: ClefEnvelopeMode): Uint8Array {
  return encodeIn(envelope, syntheticClefBody(questions, ANSWERS))
}

/** The verification call returns a documented-schema response; then the report and the profile the user would pin. */
function pinnedProfile(envelope: ClefEnvelopeMode) {
  const raw = { status: HTTP_OK, bytes: responseBytes(envelope) }
  const report = buildClefVerificationReport(raw, sentSummary(questions))
  const pinned = clefVerifiedProfileFromReport(report, {
    verifiedAt: VERIFIED_AT,
    schemaPins: FIXTURE_ONLY_SCHEMA_PINS
  })
  if (!pinned.ok) {
    throw new Error(`fixture report must pin, got ${pinned.problems.join(', ')}`)
  }
  return pinned.profile
}

describe('validateClefResponse with a pinned verified profile', () => {
  it.each(CLEF_ENVELOPE_MODES)(
    'validates a %s response under the version 2 profile it pinned, with no score question',
    (envelope) => {
      const profile = pinnedProfile(envelope)
      expect(profile).toMatchObject({ profileVersion: 2, envelopeMode: envelope })
      expect(Object.keys(profile)).not.toContain('scoreKeyForm')
      expect(clefResponseProfileBlockerDetail(profile)).toBeNull()
      const result = validateClefResponse({
        rawBytes: responseBytes(envelope),
        questions,
        estimatedInputTokens: estimate,
        profile
      })
      expect(result.ok).toBe(true)
      expect(result.ok && result.answers.taskType.choice).toBe(ANSWERS.task_type)
      expect(result.ok && result.answers.needsDelegation.value).toBe(ANSWERS.needs_delegation)
    }
  )

  it('accepts the whole verified profile record as the response profile', () => {
    const profile = pinnedProfile('cf_result_wrapper')
    const projection: ClefResponseProfile = profile
    expect(clefResponseProfileBlockerDetail(projection)).toBeNull()
  })

  it('rejects a response pinned under one envelope when the server then uses the other', () => {
    const result = validateClefResponse({
      rawBytes: responseBytes('bare'),
      questions,
      estimatedInputTokens: estimate,
      profile: pinnedProfile('cf_result_wrapper')
    })
    expect(result.ok ? null : result.blocker).toEqual({
      reason: 'invalid_output',
      detail: 'response_schema_violation'
    })
  })
})
