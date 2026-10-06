import type { RouteBlocker, RouteBlockerDetail } from '../../shared/clef/clef-route-contract'

/** Latches outlive one request: auth until credentials change, quota until 00:00 UTC. */
export type ClefLatchKind = 'auth_failed' | 'quota_latched'

export type ClefErrorMapping = {
  readonly retryable: boolean
  readonly blocker: RouteBlocker
  readonly latch?: ClefLatchKind
}

export type ClefFetchErrorKind = 'network' | 'redirect_refused'

const MAX_CAUSE_DEPTH = 8
const REDIRECT_PATTERN = /redirect/i

function unavailable(detail: RouteBlockerDetail): RouteBlocker {
  return { reason: 'classifier_unavailable', detail }
}

function mapping(
  detail: RouteBlockerDetail,
  retryable: boolean,
  latch?: ClefLatchKind
): ClefErrorMapping {
  return latch
    ? { retryable, blocker: unavailable(detail), latch }
    : { retryable, blocker: unavailable(detail) }
}

function mapClientErrorStatus(status: number): ClefErrorMapping {
  switch (status) {
    case 401:
    case 403:
      return mapping('auth_or_account', false, 'auth_failed')
    case 404:
      return mapping('model_unavailable', false)
    case 408:
      return mapping('transient_exhausted', true)
    case 429:
      // Why no retry: retry-on-3040 stays off until the verified profile pins where that code lives.
      return mapping('quota_exhausted', false, 'quota_latched')
    default:
      return mapping('request_rejected', false)
  }
}

/**
 * Status-first mapping (spec section 7). Returns null for 2xx, which the validator owns.
 * A retryable mapping's blocker is what the request reports once retries run out.
 */
export function mapClefHttpStatus(status: number): ClefErrorMapping | null {
  if (!Number.isInteger(status)) {
    return mapping('request_rejected', false)
  }
  if (status >= 200 && status <= 299) {
    return null
  }
  if (status >= 400 && status <= 499) {
    return mapClientErrorStatus(status)
  }
  if (status >= 500 && status <= 599) {
    return mapping('transient_exhausted', true)
  }
  // 3xx means a redirect got past `redirect: 'error'`; anything else is not HTTP we understand.
  return mapping('request_rejected', false)
}

function describeLink(link: unknown): string {
  if (link instanceof Error) {
    return link.message
  }
  return typeof link === 'string' ? link : ''
}

/** A refused redirect surfaces as a thrown fetch error; find it anywhere in the cause chain. */
export function classifyClefFetchError(error: unknown): ClefFetchErrorKind {
  const seen = new Set<unknown>()
  let link: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && link !== undefined && !seen.has(link); depth++) {
    seen.add(link)
    if (REDIRECT_PATTERN.test(describeLink(link))) {
      return 'redirect_refused'
    }
    link = link instanceof Error ? link.cause : undefined
  }
  return 'network'
}

export function mapClefTransportFailure(kind: ClefFetchErrorKind): ClefErrorMapping {
  return kind === 'redirect_refused'
    ? mapping('request_rejected', false)
    : mapping('transient_exhausted', true)
}

export function mapClefFetchError(error: unknown): ClefErrorMapping {
  return mapClefTransportFailure(classifyClefFetchError(error))
}

/** The 30 s overall deadline ends the request; there is no time left to retry. */
export const CLEF_DEADLINE_MAPPING: ClefErrorMapping = Object.freeze({
  retryable: false,
  blocker: Object.freeze(unavailable('transient_exhausted'))
})
