import type {
  ProviderRateLimits,
  UsageRateLimitFailureKind
} from '../../../shared/rate-limit-types'
import { STALE_THRESHOLD_MS } from '../../rate-limits/service/service-types'
import { providerHeadroomFrom, type RateLimitHeadroomState } from './route-provider-headroom'
import type { CheckOutcome, LiveRunPrimary, RouteProvider } from './route-availability-types'
import type { RouteObservations } from './route-check-observations'

/** The rate-limit reading behind a route's provider; agy is Orca's `antigravity`. */
export function limitsForProvider(
  state: RateLimitHeadroomState | null,
  provider: RouteProvider
): ProviderRateLimits | null {
  if (state === null) {
    return null
  }
  return provider === 'agy' ? state.antigravity : state[provider]
}

/** Failure kinds that mean the login itself is unusable, as Orca's usage service classifies them. */
const AUTH_FAILURE_KINDS: readonly UsageRateLimitFailureKind[] = [
  'missing-credentials',
  'stale-token',
  'refreshable-credentials-without-token',
  'delegated-refresh-required',
  'keychain-unavailable',
  'missing-scope'
]

/** The evidence basis of an auth pass inherited from the run's live primary session. */
export const AUTH_INHERITED_BASIS = 'auth_inherited_from_live_primary'

const UNOBSERVED: CheckOutcome = { check: 'auth', result: 'unobserved', reason: 'auth_unobserved' }

function isFreshSuccess(limits: ProviderRateLimits, nowMs: number): boolean {
  return (
    limits.status === 'ok' &&
    Number.isFinite(limits.updatedAt) &&
    nowMs - limits.updatedAt <= STALE_THRESHOLD_MS
  )
}

/**
 * Authentication from the usage reading: a fresh success proves a working login, a login-class
 * failure disproves it, and everything else (network, throttling, no reading) proves nothing.
 * Only the failure kind is recorded: the reading's error text can carry account identifiers.
 * When Orca defers the Claude usage read behind a live session, a route that runs inside that session
 * (the caller passes the evidence) inherits its login; that pass says where it came from.
 */
export function authCheckOf(
  limits: ProviderRateLimits | null,
  nowMs: number,
  livePrimary: LiveRunPrimary | null = null
): CheckOutcome {
  if (limits === null) {
    return UNOBSERVED
  }
  if (isFreshSuccess(limits, nowMs)) {
    return { check: 'auth', result: 'pass' }
  }
  const kind = limits.usageMetadata?.failureKind
  if (limits.status !== 'error' && limits.status !== 'unavailable') {
    return UNOBSERVED
  }
  if (kind === 'deferred-by-live-session' && livePrimary !== null) {
    return {
      check: 'auth',
      result: 'pass',
      evidence: {
        basis: AUTH_INHERITED_BASIS,
        runId: livePrimary.runId,
        ownerId: livePrimary.ownerId
      }
    }
  }
  if (kind === 'no-subscription') {
    return {
      check: 'auth',
      result: 'fail',
      reason: 'not_entitled',
      evidence: { failureKind: kind }
    }
  }
  if (kind !== undefined && AUTH_FAILURE_KINDS.includes(kind)) {
    return {
      check: 'auth',
      result: 'fail',
      reason: 'auth_failed',
      evidence: { failureKind: kind }
    }
  }
  return UNOBSERVED
}

/** Only a known exhausted account window blocks; a missing or old reading is recorded, not a block. */
export function quotaCheckOf(
  provider: RouteProvider,
  state: RateLimitHeadroomState | null,
  nowMs: number
): CheckOutcome {
  const reading = providerHeadroomFrom(state, nowMs)
  const pool = provider
  if (!reading.headroom[pool]) {
    return { check: 'quota', result: 'fail', reason: 'quota_exhausted' }
  }
  return {
    check: 'quota',
    result: 'pass',
    evidence: { observed: !reading.unobserved.includes(pool) }
  }
}

/** Authentication and quota use the host's native provider readings. */
export function authQuotaChecksOf(
  provider: RouteProvider,
  observations: Pick<RouteObservations, 'rateLimits' | 'nowMs'>,
  livePrimary: LiveRunPrimary | null = null
): readonly [CheckOutcome, CheckOutcome] {
  const { rateLimits, nowMs } = observations
  return [
    authCheckOf(limitsForProvider(rateLimits, provider), nowMs, livePrimary),
    quotaCheckOf(provider, rateLimits, nowMs)
  ]
}
