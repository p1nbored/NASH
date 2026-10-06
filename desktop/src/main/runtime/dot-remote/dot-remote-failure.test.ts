import { describe, expect, it } from 'vitest'
import { failureAction } from './dot-remote-failure'

describe('what the agent does after a failed Site call', () => {
  it.each([
    ['device_credential_reused', 'device_credential_reused'],
    ['device_credential_invalid', 'device_credential_invalid'],
    ['pairing_expired', 'pairing_expired'],
    ['generation_revoked', 'pairing_revoked']
  ] as const)('asks to pair again on %s', (code, reason) => {
    expect(failureAction({ kind: 'site_error', code })).toEqual({ action: 'pair_again', reason })
  })

  it.each(['session_expired', 'unauthorized'] as const)(
    'drops the session and resumes it with the device credential on %s',
    (code) => {
      expect(failureAction({ kind: 'site_error', code })).toEqual({ action: 'session_lost' })
    }
  )

  it('asks for a new Site token when the platform refuses it', () => {
    expect(failureAction({ kind: 'rejected', status: 403 })).toEqual({
      action: 'reconnect',
      reason: 'service_token_rejected'
    })
  })

  it.each([
    { kind: 'unavailable', reason: 'network' },
    { kind: 'unavailable', reason: 'timeout' },
    { kind: 'site_error', code: 'rate_limited' }
  ] as const)('retries later on %j, keeping every credential', (failure) => {
    expect(failureAction(failure)).toEqual({ action: 'retry' })
  })
})
