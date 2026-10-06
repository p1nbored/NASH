import { describe, expect, it } from 'vitest'
import type { UsageRateLimitFailureKind } from '../../../shared/rate-limit-types'
import {
  authCheckOf,
  authQuotaChecksOf,
  limitsForProvider,
  quotaCheckOf
} from './route-auth-quota-checks'
import { NOW_MS, headroomOf, limitsOf } from './route-availability.test-fixture'

function failed(
  kind: UsageRateLimitFailureKind | undefined,
  status: 'error' | 'unavailable' = 'error'
) {
  return limitsOf('claude', {
    status,
    error: 'Account someone@example.invalid token expired',
    ...(kind ? { usageMetadata: { failureKind: kind } } : {})
  })
}

describe('authCheckOf', () => {
  it('passes on a fresh successful reading', () => {
    expect(authCheckOf(limitsOf('claude'), NOW_MS)).toEqual({ check: 'auth', result: 'pass' })
  })

  it('does not trust a successful reading older than the service keeps data', () => {
    const stale = limitsOf('claude', { updatedAt: NOW_MS - 31 * 60_000 })
    expect(authCheckOf(stale, NOW_MS)).toMatchObject({
      result: 'unobserved',
      reason: 'auth_unobserved'
    })
  })

  it('is unobserved without a reading, and for a reading with no usable timestamp', () => {
    expect(authCheckOf(null, NOW_MS)).toMatchObject({
      result: 'unobserved',
      reason: 'auth_unobserved'
    })
    const broken = limitsOf('claude', { updatedAt: Number.NaN })
    expect(authCheckOf(broken, NOW_MS)).toMatchObject({ result: 'unobserved' })
  })

  it.each([
    'missing-credentials',
    'stale-token',
    'refreshable-credentials-without-token',
    'delegated-refresh-required',
    'keychain-unavailable',
    'missing-scope'
  ] as const)('fails as auth_failed for %s', (kind) => {
    expect(authCheckOf(failed(kind), NOW_MS)).toMatchObject({
      check: 'auth',
      result: 'fail',
      reason: 'auth_failed',
      evidence: { failureKind: kind }
    })
  })

  it('fails an authenticated account that is not entitled as not_entitled', () => {
    expect(authCheckOf(failed('no-subscription'), NOW_MS)).toMatchObject({
      result: 'fail',
      reason: 'not_entitled'
    })
  })

  it.each([
    'network',
    'server',
    'parse',
    'rate-limited',
    'cli-unavailable',
    'usage-unavailable',
    'deferred-by-live-session',
    'unknown'
  ] as const)('cannot tell from %s, so it stays unobserved', (kind) => {
    expect(authCheckOf(failed(kind), NOW_MS)).toMatchObject({
      result: 'unobserved',
      reason: 'auth_unobserved'
    })
  })

  it('is unobserved for an error with no failure kind and for readings that are not final', () => {
    expect(authCheckOf(failed(undefined), NOW_MS)).toMatchObject({ result: 'unobserved' })
    for (const status of ['idle', 'fetching', 'unavailable'] as const) {
      expect(authCheckOf(limitsOf('claude', { status }), NOW_MS)).toMatchObject({
        result: 'unobserved'
      })
    }
  })

  it('never copies the reading error text, which can carry account identifiers', () => {
    const outcome = authCheckOf(failed('stale-token'), NOW_MS)
    expect(JSON.stringify(outcome)).not.toContain('example.invalid')
  })
})

describe('limitsForProvider', () => {
  it('reads agy from the antigravity reading', () => {
    const state = headroomOf({ antigravity: limitsOf('antigravity', { planType: 'x' }) })
    expect(limitsForProvider(state, 'agy')?.provider).toBe('antigravity')
    expect(limitsForProvider(state, 'claude')?.provider).toBe('claude')
    expect(limitsForProvider(null, 'codex')).toBeNull()
  })
})

describe('quotaCheckOf', () => {
  const exhausted = {
    usedPercent: 100,
    windowMinutes: 300,
    resetsAt: NOW_MS + 60_000,
    resetDescription: null
  }

  it('blocks only a known exhausted account window', () => {
    const state = headroomOf({ codex: limitsOf('codex', { session: exhausted }) })
    expect(quotaCheckOf('codex', state, NOW_MS)).toMatchObject({
      check: 'quota',
      result: 'fail',
      reason: 'quota_exhausted'
    })
    expect(quotaCheckOf('claude', state, NOW_MS)).toMatchObject({ result: 'pass' })
  })

  it('does not block on a window whose reset time has passed', () => {
    const rolledOver = { ...exhausted, resetsAt: NOW_MS - 1 }
    const state = headroomOf({ claude: limitsOf('claude', { session: rolledOver }) })
    expect(quotaCheckOf('claude', state, NOW_MS)).toMatchObject({ result: 'pass' })
  })

  it('passes with the reading marked unobserved when nothing usable was read', () => {
    expect(quotaCheckOf('agy', null, NOW_MS)).toEqual({
      check: 'quota',
      result: 'pass',
      evidence: { observed: false }
    })
    const stale = headroomOf({
      antigravity: limitsOf('antigravity', { updatedAt: NOW_MS - 40 * 60_000 })
    })
    expect(quotaCheckOf('agy', stale, NOW_MS)).toMatchObject({ evidence: { observed: false } })
  })

  it('reads the agy pool from the antigravity state', () => {
    const state = headroomOf({ antigravity: limitsOf('antigravity', { weekly: exhausted }) })
    expect(quotaCheckOf('agy', state, NOW_MS)).toMatchObject({ result: 'fail' })
  })

  it('records that a pass rests on an observed reading', () => {
    expect(quotaCheckOf('claude', headroomOf(), NOW_MS)).toEqual({
      check: 'quota',
      result: 'pass',
      evidence: { observed: true }
    })
  })
})

describe('authQuotaChecksOf', () => {
  const exhausted = { usedPercent: 100, windowMinutes: 300, resetsAt: null, resetDescription: null }
  const live = { runId: 'run-1', ownerId: 'owner-1' }

  it('passes both as not metered on CLI readings when no reading came from the CLI', () => {
    const state = headroomOf({
      codex: limitsOf('codex', {
        status: 'error',
        session: exhausted,
        usageMetadata: { failureKind: 'stale-token' }
      })
    })
    for (const rateLimits of [state, null]) {
      expect(
        authQuotaChecksOf('codex', { usageSource: 'cli-native', rateLimits, nowMs: NOW_MS })
      ).toEqual([
        { check: 'auth', result: 'pass', evidence: { metered: false } },
        { check: 'quota', result: 'pass', evidence: { metered: false } }
      ])
    }
  })

  it("reads the login and the quota as before on Orca's inherited meters", () => {
    const state = headroomOf({ claude: failed('deferred-by-live-session') })
    expect(
      authQuotaChecksOf(
        'claude',
        { usageSource: 'orca-inherited', rateLimits: state, nowMs: NOW_MS },
        live
      )
    ).toEqual([authCheckOf(state.claude, NOW_MS, live), quotaCheckOf('claude', state, NOW_MS)])
  })
})
