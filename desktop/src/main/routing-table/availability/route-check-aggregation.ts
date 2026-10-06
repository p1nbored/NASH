import type {
  CheckOutcome,
  EvaluateFreshness,
  RouteAvailabilityResult,
  RouteAvailabilitySnapshot,
  RouteSubject,
  UnavailableReason,
  UnverifiedReason
} from './route-availability-types'
import type { RouteCheckResult } from './route-check-observations'

export type RouteStatusReading =
  | { readonly status: 'available'; readonly reasons: readonly [] }
  | {
      readonly status: 'unavailable'
      readonly reasons: readonly [UnavailableReason, ...UnavailableReason[]]
    }
  | {
      readonly status: 'unverified'
      readonly reasons: readonly [UnverifiedReason, ...UnverifiedReason[]]
    }

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/**
 * Available only when every check passed; a certain failure makes it unavailable (with only the failing
 * reasons); a check nobody could observe leaves it unverified. No checks at all prove nothing.
 */
export function statusFromChecks(checks: readonly CheckOutcome[]): RouteStatusReading {
  const [failed, ...otherFailures] = unique(
    checks.flatMap((check) => (check.result === 'fail' ? [check.reason] : []))
  )
  if (failed !== undefined) {
    return { status: 'unavailable', reasons: [failed, ...otherFailures] }
  }
  const [unobserved, ...otherUnobserved] = unique(
    checks.flatMap((check) => (check.result === 'unobserved' ? [check.reason] : []))
  )
  if (unobserved !== undefined) {
    return { status: 'unverified', reasons: [unobserved, ...otherUnobserved] }
  }
  return checks.length === 0
    ? { status: 'unverified', reasons: ['cli_unobserved'] }
    : { status: 'available', reasons: [] }
}

export type SnapshotContext = {
  readonly freshness: EvaluateFreshness
  readonly nowMs: number
  readonly workspaceKind: RouteAvailabilitySnapshot['workspaceKind']
  readonly observedAtMs: RouteAvailabilitySnapshot['observedAtMs']
}

/** The route's verdict, its resolved CLI setting (only when available) and the evidence behind both. */
export function buildRouteResult(
  subject: RouteSubject,
  result: RouteCheckResult,
  context: SnapshotContext
): RouteAvailabilityResult {
  const snapshot: RouteAvailabilitySnapshot = {
    checkedAtMs: context.nowMs,
    freshness: context.freshness,
    workspaceKind: context.workspaceKind,
    checks: result.checks,
    observedAtMs: context.observedAtMs
  }
  const reading = statusFromChecks(result.checks)
  if (reading.status !== 'available') {
    return { subject, snapshot, ...reading, cli: null }
  }
  const mapping = result.mapping
  // Why: the reasoning check derives from the mapping, so this only guards a caller that skipped it.
  if (mapping?.status !== 'resolved') {
    return {
      subject,
      snapshot,
      status: 'unverified',
      reasons: ['reasoning_unverified'],
      cli: null
    }
  }
  return {
    subject,
    snapshot,
    status: 'available',
    reasons: [],
    cli: {
      target: subject.target,
      model: subject.model,
      effort: mapping.effort,
      effortDelivery: mapping.delivery,
      requestedLevel: subject.reasoningLevel,
      requirement: subject.requirement,
      resolution: mapping.resolution
    }
  }
}
