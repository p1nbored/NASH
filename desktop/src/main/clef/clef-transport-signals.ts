/** Deadline, cancellation and backoff primitives for the Clef transport; timers are injectable. */
export const CLEF_RETRY_BASE_MS = 500
export const CLEF_RETRY_CAP_MS = 4000
export const CLEF_OVERALL_DEADLINE_MS = 30_000

const LARGEST_BELOW_ONE = 1 - Number.EPSILON

/** `set` returns its own cancel function so no timer handle type leaks into callers. */
export type ClefTimers = {
  set(callback: () => void, ms: number): () => void
}

export const realClefTimers: ClefTimers = {
  set(callback, ms) {
    const handle = setTimeout(callback, ms)
    return () => clearTimeout(handle)
  }
}

export type DisposableSignal = { signal: AbortSignal; dispose(): void }

/** Full jitter: uniform in [0, min(cap, base * 2^(attempt-1))). */
export function fullJitterDelay(attemptNumber: number, random: () => number): number {
  const exponent = Math.max(0, attemptNumber - 1)
  const ceiling = Math.min(CLEF_RETRY_CAP_MS, CLEF_RETRY_BASE_MS * 2 ** exponent)
  const draw = random()
  const unit = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), LARGEST_BELOW_ONE) : 0
  return Math.floor(unit * ceiling)
}

export function startClefDeadline(ms: number, timers: ClefTimers): DisposableSignal {
  const controller = new AbortController()
  const cancel = timers.set(() => controller.abort(new Error('Clef request deadline exceeded')), ms)
  return { signal: controller.signal, dispose: cancel }
}

export type AbortRace<T> = { aborted: true } | { aborted: false; value: T }

/**
 * Races `work` against `signal`. Once the signal wins, a later result or failure of the work
 * is discarded, so a hung dependency cannot outlive the deadline or the caller's cancel.
 */
export function untilAborted<T>(
  work: () => Promise<T> | T,
  signal: AbortSignal
): Promise<AbortRace<T>> {
  if (signal.aborted) {
    return Promise.resolve({ aborted: true })
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => resolve({ aborted: true })
    signal.addEventListener('abort', onAbort, { once: true })
    const settle = (finish: () => void): void => {
      signal.removeEventListener('abort', onAbort)
      finish()
    }
    let pending: Promise<T>
    try {
      pending = Promise.resolve(work())
    } catch (error) {
      settle(() => reject(error))
      return
    }
    pending.then(
      (value) => settle(() => resolve({ aborted: false, value })),
      (error: unknown) => settle(() => reject(error))
    )
  })
}

/** Resolves after `ms`, or as soon as `signal` aborts; never rejects. */
export function abortableSleep(
  ms: number,
  signal: AbortSignal,
  timers: ClefTimers = realClefTimers
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const finish = (): void => {
      cancel()
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const cancel = timers.set(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}
