// Why: the parent's scan deadline is a no-progress window, so the child has to
// say when a scan's work advanced. Keyed by the request's cancel signal, which
// every work site already receives, so the index loop or an interactive read
// running through the same readers can never extend a scan's deadline.
const reporters = new WeakMap<AbortSignal, () => void>()

// Rate-limited because a cold scan consumes thousands of chunks and stats, and
// the parent only reads the counter as "still moving" inside a 130 s window.
export const AI_VAULT_SCAN_PROGRESS_INTERVAL_MS = 1_000

/**
 * Reports advancing work for the scan that owns `signal`, at most once per
 * interval and only when the counter moved, until the returned stop is called.
 */
export function trackAiVaultScanProgress(
  signal: AbortSignal,
  report: (units: number) => void,
  now: () => number = () => performance.now()
): () => void {
  let units = 0
  let lastReportedAt = Number.NEGATIVE_INFINITY
  reporters.set(signal, () => {
    units++
    const at = now()
    if (at - lastReportedAt < AI_VAULT_SCAN_PROGRESS_INTERVAL_MS) {
      return
    }
    lastReportedAt = at
    report(units)
  })
  return () => {
    reporters.delete(signal)
  }
}

/** Counts one unit of real work for the scan that owns `signal`; a no-op for any other work. */
export function noteAiVaultScanProgress(signal: AbortSignal | undefined): void {
  if (signal) {
    reporters.get(signal)?.()
  }
}
