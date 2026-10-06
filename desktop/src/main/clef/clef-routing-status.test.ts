import { describe, expect, it } from 'vitest'
import { ROUTING_STATUSES } from '../../shared/clef/clef-route-contract'
import {
  clefRoutingStatusBlocker,
  computeClefRoutingStatus,
  type ClefRoutingStatusInput
} from './clef-routing-status'
import type { ClefVerifiedProfile } from './clef-verified-profile'

const NOW = Date.parse('2026-10-04T12:00:00.000Z')

const profile: ClefVerifiedProfile = {
  profileVersion: 2,
  envelopeMode: 'cf_result_wrapper',
  expectedResponseModel: '@cf/cloudflare/clef',
  optionKeyForm: 'sent_option_id',
  sumTolerance: 1e-3,
  verifiedAt: '2026-10-04T11:00:00.000Z',
  reportSha256: 'b'.repeat(64),
  schemaPins: {
    inputSchemaSha256: 'c'.repeat(64),
    outputSchemaSha256: 'd'.repeat(64),
    docsRevision: 'rev-1'
  }
}

const ready: ClefRoutingStatusInput = {
  credentials: { sealingAvailable: true, token: 'sealed', accountId: 'sealed' },
  profile,
  latches: { authFailed: false, quotaUntilMs: null },
  circuit: { openUntilMs: null },
  lastCallOutcome: null,
  nowMs: NOW
}

function statusWith(overrides: Partial<ClefRoutingStatusInput>) {
  return computeClefRoutingStatus({ ...ready, ...overrides })
}

describe('clef routing status', () => {
  it('is ready when configured with no latch, open circuit or transient failure', () => {
    expect(computeClefRoutingStatus(ready)).toBe('ready')
    expect(statusWith({ lastCallOutcome: 'answered' })).toBe('ready')
    expect(statusWith({ lastCallOutcome: 'request_rejected' })).toBe('ready')
  })

  it('reports sealing unavailable before anything else', () => {
    const credentials = { sealingAvailable: false, token: null, accountId: null }
    expect(statusWith({ credentials, profile: null })).toBe('sealing_unavailable')
    expect(statusWith({ credentials: { ...ready.credentials, sealingAvailable: false } })).toBe(
      'sealing_unavailable'
    )
  })

  it('treats missing or plaintext credentials as not configured', () => {
    for (const credentials of [
      { sealingAvailable: true, token: null, accountId: 'sealed' as const },
      { sealingAvailable: true, token: 'sealed' as const, accountId: null },
      { sealingAvailable: true, token: 'plaintext' as const, accountId: 'sealed' as const },
      { sealingAvailable: true, token: 'sealed' as const, accountId: 'plaintext' as const }
    ]) {
      expect(statusWith({ credentials, profile: null })).toBe('not_configured')
    }
  })

  it('requires a verified profile, then a pinned response model, and no spend cap (D-022)', () => {
    expect(statusWith({ profile: null })).toBe('contract_unverified')
    expect(statusWith({ profile: { ...profile, expectedResponseModel: null } })).toBe(
      'identity_unpinned'
    )
    expect(ROUTING_STATUSES).not.toContain('budget_unset')
  })

  it('orders the latches auth, quota, circuit, then unreachable', () => {
    const everything: Partial<ClefRoutingStatusInput> = {
      latches: { authFailed: true, quotaUntilMs: NOW + 1 },
      circuit: { openUntilMs: NOW + 1 },
      lastCallOutcome: 'transient_exhausted'
    }
    expect(statusWith(everything)).toBe('auth_failed')
    expect(
      statusWith({ ...everything, latches: { authFailed: false, quotaUntilMs: NOW + 1 } })
    ).toBe('quota_latched')
    expect(statusWith({ ...everything, latches: { authFailed: false, quotaUntilMs: null } })).toBe(
      'circuit_open'
    )
    expect(
      statusWith({
        ...everything,
        latches: { authFailed: false, quotaUntilMs: null },
        circuit: { openUntilMs: null }
      })
    ).toBe('unreachable')
  })

  it('lifts the quota latch at its deadline and half-opens the circuit after its window', () => {
    expect(statusWith({ latches: { authFailed: false, quotaUntilMs: NOW } })).toBe('ready')
    expect(statusWith({ latches: { authFailed: false, quotaUntilMs: NOW - 1 } })).toBe('ready')
    expect(statusWith({ circuit: { openUntilMs: NOW } })).toBe('ready')
    expect(
      statusWith({ circuit: { openUntilMs: NOW }, lastCallOutcome: 'transient_exhausted' })
    ).toBe('unreachable')
  })

  it('lets configuration problems outrank runtime latches', () => {
    expect(statusWith({ profile: null, latches: { authFailed: true, quotaUntilMs: null } })).toBe(
      'contract_unverified'
    )
  })
})

describe('clef routing status blocker', () => {
  it('maps every blocking status to one classifier_unavailable detail', () => {
    const expected = {
      not_configured: 'not_configured',
      sealing_unavailable: 'not_configured',
      contract_unverified: 'contract_unverified',
      identity_unpinned: 'clef_identity_unpinned',
      ready: null,
      unreachable: null,
      circuit_open: 'transient_exhausted',
      quota_latched: 'quota_exhausted',
      auth_failed: 'auth_or_account'
    } as const
    for (const status of ROUTING_STATUSES) {
      const detail = expected[status]
      expect(clefRoutingStatusBlocker(status)).toEqual(
        detail === null ? null : { reason: 'classifier_unavailable', detail }
      )
    }
  })
})
