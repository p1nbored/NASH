import type {
  RouteBlocker,
  RouteBlockerDetail,
  RoutingStatus
} from '../../shared/clef/clef-route-contract'
import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'
import type { ClefVerifiedProfile } from './clef-verified-profile'

/** Presence and protection only; values never reach this module. Null means absent. */
export type ClefCredentialPresence = {
  sealingAvailable: boolean
  token: SecretAtRestProtection | null
  accountId: SecretAtRestProtection | null
}

export type ClefRoutingStatusInput = {
  credentials: ClefCredentialPresence
  profile: ClefVerifiedProfile | null
  latches: {
    /** Set by a 401 or 403 until the credentials change. */
    authFailed: boolean
    /** Set by a 429 until the next 00:00 UTC. */
    quotaUntilMs: number | null
  }
  /** Open until this time; afterwards the next on-demand call half-opens it. */
  circuit: { openUntilMs: number | null }
  lastCallOutcome: 'answered' | RouteBlockerDetail | null
  nowMs: number
}

function isActiveUntil(untilMs: number | null, nowMs: number): boolean {
  return untilMs !== null && nowMs < untilMs
}

function configurationStatus(input: ClefRoutingStatusInput): RoutingStatus | null {
  const { credentials, profile } = input
  // Why first: without a keyring nothing can be sealed or unsealed, so saving credentials cannot help.
  if (!credentials.sealingAvailable) {
    return 'sealing_unavailable'
  }
  // Why plaintext counts as absent: the credential wrapper refuses to read an unsealed envelope.
  if (credentials.token !== 'sealed' || credentials.accountId !== 'sealed') {
    return 'not_configured'
  }
  if (!profile) {
    return 'contract_unverified'
  }
  return profile.expectedResponseModel === null ? 'identity_unpinned' : null
}

/** Fail-closed routing status: configuration gates in G0 order, then latches, circuit and last outcome. */
export function computeClefRoutingStatus(input: ClefRoutingStatusInput): RoutingStatus {
  const configuration = configurationStatus(input)
  if (configuration) {
    return configuration
  }
  if (input.latches.authFailed) {
    return 'auth_failed'
  }
  if (isActiveUntil(input.latches.quotaUntilMs, input.nowMs)) {
    return 'quota_latched'
  }
  if (isActiveUntil(input.circuit.openUntilMs, input.nowMs)) {
    return 'circuit_open'
  }
  return input.lastCallOutcome === 'transient_exhausted' ? 'unreachable' : 'ready'
}

const STATUS_BLOCKER_DETAILS: Readonly<Record<RoutingStatus, RouteBlockerDetail | null>> =
  Object.freeze({
    not_configured: 'not_configured',
    sealing_unavailable: 'not_configured',
    contract_unverified: 'contract_unverified',
    identity_unpinned: 'clef_identity_unpinned',
    ready: null,
    // Why no block: an on-demand trigger may still reach Clef; the circuit decides when to stop trying.
    unreachable: null,
    circuit_open: 'transient_exhausted',
    quota_latched: 'quota_exhausted',
    auth_failed: 'auth_or_account'
  })

/** The pre-call blocker a status imposes, or null when a call may be attempted. */
export function clefRoutingStatusBlocker(status: RoutingStatus): RouteBlocker | null {
  const detail = STATUS_BLOCKER_DETAILS[status]
  return detail === null ? null : { reason: 'classifier_unavailable', detail }
}
