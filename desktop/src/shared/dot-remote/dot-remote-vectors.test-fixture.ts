// FIXTURE_ONLY: assembles dot-remote-conformance-vectors.json, which the Site's tests replay.
import { DOT_REMOTE_CONTRACT_VERSION } from './dot-remote-limits'
import { buildDotMcpToolManifest } from './dot-remote-manifest'
import { dotRemoteCanonicalPayload, dotRemotePayloadSha256 } from './dot-remote-payload'
import { SUBMIT_1 } from './dot-remote-vector-flows.test-fixture'
import {
  decisionId,
  messageId,
  payloadOf,
  requestId,
  submitArgs
} from './dot-remote-vector-kit.test-fixture'
import { DOT_REMOTE_ACCESS_VECTORS } from './dot-remote-vectors-access.test-fixture'
import { DOT_REMOTE_ERROR_VECTORS } from './dot-remote-vectors-errors.test-fixture'
import { DOT_REMOTE_PAIRING_VECTORS } from './dot-remote-vectors-pairing.test-fixture'
import { DOT_REMOTE_RACE_VECTORS } from './dot-remote-vectors-races.test-fixture'
import { DOT_REMOTE_READ_TOOL_VECTORS } from './dot-remote-vectors-reads.test-fixture'
import { DOT_REMOTE_RG7_VECTORS } from './dot-remote-vectors-rg7.test-fixture'
import {
  DOT_REMOTE_VALIDATION_CASES,
  DOT_REMOTE_VALIDATION_VECTORS,
  VALIDATION_DECIDE_ARGS
} from './dot-remote-vectors-validations.test-fixture'
import { DOT_REMOTE_WRITE_TOOL_VECTORS } from './dot-remote-vectors-writes.test-fixture'

export type { DotRemoteVector, DotRemoteVectorStep } from './dot-remote-vector-kit.test-fixture'

/** The race and error cases the hosted side must pass besides one accepted call per tool. */
export const DOT_REMOTE_REQUIRED_CASES = [
  'race.repeated_call_same_payload',
  'error.same_key_different_payload',
  'error.expired_never_delivered',
  'error.expired_acked_by_nash',
  'race.duplicate_and_late_events',
  'race.cancel_before_claim',
  'race.cancel_after_claim',
  'race.cancel_after_claim_target_refused',
  'error.wrong_owner',
  'error.wrong_device',
  'error.revoked_generation',
  'error.allow_on_read_only_run',
  'error.allow_refused_by_nash',
  'error.access_above_workspace_maximum',
  'error.tool_input_outside_contract',
  'pairing.refresh_ok',
  'pairing.refresh_rotation',
  'pairing.refresh_reuse_detected',
  'pairing.refresh_lifetime_expired',
  'pairing.refresh_revoked_generation',
  ...DOT_REMOTE_VALIDATION_CASES
] as const

const CONVENTIONS = {
  clock: 'Each step has an at time; the Site under test uses it as the current time for that step.',
  callers:
    'A dot step names the platform user id the identity header carries. A nash step names the device and generation its session resolves to; a serviceOnly step sends only OAI-Sites-Authorization; a refresh step names in deviceCredential the value it sends in the Nash-Device-Credential header. Session tokens and device credentials appear only in pairing vectors, as obviously fake generated values.',
  generated:
    'The Site generates itemId and leaseNonce values, and in pairing vectors the values under generated.pairing. A test harness injects them in the listed order, so expected outputs are exact.',
  expectations:
    'A step expects either result, the exact response body or structuredContent, or error, the exact error body. A tool error is an MCP result with isError true and the error body as structuredContent.',
  paths: 'An endpoint step with itemId fills the {itemId} path parameter of the endpoint.'
}

function hashExample(name: string, payload: Record<string, unknown>) {
  return {
    name,
    payload,
    canonicalJson: dotRemoteCanonicalPayload(payload),
    sha256: dotRemotePayloadSha256(payload)
  }
}

export function buildDotRemoteConformanceVectors() {
  return {
    vectorsVersion: 1,
    contractVersion: DOT_REMOTE_CONTRACT_VERSION,
    manifestSha256: buildDotMcpToolManifest().manifestSha256,
    conventions: CONVENTIONS,
    payloadHashExamples: [
      hashExample('submit with the default access applied', SUBMIT_1),
      hashExample(
        'submit asking for workspace write',
        payloadOf('submit', submitArgs(1, { requestedAccess: 'workspace_write' }))
      ),
      hashExample('cancel', payloadOf('cancel', { dotRequestId: requestId(1) })),
      hashExample(
        'permission answer',
        payloadOf('permission_answer', { decisionId: decisionId(1), decision: 'deny' })
      ),
      hashExample(
        'message with a quoted non-Latin span',
        payloadOf('message', {
          dotRequestId: requestId(1),
          messageId: messageId(2),
          text: 'Use the title "東京ガイド" verbatim.'
        })
      ),
      hashExample('validation decision', payloadOf('validation_decision', VALIDATION_DECIDE_ARGS))
    ],
    vectors: [
      ...DOT_REMOTE_READ_TOOL_VECTORS,
      ...DOT_REMOTE_WRITE_TOOL_VECTORS,
      ...DOT_REMOTE_RACE_VECTORS,
      ...DOT_REMOTE_ERROR_VECTORS,
      ...DOT_REMOTE_ACCESS_VECTORS,
      ...DOT_REMOTE_RG7_VECTORS,
      ...DOT_REMOTE_VALIDATION_VECTORS,
      ...DOT_REMOTE_PAIRING_VECTORS
    ]
  }
}
