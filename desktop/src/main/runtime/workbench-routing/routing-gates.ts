import type { RouteBlocker, RoutingStatus } from '../../../shared/clef/clef-route-contract'

/**
 * The data classes that may leave the machine: an agent-written TaskSpec only (D-016). The gate keeps
 * its own list, apart from the state builder's class, so widening one cannot silently widen the other.
 */
export const G1_ALLOWED_DATA_CLASSES: readonly string[] = ['agent_task_spec']

/** Credential presence and protection only; values never reach the gates. */
export type ClefCredentialGateStatus = 'sealed' | 'missing' | 'not_sealed' | 'sealing_unavailable'

export type ConfigurationGateSnapshot = {
  readonly credentials: ClefCredentialGateStatus
  readonly verifiedProfilePresent: boolean
  readonly responseModelPinned: boolean
}

export type ContentScanResult =
  | { readonly clean: true }
  | { readonly clean: false; readonly matchedRule: string }

export type DataBoundaryGateSnapshot = {
  readonly contentScan: ContentScanResult
  readonly objectiveIsEnglish: boolean
  readonly dataClass: string
}

export type RequestGateSnapshot = ConfigurationGateSnapshot & DataBoundaryGateSnapshot

export type ConfigurationGateResult =
  | { readonly passed: true }
  | {
      readonly passed: false
      readonly gate: 'G0'
      readonly blocker: RouteBlocker
      readonly routingStatus: RoutingStatus
    }

export type DataBoundaryGateResult =
  | { readonly passed: true }
  | {
      readonly passed: false
      readonly gate: 'G1'
      readonly blocker: RouteBlocker
      /** The content-scan rule id that matched; never the matched text. */
      readonly matchedRule: string | null
    }

export type RequestGateResult = ConfigurationGateResult | DataBoundaryGateResult

const PASSED = Object.freeze({ passed: true } as const)

function configurationBlock(
  detail: RouteBlocker['detail'],
  routingStatus: RoutingStatus
): ConfigurationGateResult {
  return {
    passed: false,
    gate: 'G0',
    blocker: { reason: 'classifier_unavailable', detail },
    routingStatus
  }
}

function credentialRoutingStatus(credentials: ClefCredentialGateStatus): RoutingStatus | null {
  switch (credentials) {
    case 'sealed':
      return null
    case 'sealing_unavailable':
      return 'sealing_unavailable'
    case 'missing':
    case 'not_sealed':
      return 'not_configured'
  }
}

/** G0: sealed credentials, verified profile, pinned response model, in order; no spend cap (D-022). */
export function evaluateConfigurationGate(
  snapshot: ConfigurationGateSnapshot
): ConfigurationGateResult {
  const credentialStatus = credentialRoutingStatus(snapshot.credentials)
  if (credentialStatus !== null) {
    return configurationBlock('not_configured', credentialStatus)
  }
  if (!snapshot.verifiedProfilePresent) {
    return configurationBlock('contract_unverified', 'contract_unverified')
  }
  if (!snapshot.responseModelPinned) {
    return configurationBlock('clef_identity_unpinned', 'identity_unpinned')
  }
  return PASSED
}

function dataBoundaryBlock(
  blocker: RouteBlocker,
  matchedRule: string | null
): DataBoundaryGateResult {
  return { passed: false, gate: 'G1', blocker, matchedRule }
}

/** G1: content scan, English objective, allowed data class, in that order. */
export function evaluateDataBoundaryGate(
  snapshot: DataBoundaryGateSnapshot,
  allowedDataClasses: readonly string[] = G1_ALLOWED_DATA_CLASSES
): DataBoundaryGateResult {
  if (!snapshot.contentScan.clean) {
    return dataBoundaryBlock(
      { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      snapshot.contentScan.matchedRule
    )
  }
  if (!snapshot.objectiveIsEnglish) {
    return dataBoundaryBlock({ reason: 'missing_inputs', detail: 'non_english_objective' }, null)
  }
  if (!allowedDataClasses.includes(snapshot.dataClass)) {
    return dataBoundaryBlock(
      { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      null
    )
  }
  return PASSED
}

/** Request-level gates run once before tuple filtering; any failure means no Clef call. */
export function evaluateRequestGates(snapshot: RequestGateSnapshot): RequestGateResult {
  const configuration = evaluateConfigurationGate(snapshot)
  return configuration.passed ? evaluateDataBoundaryGate(snapshot) : configuration
}
