import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits, RateLimitWindow } from '../../../shared/rate-limit-types'
import { cliQuotaCheckOf } from './route-cli-quota-check'
import { authQuotaChecksOf } from './route-auth-quota-checks'
import { NOW_MS, headroomOf, limitsOf } from './route-availability.test-fixture'

// FIXTURE_ONLY: readings shaped like the three CLI feeds NASH reads (user instruction 2026-10-06).
const MINUTE = 60_000
const RESET_AT = NOW_MS + 90 * MINUTE

function window(usedPercent: number, resetsAt: number | null = RESET_AT): RateLimitWindow {
  return { usedPercent, windowMinutes: 300, resetsAt, resetDescription: null }
}

function cliLimits(
  provider: 'claude' | 'codex' | 'antigravity',
  overrides: Partial<ProviderRateLimits> = {}
): ProviderRateLimits {
  return limitsOf(provider, {
    session: window(40),
    weekly: window(10, null),
    updatedAt: NOW_MS - 2 * MINUTE,
    usageMetadata: { source: provider === 'claude' ? 'live-session' : 'cli' },
    ...overrides
  })
}

const UNMETERED = { check: 'quota', result: 'pass', evidence: { metered: false } }

describe('cliQuotaCheckOf', () => {
  it('blocks at 100% of a window with the reading source and reset time as evidence', () => {
    const state = headroomOf({ codex: cliLimits('codex', { session: window(100) }) })
    expect(cliQuotaCheckOf('codex', state, NOW_MS)).toEqual({
      check: 'quota',
      result: 'fail',
      reason: 'quota_exhausted',
      evidence: {
        source: 'codex_app_server',
        readingAtMs: NOW_MS - 2 * MINUTE,
        resetsAtMs: RESET_AT
      }
    })
  })

  it('names the Claude status line and agy /usage as the source of their readings', () => {
    const state = headroomOf({
      claude: cliLimits('claude', { weekly: window(100, NOW_MS + 5 * MINUTE) }),
      antigravity: cliLimits('antigravity', {
        session: null,
        weekly: null,
        buckets: [{ name: 'Gemini Models', ...window(100) }]
      })
    })
    expect(cliQuotaCheckOf('claude', state, NOW_MS)).toMatchObject({
      result: 'fail',
      evidence: { source: 'claude_status_line', resetsAtMs: NOW_MS + 5 * MINUTE }
    })
    expect(cliQuotaCheckOf('agy', state, NOW_MS)).toMatchObject({
      result: 'fail',
      evidence: { source: 'agy_usage', resetsAtMs: RESET_AT }
    })
  })

  it('records an unknown reset time as null', () => {
    const state = headroomOf({ codex: cliLimits('codex', { weekly: window(100, null) }) })
    expect(cliQuotaCheckOf('codex', state, NOW_MS)).toMatchObject({
      result: 'fail',
      evidence: { resetsAtMs: null }
    })
  })

  it('passes a fresh reading with headroom as observed, with its source', () => {
    const state = headroomOf({ codex: cliLimits('codex') })
    expect(cliQuotaCheckOf('codex', state, NOW_MS)).toEqual({
      check: 'quota',
      result: 'pass',
      evidence: { observed: true, source: 'codex_app_server', readingAtMs: NOW_MS - 2 * MINUTE }
    })
  })

  it('does not block on a window whose reset time has passed', () => {
    const state = headroomOf({ codex: cliLimits('codex', { session: window(100, NOW_MS - 1) }) })
    expect(cliQuotaCheckOf('codex', state, NOW_MS)).toMatchObject({ result: 'pass' })
  })

  it('never blocks on a missing or stale reading', () => {
    const stale = cliLimits('codex', { session: window(100), updatedAt: NOW_MS - 31 * MINUTE })
    for (const state of [null, headroomOf({ codex: null }), headroomOf({ codex: stale })]) {
      expect(cliQuotaCheckOf('codex', state, NOW_MS)).toEqual(UNMETERED)
    }
  })

  it('ignores a reading that did not come from the CLI itself', () => {
    const inherited = limitsOf('codex', {
      session: window(100),
      usageMetadata: { source: 'oauth' }
    })
    const unlabeled = limitsOf('codex', { session: window(100) })
    const claudeFromCli = cliLimits('claude', {
      session: window(100),
      usageMetadata: { source: 'cli' }
    })
    expect(cliQuotaCheckOf('codex', headroomOf({ codex: inherited }), NOW_MS)).toEqual(UNMETERED)
    expect(cliQuotaCheckOf('codex', headroomOf({ codex: unlabeled }), NOW_MS)).toEqual(UNMETERED)
    expect(cliQuotaCheckOf('claude', headroomOf({ claude: claudeFromCli }), NOW_MS)).toEqual(
      UNMETERED
    )
  })

  it('does not trust an unavailable reading', () => {
    const state = headroomOf({
      codex: cliLimits('codex', { status: 'unavailable', session: window(100) })
    })
    expect(cliQuotaCheckOf('codex', state, NOW_MS)).toEqual(UNMETERED)
  })
})

describe('authQuotaChecksOf with CLI readings', () => {
  it('passes auth as not metered and takes the quota from a fresh CLI reading', () => {
    const state = headroomOf({
      codex: cliLimits('codex', {
        session: window(100),
        usageMetadata: { source: 'cli', failureKind: 'stale-token' }
      })
    })
    expect(
      authQuotaChecksOf('codex', { usageSource: 'cli-native', rateLimits: state, nowMs: NOW_MS })
    ).toEqual([
      { check: 'auth', result: 'pass', evidence: { metered: false } },
      cliQuotaCheckOf('codex', state, NOW_MS)
    ])
  })
})
