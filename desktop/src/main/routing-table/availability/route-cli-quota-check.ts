import type { ProviderRateLimits, UsageRateLimitSource } from '../../../shared/rate-limit-types'
import { STALE_THRESHOLD_MS } from '../../rate-limits/service/service-types'
import {
  accountWindowsOf,
  isWindowExhausted,
  type RateLimitHeadroomState
} from './route-provider-headroom'
import type { CheckOutcome, RouteProvider } from './route-availability-types'

/** The CLI feed each provider's reading must come from, and the name recorded as evidence. */
const CLI_FEEDS: Readonly<
  Record<RouteProvider, { readonly source: UsageRateLimitSource; readonly evidence: string }>
> = {
  claude: { source: 'live-session', evidence: 'claude_status_line' },
  codex: { source: 'cli', evidence: 'codex_app_server' },
  agy: { source: 'cli', evidence: 'agy_usage' }
}

// Why error is usable: the service keeps the last windows, and their time, under an error status.
const USABLE_STATUSES: readonly ProviderRateLimits['status'][] = ['ok', 'fetching', 'error']

/** The evidence of a pass that no CLI reading decided; a missing or stale reading never blocks. */
const NOT_METERED: CheckOutcome = { check: 'quota', result: 'pass', evidence: { metered: false } }

function freshCliReading(
  limits: ProviderRateLimits | null,
  provider: RouteProvider,
  nowMs: number
): ProviderRateLimits | null {
  if (
    limits === null ||
    limits.usageMetadata?.source !== CLI_FEEDS[provider].source ||
    !USABLE_STATUSES.includes(limits.status) ||
    !Number.isFinite(limits.updatedAt) ||
    nowMs - limits.updatedAt > STALE_THRESHOLD_MS
  ) {
    return null
  }
  return limits
}

/** The latest reset among the used-up windows; null when any of them names no reset time. */
function resetsAtOf(exhausted: readonly { resetsAt: number | null }[]): number | null {
  let latest = 0
  for (const window of exhausted) {
    if (window.resetsAt === null) {
      return null
    }
    latest = Math.max(latest, window.resetsAt)
  }
  return latest
}

/**
 * The quota check on NASH's CLI readings (user instruction 2026-10-06): a fresh reading from the
 * provider's own CLI at or above 100% of a window blocks with its source and reset time; a fresh
 * reading with headroom passes as observed; anything else passes as not metered.
 */
export function cliQuotaCheckOf(
  provider: RouteProvider,
  state: RateLimitHeadroomState | null,
  nowMs: number
): CheckOutcome {
  const limits = (provider === 'agy' ? state?.antigravity : state?.[provider]) ?? null
  const reading = freshCliReading(limits, provider, nowMs)
  if (reading === null) {
    return NOT_METERED
  }
  const source = CLI_FEEDS[provider].evidence
  const exhausted = accountWindowsOf(reading).filter((window) => isWindowExhausted(window, nowMs))
  if (exhausted.length > 0) {
    return {
      check: 'quota',
      result: 'fail',
      reason: 'quota_exhausted',
      evidence: { source, readingAtMs: reading.updatedAt, resetsAtMs: resetsAtOf(exhausted) }
    }
  }
  return {
    check: 'quota',
    result: 'pass',
    evidence: { observed: true, source, readingAtMs: reading.updatedAt }
  }
}
