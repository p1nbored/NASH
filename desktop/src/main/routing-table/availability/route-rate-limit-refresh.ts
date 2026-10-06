import type { RateLimitHeadroomState } from './route-provider-headroom'

/** Covers Claude's 10 s usage request; the full service cycle can run far longer than a route may wait. */
export const RATE_LIMIT_REFRESH_WAIT_MS = 12_000
/** Bounds the refresh rate when Orca's own debounce does not hold (a hidden meter or a gated provider). */
export const RATE_LIMIT_REFRESH_MIN_INTERVAL_MS = 60_000

export type BoundedRateLimitReadOptions = {
  /** Orca's refresh; its result is ignored because the state is always read afterwards. */
  refresh(): Promise<unknown>
  read(): RateLimitHeadroomState | null
  now(): number
  waitMs?: number
  minIntervalMs?: number
}

/** Resolves when the work settles, the wait limit passes or the signal aborts; never rejects. */
function settlesWithin(work: Promise<void>, waitMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, waitMs)
    signal.addEventListener('abort', finish, { once: true })
    void work.then(finish)
  })
}

/**
 * The rate-limit read behind G8b: one shared refresh at a time, at most one per interval, a
 * bounded wait that stops on abort, and always the current state afterwards. A refresh that fails
 * or is skipped leaves the previous state, which the headroom reading then judges as it is.
 */
export function createBoundedRateLimitRead(
  options: BoundedRateLimitReadOptions
): (signal: AbortSignal) => Promise<RateLimitHeadroomState | null> {
  const waitMs = options.waitMs ?? RATE_LIMIT_REFRESH_WAIT_MS
  const minIntervalMs = options.minIntervalMs ?? RATE_LIMIT_REFRESH_MIN_INTERVAL_MS
  let inFlight: Promise<void> | null = null
  let lastStartedAt: number | null = null

  function startRefresh(): Promise<void> {
    lastStartedAt = options.now()
    const run = async (): Promise<void> => {
      await options.refresh()
    }
    return run()
      .catch(() => undefined)
      .finally(() => {
        inFlight = null
      })
  }

  function refreshToAwait(): Promise<void> | null {
    if (inFlight !== null) {
      return inFlight
    }
    const elapsed = lastStartedAt === null ? null : options.now() - lastStartedAt
    // Why a negative gap does not throttle: a clock that moved backwards must not freeze refreshes.
    if (elapsed !== null && elapsed >= 0 && elapsed < minIntervalMs) {
      return null
    }
    inFlight = startRefresh()
    return inFlight
  }

  return async (signal) => {
    const refreshing = signal.aborted ? null : refreshToAwait()
    if (refreshing !== null) {
      await settlesWithin(refreshing, waitMs, signal)
    }
    return options.read()
  }
}
