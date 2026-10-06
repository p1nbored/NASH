import { getClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import type { ClefCallGate } from '../../clef/clef-call-circuit'
import type { ClefCredentialSourcePort } from '../../clef/clef-call-ports'
import type { ClefCredentialGeneration } from '../../clef/clef-credential-generation'
import type { ClefCredentialHandleLike } from '../../clef/clef-endpoint'
import type { ClefSpendRefusal } from '../../clef/clef-spend-ledger'
import { OrchestrationError } from '../orchestration/orchestration-error'

/**
 * Refusals of the verification flow. Each is an `workbench_` error raised before anything is spent
 * or written, so the caller can show a plain message; the messages carry no credential state beyond
 * what the code already says.
 */

export const CLEF_VERIFIER_ERROR_CODES = [
  'workbench_clef_credentials_missing',
  'workbench_clef_credentials_unsealed',
  'workbench_clef_auth_failed',
  'workbench_clef_quota_latched',
  'workbench_clef_circuit_open',
  'workbench_clef_verification_in_progress',
  'workbench_clef_request_invalid',
  'workbench_clef_report_unconfirmed',
  'workbench_clef_report_not_pinnable',
  'workbench_clef_profile_write_failed',
  'workbench_clef_unavailable'
] as const
export type ClefVerifierErrorCode = (typeof CLEF_VERIFIER_ERROR_CODES)[number]

export function clefVerifierError(
  code: ClefVerifierErrorCode,
  message: string
): OrchestrationError {
  return new OrchestrationError(code, message)
}

function missingCredentials(): OrchestrationError {
  return clefVerifierError(
    'workbench_clef_credentials_missing',
    'Save the Clef API token and account id before running verification.'
  )
}

const GATE_REFUSALS = {
  auth_failed: [
    'workbench_clef_auth_failed',
    'Clef rejected the saved credentials. Save new credentials before verifying.'
  ],
  quota_latched: [
    'workbench_clef_quota_latched',
    'Clef reported its quota is used up. Verification is paused until 00:00 UTC.'
  ],
  circuit_open: [
    'workbench_clef_circuit_open',
    'Clef calls are paused after repeated failures. Try again in a few minutes.'
  ]
} as const satisfies Record<
  Extract<ClefCallGate, { allowed: false }>['status'],
  readonly [ClefVerifierErrorCode, string]
>

/** What a ledger refusal means for a verification call; nothing was reserved or sent. */
export function clefSpendRefusalError(refusal: ClefSpendRefusal): OrchestrationError {
  switch (refusal) {
    case 'invalid_estimate':
      return clefVerifierError(
        'workbench_clef_request_invalid',
        'The size of the verification request could not be estimated.'
      )
    // Why unreachable in practice: verification has no request and no retry bound; kept exhaustive.
    case 'request_attempts_exhausted':
    case 'request_id_required':
      return clefVerifierError(
        'workbench_clef_request_invalid',
        'The spend ledger could not record the verification call.'
      )
  }
}

export type VerifiableClef = {
  readonly handle: ClefCredentialHandleLike
  /** Read before the gate and the handle, so the circuit sees the generation that is actually sent. */
  readonly generation: ClefCredentialGeneration
}

type VerifiableDeps = {
  readonly credentials: ClefCredentialSourcePort
}

function requireSealedCredentials(credentials: ClefCredentialSourcePort): void {
  const { protection, tokenPresent, accountPresent } = credentials.status()
  if (protection === 'sealing_unavailable' || protection === 'plaintext_refused') {
    throw clefVerifierError(
      'workbench_clef_credentials_unsealed',
      'The saved Clef credentials are not sealed by the system keyring, so they are not used.'
    )
  }
  if (protection !== 'sealed' || !tokenPresent || !accountPresent) {
    throw missingCredentials()
  }
}

/**
 * The fail-closed preconditions of a verification call, in the order routing's G0 checks them:
 * sealed credentials, then the call circuit; no budget or cost check (D-022). Throws a refusal and
 * spends nothing.
 */
export function requireVerifiableClef(deps: VerifiableDeps): VerifiableClef {
  requireSealedCredentials(deps.credentials)
  const generation = deps.credentials.generation()
  const gate = getClefCallCircuit().gate(generation)
  if (!gate.allowed) {
    const [code, message] = GATE_REFUSALS[gate.status]
    throw clefVerifierError(code, message)
  }
  const handle = deps.credentials.read()
  if (handle === null) {
    throw missingCredentials()
  }
  return { handle, generation }
}
