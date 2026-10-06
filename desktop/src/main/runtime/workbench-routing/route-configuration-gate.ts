import type { ClefCredentialStatus } from '../../clef/clef-credential-port'
import { clefResponseProfileBlockerDetail } from '../../clef/clef-response-validation'
import type { ClefVerifiedProfileRecord } from '../../clef/clef-verified-profile'
import {
  evaluateConfigurationGate,
  type ClefCredentialGateStatus,
  type ConfigurationGateResult,
  type ConfigurationGateSnapshot
} from './routing-gates'

/** The local, network-free state G0 reads; the classifier and the status view share it. */
export type RouteConfigurationDeps = {
  readonly credentials: { status(): ClefCredentialStatus }
  readonly verifiedProfile: { read(): ClefVerifiedProfileRecord | null }
}

type ConfigurationBlock = Extract<ConfigurationGateResult, { passed: false }>

/** G0 passed, with the verified profile it passed on, so later stages need no second read. */
export type ConfiguredClef =
  | { readonly passed: true; readonly profile: ClefVerifiedProfileRecord }
  | ConfigurationBlock

const CONTRACT_UNVERIFIED = Object.freeze<ConfigurationBlock>({
  passed: false,
  gate: 'G0',
  blocker: { reason: 'classifier_unavailable', detail: 'contract_unverified' },
  routingStatus: 'contract_unverified'
})

function credentialGateStatus(status: ClefCredentialStatus): ClefCredentialGateStatus {
  switch (status.protection) {
    case 'sealing_unavailable':
      return 'sealing_unavailable'
    case 'plaintext_refused':
      return 'not_sealed'
    case 'absent':
      return 'missing'
    case 'sealed':
      return status.tokenPresent && status.accountPresent ? 'sealed' : 'missing'
  }
}

function gateSnapshot(
  deps: Omit<RouteConfigurationDeps, 'verifiedProfile'>,
  record: ClefVerifiedProfileRecord | null
): ConfigurationGateSnapshot {
  // Why: the response-model pin is read through the validator's own profile check, so G0 and the
  // validator can never disagree about what a usable profile is.
  const profileDetail = clefResponseProfileBlockerDetail(record?.profile ?? null)
  return {
    credentials: credentialGateStatus(deps.credentials.status()),
    verifiedProfilePresent: profileDetail !== 'contract_unverified',
    responseModelPinned: profileDetail === null
  }
}

/** G0 over a profile the caller already read: sealed credentials, pinned profile and model. */
export function evaluateClefConfiguration(
  deps: Omit<RouteConfigurationDeps, 'verifiedProfile'>,
  record: ClefVerifiedProfileRecord | null
): ConfiguredClef {
  const result = evaluateConfigurationGate(gateSnapshot(deps, record))
  if (!result.passed) {
    return result
  }
  // Why: a passed gate implies a record; this keeps the type honest without an assertion.
  return record === null ? CONTRACT_UNVERIFIED : { passed: true, profile: record }
}

/** G0 on its own: reads the profile itself and reports only pass or the block. */
export function readClefConfigurationGate(deps: RouteConfigurationDeps): ConfigurationGateResult {
  const configured = evaluateClefConfiguration(deps, deps.verifiedProfile.read())
  return configured.passed ? { passed: true } : configured
}
