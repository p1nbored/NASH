import { describe, expect, it } from 'vitest'
import {
  CLEF_DEADLINE_MAPPING,
  classifyClefFetchError,
  mapClefFetchError,
  mapClefHttpStatus,
  mapClefTransportFailure
} from './clef-error-mapping'

function unavailable(detail: string): { reason: string; detail: string } {
  return { reason: 'classifier_unavailable', detail }
}

describe('mapClefHttpStatus', () => {
  it.each([200, 201, 204, 299])('treats %i as a response, not an error', (status) => {
    expect(mapClefHttpStatus(status)).toBeNull()
  })

  it('maps 400 to request_rejected without retry', () => {
    expect(mapClefHttpStatus(400)).toEqual({
      retryable: false,
      blocker: unavailable('request_rejected')
    })
  })

  it.each([401, 403])('maps %i to auth_or_account and sets the auth_failed latch', (status) => {
    expect(mapClefHttpStatus(status)).toEqual({
      retryable: false,
      blocker: unavailable('auth_or_account'),
      latch: 'auth_failed'
    })
  })

  it('maps 404 to model_unavailable', () => {
    expect(mapClefHttpStatus(404)).toEqual({
      retryable: false,
      blocker: unavailable('model_unavailable')
    })
  })

  it('maps 413 to request_rejected', () => {
    expect(mapClefHttpStatus(413)).toEqual({
      retryable: false,
      blocker: unavailable('request_rejected')
    })
  })

  it('maps 429 to quota_exhausted with the quota latch and no retry', () => {
    expect(mapClefHttpStatus(429)).toEqual({
      retryable: false,
      blocker: unavailable('quota_exhausted'),
      latch: 'quota_latched'
    })
  })

  it.each([402, 405, 409, 410, 415, 422, 451, 499])(
    'maps other 4xx %i to request_rejected',
    (s) => {
      expect(mapClefHttpStatus(s)).toEqual({
        retryable: false,
        blocker: unavailable('request_rejected')
      })
    }
  )

  it('retries 408 and reports transient_exhausted once retries run out', () => {
    expect(mapClefHttpStatus(408)).toEqual({
      retryable: true,
      blocker: unavailable('transient_exhausted')
    })
  })

  it.each([500, 502, 503, 504, 599])('retries 5xx %i as transient', (status) => {
    expect(mapClefHttpStatus(status)).toEqual({
      retryable: true,
      blocker: unavailable('transient_exhausted')
    })
  })

  it.each([300, 301, 302, 303, 307, 308])('maps a refused redirect %i to request_rejected', (s) => {
    expect(mapClefHttpStatus(s)).toEqual({
      retryable: false,
      blocker: unavailable('request_rejected')
    })
  })

  it.each([0, 101, 199, 600, 999, -1, 200.5, Number.NaN])(
    'fails closed without retry on the unexpected status %s',
    (status) => {
      expect(mapClefHttpStatus(status)).toEqual({
        retryable: false,
        blocker: unavailable('request_rejected')
      })
    }
  )
})

describe('classifyClefFetchError', () => {
  it('treats ordinary transport failures as network errors', () => {
    expect(classifyClefFetchError(new TypeError('fetch failed'))).toBe('network')
    expect(classifyClefFetchError('socket hang up')).toBe('network')
    expect(classifyClefFetchError(undefined)).toBe('network')
  })

  it('recognises a refused redirect in the message or the cause chain', () => {
    expect(classifyClefFetchError(new Error('Redirect was cancelled'))).toBe('redirect_refused')
    const nested = new TypeError('fetch failed', {
      cause: new Error('wrapper', { cause: new Error('redirect mode is set to error') })
    })
    expect(classifyClefFetchError(nested)).toBe('redirect_refused')
  })

  it('stops walking a cyclic cause chain', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    Object.defineProperty(first, 'cause', { value: second })
    expect(classifyClefFetchError(first)).toBe('network')
  })
})

describe('mapClefFetchError', () => {
  it('retries a network error and reports transient_exhausted', () => {
    expect(mapClefFetchError(new TypeError('fetch failed'))).toEqual({
      retryable: true,
      blocker: unavailable('transient_exhausted')
    })
  })

  it('never retries a refused redirect', () => {
    expect(mapClefFetchError(new Error('redirect mode is set to error'))).toEqual({
      retryable: false,
      blocker: unavailable('request_rejected')
    })
  })

  it('maps a failure kind directly, for errors raised after the response arrived', () => {
    expect(mapClefTransportFailure('network')).toEqual({
      retryable: true,
      blocker: unavailable('transient_exhausted')
    })
    expect(mapClefTransportFailure('redirect_refused')).toEqual({
      retryable: false,
      blocker: unavailable('request_rejected')
    })
  })

  it('maps the overall deadline to a final transient_exhausted', () => {
    expect(CLEF_DEADLINE_MAPPING).toEqual({
      retryable: false,
      blocker: unavailable('transient_exhausted')
    })
  })

  it('returns fresh objects so callers cannot mutate the shared table', () => {
    const first = mapClefHttpStatus(500)
    const second = mapClefHttpStatus(500)
    expect(first).not.toBe(second)
    expect(Object.isFrozen(CLEF_DEADLINE_MAPPING)).toBe(true)
  })
})
