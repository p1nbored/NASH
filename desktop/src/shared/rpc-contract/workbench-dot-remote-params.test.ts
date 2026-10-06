import { describe, expect, it } from 'vitest'
import {
  DOT_REMOTE_PAIR_AGAIN_REASONS,
  DOT_REMOTE_RECONNECT_REASONS,
  DOT_REMOTE_TOKEN_RECONNECT_REASONS,
  WorkbenchDotRemoteStatusViewSchema
} from './workbench-dot-remote-params'

// FIXTURE_ONLY: synthetic ids and times.
const PAIRING = {
  deviceId: 'dev_0123456789abcdef01234567',
  generation: 1,
  pairedAt: '2026-10-05T12:00:00.000Z',
  pairedUntil: '2026-11-04T12:00:00.000Z'
}

function view(overrides: Record<string, unknown>) {
  return {
    state: 'connected',
    enabled: true,
    origin: 'https://fixture-nash.example.test',
    serviceToken: 'sealed',
    reconnectReason: null,
    pairing: PAIRING,
    localEndpoint: 'ready',
    lastSyncAt: null,
    pendingEvents: 0,
    ...overrides
  }
}

describe('remote access status view', () => {
  it('splits every reason into fixing the token or pairing again', () => {
    expect(
      [...DOT_REMOTE_TOKEN_RECONNECT_REASONS, ...DOT_REMOTE_PAIR_AGAIN_REASONS].sort()
    ).toEqual([...DOT_REMOTE_RECONNECT_REASONS].sort())
    expect(DOT_REMOTE_PAIR_AGAIN_REASONS).toEqual(
      expect.arrayContaining([
        'pairing_expired',
        'device_credential_reused',
        'device_credential_invalid',
        'device_credential_unsaved'
      ])
    )
  })

  it.each(DOT_REMOTE_PAIR_AGAIN_REASONS)('shows pair_again with %s and no pairing', (reason) => {
    const parsed = WorkbenchDotRemoteStatusViewSchema.safeParse(
      view({ state: 'pair_again', reconnectReason: reason, pairing: null })
    )
    expect(parsed.success).toBe(true)
  })

  it.each(DOT_REMOTE_TOKEN_RECONNECT_REASONS)('shows reconnect_needed with %s', (reason) => {
    const parsed = WorkbenchDotRemoteStatusViewSchema.safeParse(
      view({ state: 'reconnect_needed', reconnectReason: reason })
    )
    expect(parsed.success).toBe(true)
  })

  it.each([
    ['pair_again', 'service_token_rejected'],
    ['reconnect_needed', 'pairing_expired'],
    ['pair_again', null],
    ['connected', 'pairing_revoked']
  ])('refuses the state %s with the reason %s', (state, reconnectReason) => {
    expect(
      WorkbenchDotRemoteStatusViewSchema.safeParse(view({ state, reconnectReason })).success
    ).toBe(false)
  })

  it('carries failing sync polls as a count, a code and a time, and accepts a view without them', () => {
    const syncFailure = {
      consecutiveFailures: 3,
      lastCode: 'SQLITE_BUSY',
      since: '2026-10-05T12:00:00.000Z'
    }
    expect(WorkbenchDotRemoteStatusViewSchema.parse(view({ syncFailure })).syncFailure).toEqual(
      syncFailure
    )
    expect(WorkbenchDotRemoteStatusViewSchema.parse(view({ syncFailure: null })).syncFailure).toBe(
      null
    )
    expect(WorkbenchDotRemoteStatusViewSchema.safeParse(view({})).success).toBe(true)
  })

  it.each([
    { consecutiveFailures: 0, lastCode: 'SQLITE_BUSY', since: '2026-10-05T12:00:00.000Z' },
    { consecutiveFailures: 3, lastCode: 'busy at C:\\private', since: '2026-10-05T12:00:00.000Z' },
    { consecutiveFailures: 3, lastCode: 'SQLITE_BUSY', since: 'yesterday' },
    {
      consecutiveFailures: 3,
      lastCode: 'SQLITE_BUSY',
      since: '2026-10-05T12:00:00.000Z',
      message: 'database is locked'
    }
  ])('refuses a sync failure that is more than a count, a code and a time: %o', (syncFailure) => {
    expect(WorkbenchDotRemoteStatusViewSchema.safeParse(view({ syncFailure })).success).toBe(false)
  })

  it('shows how long the pairing lasts, and still accepts a view without it', () => {
    const withLifetime = WorkbenchDotRemoteStatusViewSchema.parse(view({}))
    expect(withLifetime.pairing?.pairedUntil).toBe('2026-11-04T12:00:00.000Z')
    const { pairedUntil: _pairedUntil, ...older } = PAIRING
    expect(WorkbenchDotRemoteStatusViewSchema.safeParse(view({ pairing: older })).success).toBe(
      true
    )
  })
})
