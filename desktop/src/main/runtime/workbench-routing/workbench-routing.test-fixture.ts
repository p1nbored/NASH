// FIXTURE_ONLY: synthetic ports and records for Workbench routing tests; production code never imports this.
// Every credential, account and model value is invented; nothing here reaches a network or a real store.

import { ClefCredentialGeneration } from '../../clef/clef-credential-generation'
import type { ClefCredentialStatus } from '../../clef/clef-credential-port'
import type { ClefCredentialHandleLike } from '../../clef/clef-endpoint'
import {
  clefVerifiedProfileHash,
  type ClefVerifiedProfile,
  type ClefVerifiedProfileRecord
} from '../../clef/clef-verified-profile'
import { buildClefRequest, type BuiltClefRequest } from '../../clef/clef-request-builder'
import type { ClefClassifierQuestions } from '../../clef/clef-question-set'
import {
  DEFAULT_SYNTHETIC_ANSWERS,
  encodeFixtureJson,
  syntheticCfEnvelope,
  syntheticClefBody,
  type SyntheticAnswerValues,
  type SyntheticClefBody
} from '../../clef/fixtures/synthetic-clef-responses.test-fixture'

export const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
export const FIXTURE_ONLY_BEARER = 'Bearer fixture-only-clef-token-0000'
export const FIXTURE_ONLY_RESPONSE_MODEL = '@cf/cloudflare/clef'
export const FIXTURE_ONLY_NOW_MS = Date.parse('2026-10-04T12:00:00.000Z')

export const FIXTURE_ONLY_SEALED_STATUS: ClefCredentialStatus = {
  tokenPresent: true,
  accountPresent: true,
  protection: 'sealed'
}

/** A handle-shaped object; the transport fake never reads the values. */
export const FIXTURE_ONLY_CREDENTIAL_HANDLE: ClefCredentialHandleLike = {
  authorizationHeader: () => FIXTURE_ONLY_BEARER,
  accountPath: () => `accounts/${FIXTURE_ONLY_ACCOUNT_ID}`
}

export type FixtureCredentialPort = {
  status(): ClefCredentialStatus
  read(): ClefCredentialHandleLike | null
  generation(): ClefCredentialGeneration
  /** Test control: replaces the generation, as a credential save or clear does. */
  rotate(): ClefCredentialGeneration
  setStatus(status: ClefCredentialStatus): void
  setHandle(handle: ClefCredentialHandleLike | null): void
}

export function fixtureCredentialPort(): FixtureCredentialPort {
  let status = FIXTURE_ONLY_SEALED_STATUS
  let handle: ClefCredentialHandleLike | null = FIXTURE_ONLY_CREDENTIAL_HANDLE
  let generation = ClefCredentialGeneration.mint()
  return {
    status: () => status,
    read: () => handle,
    generation: () => generation,
    rotate() {
      generation = ClefCredentialGeneration.mint()
      return generation
    },
    setStatus(next) {
      status = next
    },
    setHandle(next) {
      handle = next
    }
  }
}

export function fixtureVerifiedProfile(
  overrides: Partial<ClefVerifiedProfile> = {}
): ClefVerifiedProfile {
  return {
    profileVersion: 2,
    envelopeMode: 'cf_result_wrapper',
    expectedResponseModel: FIXTURE_ONLY_RESPONSE_MODEL,
    optionKeyForm: 'sent_option_id',
    sumTolerance: 1e-3,
    verifiedAt: '2026-10-04T11:00:00.000Z',
    reportSha256: 'a'.repeat(64),
    schemaPins: {
      inputSchemaSha256: 'b'.repeat(64),
      outputSchemaSha256: 'c'.repeat(64),
      docsRevision: '2026-10-04'
    },
    ...overrides
  }
}

export function fixtureProfileRecord(
  overrides: Partial<ClefVerifiedProfile> = {}
): ClefVerifiedProfileRecord {
  const profile = fixtureVerifiedProfile(overrides)
  return { profile, profileHash: clefVerifiedProfileHash(profile) }
}

export const FIXTURE_ONLY_OBJECTIVE = 'Add a retry button to the Workbench queue.'

export function fixtureBuiltRequest(objective = FIXTURE_ONLY_OBJECTIVE): BuiltClefRequest {
  const built = buildClefRequest({ objective })
  if (!built.ok) {
    throw new Error(`fixture request must build: ${built.blocker.detail}`)
  }
  return built.request
}

function sentQuestions(body: Uint8Array): ClefClassifierQuestions {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FIXTURE_ONLY; the body was serialized from a ClefRequestBody that carries these questions.
  return (parsed as { questions: ClefClassifierQuestions }).questions
}

export type FixtureClefAnswer = {
  /** The task type Clef chooses and the probability it gives to needing a separate executor. */
  readonly choices?: Partial<SyntheticAnswerValues>
  /** Edits the synthetic body before it is wrapped, to build invalid or ambiguous answers. */
  readonly edit?: (body: SyntheticClefBody) => unknown
  readonly envelope?: 'cf_result_wrapper' | 'bare'
}

/** Response bytes that answer the questions inside `requestBody`, as a live Clef reply would. */
export function fixtureClefResponseBytes(
  requestBody: Uint8Array,
  answer: FixtureClefAnswer = {}
): Uint8Array {
  const body = syntheticClefBody(sentQuestions(requestBody), {
    ...DEFAULT_SYNTHETIC_ANSWERS,
    ...answer.choices
  })
  const edited = answer.edit ? answer.edit(body) : body
  return encodeFixtureJson(answer.envelope === 'bare' ? edited : syntheticCfEnvelope(edited))
}
