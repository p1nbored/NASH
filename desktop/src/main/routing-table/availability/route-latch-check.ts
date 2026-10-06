import { AUTH_INHERITED_BASIS } from './route-auth-quota-checks'
import type {
  CheckOutcome,
  EvaluateFreshness,
  RouteLatch,
  UnavailableReason
} from './route-availability-types'

const LATCH_REASON: Readonly<Record<RouteLatch['kind'], UnavailableReason>> = {
  auth: 'auth_failed',
  quota: 'quota_exhausted'
}

/** The live check a latch of this kind is waiting to see pass again. */
function liveCheckFor(
  checks: readonly CheckOutcome[],
  kind: RouteLatch['kind']
): CheckOutcome | undefined {
  return checks.find((check) => check.check === (kind === 'auth' ? 'auth' : 'quota'))
}

/**
 * How long a CLI usage probe can run (codex app-server's 30 s init plus its 10 s read, agy's 35 s).
 * Why: a reading is stamped when it finishes, so one that finished within this span after a failure
 * may have begun before it and cannot prove the limit reset.
 */
export const CLI_READING_SPAN_MS = 60_000

/** A quota pass that rests on a fresh reading from the route's own CLI (route-cli-quota-check.ts). */
function cliReadingAtMs(check: CheckOutcome | undefined): number | null {
  const readingAtMs = check?.evidence?.readingAtMs
  return check?.result === 'pass' &&
    check.evidence?.observed === true &&
    typeof check.evidence.source === 'string' &&
    typeof readingAtMs === 'number'
    ? readingAtMs
    : null
}

/**
 * An executor-reported auth or quota failure holds the route until a re-check proves it gone: the live
 * check passes on a reading newer than the failure. Without a vendor meter (no reading, or a CLI
 * reading) that re-check reading is the route's own CLI answering its model listing. A quota latch
 * also clears on any check once a CLI usage reading newer than the failure shows the limit reset.
 */
export function applyLatches(input: {
  checks: readonly CheckOutcome[]
  latches: readonly RouteLatch[]
  freshness: EvaluateFreshness
  /** The `updatedAt` of the provider's rate-limit reading, null when there is none. */
  limitsUpdatedAtMs: number | null
  /** When the route's CLI answered its model listing in this check; used without a vendor meter. */
  cliAnsweredAtMs?: number | null
}): { checks: readonly CheckOutcome[]; cleared: readonly RouteLatch['kind'][] } {
  const held: CheckOutcome[] = []
  const cleared: RouteLatch['kind'][] = []
  for (const latch of input.latches) {
    const live = liveCheckFor(input.checks, latch.kind)
    const cliReading = cliReadingAtMs(live)
    const unmetered = live?.evidence?.metered === false
    const readingAtMs =
      unmetered || cliReading !== null ? (input.cliAnsweredAtMs ?? null) : input.limitsUpdatedAtMs
    // Why not inherited: borrowing the primary's login is not a reading that the failure is gone.
    const proven =
      live?.result === 'pass' &&
      live.evidence?.basis !== AUTH_INHERITED_BASIS &&
      (latch.kind === 'auth' || live.evidence?.observed === true || unmetered) &&
      readingAtMs !== null &&
      readingAtMs > latch.latchedAtMs
    const resetByReading =
      latch.kind === 'quota' &&
      cliReading !== null &&
      cliReading > latch.latchedAtMs + CLI_READING_SPAN_MS
    if ((input.freshness === 'recheck' && proven) || resetByReading) {
      cleared.push(latch.kind)
      continue
    }
    held.push({
      check: 'latch',
      result: 'fail',
      reason: LATCH_REASON[latch.kind],
      evidence: { source: latch.source ?? 'executor_reported', latchedAtMs: latch.latchedAtMs }
    })
  }
  return { checks: held.length === 0 ? input.checks : [...input.checks, ...held], cleared }
}
