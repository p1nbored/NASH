import type {
  ProviderRateLimits,
  RateLimitState,
  RateLimitWindow
} from '../../../shared/rate-limit-types'
import { STALE_THRESHOLD_MS } from '../../rate-limits/service/service-types'

/** The three provider pools the headroom reading covers; the tuple catalog that owned this type is gone (D-016). */
export type ProviderPool = 'claude' | 'codex' | 'agy'

/** The slice of the rate-limit service state G8b reads; observation only, nothing is reserved. */
export type RateLimitHeadroomState = Pick<RateLimitState, 'claude' | 'codex' | 'antigravity'>

export type ProviderHeadroomReading = {
  /** False only for a pool known to be exhausted; an unobserved pool is not a block. */
  readonly headroom: Readonly<Record<ProviderPool, boolean>>
  /** Pools with no usable reading, in pool order; recorded as evidence on the route. */
  readonly unobserved: readonly ProviderPool[]
}

type PoolObservation = 'headroom' | 'exhausted' | 'unobserved'

const EXHAUSTED_PERCENT = 100
// Why error is usable: Orca keeps the last windows under an error status until they age out.
const USABLE_STATUSES: readonly ProviderRateLimits['status'][] = ['ok', 'fetching', 'error']
const POOLS: readonly ProviderPool[] = ['claude', 'codex', 'agy']

/**
 * Account-wide windows only: a model-specific window such as Claude Fable names no model in the
 * routing bundle, so it cannot decide headroom for the approved slugs.
 */
export function accountWindowsOf(limits: ProviderRateLimits): RateLimitWindow[] {
  return [limits.session, limits.weekly, limits.monthly, ...(limits.buckets ?? [])].filter(
    (window): window is RateLimitWindow => window != null
  )
}

export function isWindowExhausted(window: RateLimitWindow, nowMs: number): boolean {
  // Why: a window whose reset time has passed describes usage that has already rolled over.
  return (
    window.usedPercent >= EXHAUSTED_PERCENT && (window.resetsAt === null || window.resetsAt > nowMs)
  )
}

function isUsable(limits: ProviderRateLimits, nowMs: number): boolean {
  return (
    USABLE_STATUSES.includes(limits.status) &&
    Number.isFinite(limits.updatedAt) &&
    nowMs - limits.updatedAt <= STALE_THRESHOLD_MS
  )
}

/** Only a fresh reading with windows can show exhaustion; anything else is simply not observed. */
function observe(limits: ProviderRateLimits | null, nowMs: number): PoolObservation {
  if (limits === null || !isUsable(limits, nowMs)) {
    return 'unobserved'
  }
  const windows = accountWindowsOf(limits)
  if (windows.length === 0) {
    return 'unobserved'
  }
  return windows.some((window) => isWindowExhausted(window, nowMs)) ? 'exhausted' : 'headroom'
}

export function providerHeadroomFrom(
  state: RateLimitHeadroomState | null,
  nowMs: number
): ProviderHeadroomReading {
  const observations: Readonly<Record<ProviderPool, PoolObservation>> = {
    claude: observe(state?.claude ?? null, nowMs),
    codex: observe(state?.codex ?? null, nowMs),
    agy: observe(state?.antigravity ?? null, nowMs)
  }
  return {
    headroom: {
      claude: observations.claude !== 'exhausted',
      codex: observations.codex !== 'exhausted',
      agy: observations.agy !== 'exhausted'
    },
    unobserved: POOLS.filter((pool) => observations[pool] === 'unobserved')
  }
}
