import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import type { ClefCallOutcome } from './clef-call-circuit'
import type { ClefLatchKind } from './clef-error-mapping'

/** Snake case so it fits the decision record's `transportErrorClass` column. */
export type ClefTransportErrorClass =
  | 'http_status'
  | 'network'
  | 'redirect_refused'
  | 'response_too_large'
  | 'deadline'
  | 'vetoed'
  | 'request_invalid'
  | 'credentials_unavailable'
  | 'internal'

/** Raw bytes and status for the response validator; nothing here is parsed. */
export type ClefTransportResponse = {
  kind: 'response'
  status: number
  bytes: Uint8Array
  attempts: number
}

export type ClefTransportBlocked = {
  kind: 'blocked'
  blocker: RouteBlocker
  latch: ClefLatchKind | null
  /** Last HTTP status seen, if any attempt got one. */
  status: number | null
  errorClass: ClefTransportErrorClass
  attempts: number
}

/** The caller's own signal aborted; the router records this as a cancel, not a failure. */
export type ClefTransportAborted = { kind: 'aborted'; attempts: number }

export type ClefTransportOutcome =
  | ClefTransportResponse
  | ClefTransportBlocked
  | ClefTransportAborted

/** What the call circuit should learn from one transport call; null means nothing. */
export function clefCallOutcomeFor(outcome: ClefTransportOutcome): ClefCallOutcome | null {
  if (outcome.kind === 'response') {
    return 'success'
  }
  if (outcome.kind === 'aborted' || outcome.attempts === 0) {
    return null
  }
  if (outcome.latch) {
    return outcome.latch
  }
  if (outcome.blocker.detail === 'transient_exhausted') {
    return 'transient_exhausted'
  }
  // A budget veto says nothing about Clef's health.
  return outcome.errorClass === 'vetoed' ? null : 'other_failure'
}
