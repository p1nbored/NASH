import { describe, expect, it } from 'vitest'
import type { RouteBlockerDetail } from '../../shared/clef/clef-route-contract'
import type { ClefLatchKind } from './clef-error-mapping'
import {
  clefCallOutcomeFor,
  type ClefTransportErrorClass,
  type ClefTransportOutcome
} from './clef-transport-outcome'

function blocked(
  detail: RouteBlockerDetail,
  errorClass: ClefTransportErrorClass,
  attempts: number,
  latch: ClefLatchKind | null = null
): ClefTransportOutcome {
  return {
    kind: 'blocked',
    blocker: { reason: 'classifier_unavailable', detail },
    latch,
    status: null,
    errorClass,
    attempts
  }
}

describe('clefCallOutcomeFor', () => {
  it('counts any answered response as success, whatever the validator later says', () => {
    expect(
      clefCallOutcomeFor({ kind: 'response', status: 200, bytes: new Uint8Array(), attempts: 2 })
    ).toBe('success')
  })

  it('ignores caller aborts and anything that never reached the wire', () => {
    expect(clefCallOutcomeFor({ kind: 'aborted', attempts: 1 })).toBeNull()
    expect(clefCallOutcomeFor(blocked('request_rejected', 'request_invalid', 0))).toBeNull()
    expect(clefCallOutcomeFor(blocked('not_configured', 'credentials_unavailable', 0))).toBeNull()
    expect(clefCallOutcomeFor(blocked('budget_exhausted', 'vetoed', 0))).toBeNull()
  })

  it('passes the latches through', () => {
    expect(clefCallOutcomeFor(blocked('auth_or_account', 'http_status', 1, 'auth_failed'))).toBe(
      'auth_failed'
    )
    expect(clefCallOutcomeFor(blocked('quota_exhausted', 'http_status', 1, 'quota_latched'))).toBe(
      'quota_latched'
    )
  })

  it.each<ClefTransportErrorClass>(['http_status', 'network', 'deadline', 'vetoed', 'internal'])(
    'counts transient_exhausted after a sent attempt (%s) toward the circuit',
    (errorClass) => {
      expect(clefCallOutcomeFor(blocked('transient_exhausted', errorClass, 1))).toBe(
        'transient_exhausted'
      )
    }
  )

  it('records other definitive failures but not a budget veto after a sent attempt', () => {
    expect(clefCallOutcomeFor(blocked('model_unavailable', 'http_status', 1))).toBe('other_failure')
    expect(clefCallOutcomeFor(blocked('request_rejected', 'redirect_refused', 1))).toBe(
      'other_failure'
    )
    expect(clefCallOutcomeFor(blocked('budget_exhausted', 'vetoed', 1))).toBeNull()
  })
})
