import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import {
  classifyCodexRateLimitWindows,
  CODEX_SESSION_WINDOW_MINUTES,
  CODEX_WEEKLY_WINDOW_MINUTES,
  type CodexRateLimitWindowsSnapshot
} from './codex-rate-limit-window-classification'
import { mapCodexRateLimitWindow } from './codex-rate-limit-window-mapper'

/** The notification `codex app-server` sends whenever the account's rate limits change. */
const RATE_LIMITS_UPDATED = 'account/rateLimits/updated'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The windows an `account/rateLimits/updated` notification carries; null for any other message. */
export function pushedRateLimitsOf(message: unknown): CodexRateLimitWindowsSnapshot | null {
  if (!isRecord(message) || message.method !== RATE_LIMITS_UPDATED || !isRecord(message.params)) {
    return null
  }
  const rateLimits = message.params.rateLimits
  if (!isRecord(rateLimits)) {
    return null
  }
  return {
    primary: isRecord(rateLimits.primary) ? rateLimits.primary : null,
    secondary: isRecord(rateLimits.secondary) ? rateLimits.secondary : null
  }
}

/** A reading built from pushed windows, shaped like the `account/rateLimits/read` answer. */
export function readingFromPushedRateLimits(
  snapshot: CodexRateLimitWindowsSnapshot
): ProviderRateLimits {
  const classified = classifyCodexRateLimitWindows(snapshot)
  return {
    provider: 'codex',
    session: mapCodexRateLimitWindow(classified.session, CODEX_SESSION_WINDOW_MINUTES),
    weekly: mapCodexRateLimitWindow(classified.weekly, CODEX_WEEKLY_WINDOW_MINUTES),
    updatedAt: Date.now(),
    error: null,
    status: 'ok'
  }
}
