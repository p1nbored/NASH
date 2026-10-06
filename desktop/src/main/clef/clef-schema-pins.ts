import { CLEF_CLASSIFIER_QUESTION_IDS } from '../../shared/clef/clef-answers'
import { CLEF_QUESTION_BUNDLE_SHA256 } from './clef-question-set'
import { CLEF_TRUNCATION_INPUT_TOKENS } from './clef-response-validation'
import {
  CLEF_DEFAULT_SUM_TOLERANCE,
  CLEF_ENVELOPE_MODES,
  clefCanonicalSha256,
  type ClefSchemaPins,
  type ClefVerifiedProfileRecord
} from './clef-verified-profile'

/**
 * The schema pins written into a verified profile when the user pins a verification report.
 *
 * They pin this build's own contracts, not Cloudflare's published schema documents (those are not
 * vendored in the repository): the input pin is the hash of the question bundle that is sent, the
 * output pin is the hash of the response contract the validator enforces. A build that changes
 * either no longer matches a profile pinned by an older build, so routing asks for a new
 * verification (spec section 14).
 */

/** The documentation read behind the contracts (decision log B-14, accessed 2026-10-04). */
export const CLEF_DOCS_REVISION = 'workers-ai-clef-docs-2026-10-04'

const CLEF_OUTPUT_CONTRACT = Object.freeze({
  contract: 'clef-output-validation',
  version: 2,
  envelopeModes: CLEF_ENVELOPE_MODES,
  answerTypes: ['choice', 'noul'],
  questionIds: CLEF_CLASSIFIER_QUESTION_IDS,
  defaultSumTolerance: CLEF_DEFAULT_SUM_TOLERANCE,
  truncationInputTokens: CLEF_TRUNCATION_INPUT_TOKENS
})

export const CLEF_SCHEMA_PINS: ClefSchemaPins = Object.freeze({
  inputSchemaSha256: CLEF_QUESTION_BUNDLE_SHA256,
  outputSchemaSha256: clefCanonicalSha256(CLEF_OUTPUT_CONTRACT),
  docsRevision: CLEF_DOCS_REVISION
})

function pinsMatch(left: ClefSchemaPins, right: ClefSchemaPins): boolean {
  return (
    left.inputSchemaSha256 === right.inputSchemaSha256 &&
    left.outputSchemaSha256 === right.outputSchemaSha256 &&
    left.docsRevision === right.docsRevision
  )
}

/** The system code when there is one, else the error class: enough to tell one failure from another. */
function failureKey(error: unknown): string {
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
  return typeof code === 'string' ? code : error instanceof Error ? error.name : 'unknown'
}

/**
 * Wraps the profile file store for the routing gates: a profile pinned against other contracts
 * reads as absent, so G0 reports contract_unverified instead of trusting a stale verification.
 * A file that cannot be read also reads as absent, because list, status and cancel read this on
 * every call and must keep working; the failure is reported once until a read succeeds again.
 */
export function createPinCheckedProfileSource(
  store: { read(): ClefVerifiedProfileRecord | null },
  pins: ClefSchemaPins = CLEF_SCHEMA_PINS,
  onReadError?: (error: unknown) => void
): { read(): ClefVerifiedProfileRecord | null } {
  let reported: string | null = null
  return {
    read() {
      let record: ClefVerifiedProfileRecord | null
      try {
        record = store.read()
      } catch (error) {
        const key = failureKey(error)
        if (reported !== key) {
          reported = key
          onReadError?.(error)
        }
        return null
      }
      reported = null
      return record !== null && pinsMatch(record.profile.schemaPins, pins) ? record : null
    }
  }
}
