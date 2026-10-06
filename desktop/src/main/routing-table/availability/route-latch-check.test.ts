import { describe, expect, it } from 'vitest'
import { CLI_READING_SPAN_MS, applyLatches } from './route-latch-check'
import type { RouteLatch } from './route-availability-store'
import type { CheckOutcome } from './route-availability-types'

const LATCHED_AT = 1_000
const auth = (result: 'pass' | 'fail'): CheckOutcome =>
  result === 'pass'
    ? { check: 'auth', result: 'pass' }
    : { check: 'auth', result: 'fail', reason: 'auth_failed' }
const quota = (observed: boolean): CheckOutcome => ({
  check: 'quota',
  result: 'pass',
  evidence: { observed }
})
const latch = (kind: RouteLatch['kind']): RouteLatch => ({
  routeKey: 'k',
  kind,
  latchedAtMs: LATCHED_AT
})

describe('applyLatches', () => {
  it('leaves the checks alone when nothing is latched', () => {
    const checks = [auth('pass')]
    expect(
      applyLatches({ checks, latches: [], freshness: 'dispatch', limitsUpdatedAtMs: 5_000 })
    ).toEqual({ checks, cleared: [] })
  })

  it('adds a failing latch outcome for an executor-reported auth failure, even if the live check passes', () => {
    const result = applyLatches({
      checks: [auth('pass')],
      latches: [latch('auth')],
      freshness: 'dispatch',
      limitsUpdatedAtMs: 5_000
    })
    expect(result.cleared).toEqual([])
    expect(result.checks.at(-1)).toEqual({
      check: 'latch',
      result: 'fail',
      reason: 'auth_failed',
      evidence: { source: 'executor_reported', latchedAtMs: LATCHED_AT }
    })
  })

  it('names a lost latch file as the source when the latch stands in for it', () => {
    const result = applyLatches({
      checks: [auth('pass')],
      latches: [
        {
          routeKey: 'k',
          kind: 'auth',
          latchedAtMs: LATCHED_AT,
          source: 'availability_file_damaged'
        }
      ],
      freshness: 'dispatch',
      limitsUpdatedAtMs: 5_000
    })
    expect(result.checks.at(-1)).toMatchObject({
      check: 'latch',
      reason: 'auth_failed',
      evidence: { source: 'availability_file_damaged', latchedAtMs: LATCHED_AT }
    })
  })

  it('maps a quota latch to quota_exhausted', () => {
    const result = applyLatches({
      checks: [quota(true)],
      latches: [latch('quota')],
      freshness: 'cached',
      limitsUpdatedAtMs: 5_000
    })
    expect(result.checks.at(-1)).toMatchObject({ check: 'latch', reason: 'quota_exhausted' })
  })

  it('clears an auth latch only on a re-check whose passing reading is newer than the failure', () => {
    const cleared = applyLatches({
      checks: [auth('pass')],
      latches: [latch('auth')],
      freshness: 'recheck',
      limitsUpdatedAtMs: LATCHED_AT + 1
    })
    expect(cleared).toEqual({ checks: [auth('pass')], cleared: ['auth'] })
    for (const limitsUpdatedAtMs of [LATCHED_AT, LATCHED_AT - 1, null]) {
      const held = applyLatches({
        checks: [auth('pass')],
        latches: [latch('auth')],
        freshness: 'recheck',
        limitsUpdatedAtMs
      })
      expect(held.cleared).toEqual([])
      expect(held.checks.some((check) => check.check === 'latch')).toBe(true)
    }
  })

  it('does not clear when the live check fails or the freshness is not a re-check', () => {
    expect(
      applyLatches({
        checks: [auth('fail')],
        latches: [latch('auth')],
        freshness: 'recheck',
        limitsUpdatedAtMs: 9_999
      }).cleared
    ).toEqual([])
    for (const freshness of ['cached', 'dispatch'] as const) {
      expect(
        applyLatches({
          checks: [auth('pass')],
          latches: [latch('auth')],
          freshness,
          limitsUpdatedAtMs: 9_999
        }).cleared
      ).toEqual([])
    }
  })

  it('clears a quota latch only on an observed, newer, passing reading', () => {
    expect(
      applyLatches({
        checks: [quota(true)],
        latches: [latch('quota')],
        freshness: 'recheck',
        limitsUpdatedAtMs: 9_999
      }).cleared
    ).toEqual(['quota'])
    expect(
      applyLatches({
        checks: [quota(false)],
        latches: [latch('quota')],
        freshness: 'recheck',
        limitsUpdatedAtMs: 9_999
      }).cleared
    ).toEqual([])
  })

  it('treats the two kinds independently', () => {
    const result = applyLatches({
      checks: [auth('pass'), quota(false)],
      latches: [latch('auth'), latch('quota')],
      freshness: 'recheck',
      limitsUpdatedAtMs: 9_999
    })
    expect(result.cleared).toEqual(['auth'])
    expect(result.checks.filter((check) => check.check === 'latch')).toHaveLength(1)
  })

  it('never lets an auth pass that was inherited from a live primary clear a latch', () => {
    const inherited: CheckOutcome = {
      check: 'auth',
      result: 'pass',
      evidence: { basis: 'auth_inherited_from_live_primary', runId: 'run-1', ownerId: 'owner-1' }
    }
    const result = applyLatches({
      checks: [inherited],
      latches: [latch('auth')],
      freshness: 'recheck',
      limitsUpdatedAtMs: 9_999
    })
    expect(result.cleared).toEqual([])
    expect(result.checks.some((check) => check.check === 'latch')).toBe(true)
  })
})

describe('applyLatches with the usage meters off', () => {
  const unmetered = (check: 'auth' | 'quota'): CheckOutcome => ({
    check,
    result: 'pass',
    evidence: { metered: false }
  })
  const unmeteredChecks = [unmetered('auth'), unmetered('quota')]

  it('clears either kind on a re-check whose CLI answered after the failure', () => {
    const result = applyLatches({
      checks: unmeteredChecks,
      latches: [latch('auth'), latch('quota')],
      freshness: 'recheck',
      limitsUpdatedAtMs: null,
      cliAnsweredAtMs: LATCHED_AT + 1
    })
    expect(result).toEqual({ checks: unmeteredChecks, cleared: ['auth', 'quota'] })
  })

  it('keeps the latch when the CLI did not answer after the failure', () => {
    for (const cliAnsweredAtMs of [LATCHED_AT, LATCHED_AT - 1, null, undefined]) {
      const result = applyLatches({
        checks: unmeteredChecks,
        latches: [latch('auth'), latch('quota')],
        freshness: 'recheck',
        limitsUpdatedAtMs: 9_999,
        cliAnsweredAtMs
      })
      expect(result.cleared).toEqual([])
      expect(result.checks.map((check) => check.check)).toEqual(['auth', 'quota', 'latch', 'latch'])
    }
  })

  it('never clears on a dispatch or a cached read', () => {
    for (const freshness of ['cached', 'dispatch'] as const) {
      const result = applyLatches({
        checks: unmeteredChecks,
        latches: [latch('quota')],
        freshness,
        limitsUpdatedAtMs: null,
        cliAnsweredAtMs: 9_999
      })
      expect(result.cleared).toEqual([])
      expect(result.checks.at(-1)).toMatchObject({ check: 'latch', reason: 'quota_exhausted' })
    }
  })

  it('does not let a CLI answer clear a latch on a reading that is not unmetered or from a CLI', () => {
    const result = applyLatches({
      checks: [auth('pass'), quota(true)],
      latches: [latch('auth'), latch('quota')],
      freshness: 'recheck',
      limitsUpdatedAtMs: null,
      cliAnsweredAtMs: 9_999
    })
    expect(result.cleared).toEqual([])
  })
})

describe('applyLatches with CLI usage readings', () => {
  const cliQuota = (readingAtMs: number): CheckOutcome => ({
    check: 'quota',
    result: 'pass',
    evidence: { observed: true, source: 'codex_app_server', readingAtMs }
  })
  const unmeteredAuth: CheckOutcome = {
    check: 'auth',
    result: 'pass',
    evidence: { metered: false }
  }

  it('clears a quota latch on any check once a CLI reading begun after the failure shows the reset', () => {
    const afterProbeSpan = LATCHED_AT + CLI_READING_SPAN_MS + 1
    for (const freshness of ['cached', 'dispatch', 'recheck'] as const) {
      const checks = [unmeteredAuth, cliQuota(afterProbeSpan)]
      const result = applyLatches({
        checks,
        latches: [latch('quota')],
        freshness,
        limitsUpdatedAtMs: afterProbeSpan,
        cliAnsweredAtMs: null
      })
      expect(result).toEqual({ checks, cleared: ['quota'] })
    }
  })

  it('keeps the quota latch while the CLI reading predates the failure or a probe begun before it', () => {
    for (const readingAtMs of [LATCHED_AT - 1, LATCHED_AT + 1, LATCHED_AT + CLI_READING_SPAN_MS]) {
      const result = applyLatches({
        checks: [unmeteredAuth, cliQuota(readingAtMs)],
        latches: [latch('quota')],
        freshness: 'dispatch',
        limitsUpdatedAtMs: readingAtMs,
        cliAnsweredAtMs: null
      })
      expect(result.cleared).toEqual([])
      expect(result.checks.at(-1)).toMatchObject({ check: 'latch', reason: 'quota_exhausted' })
    }
  })

  it('keeps the quota latch while a fresh CLI reading still shows the limit used up', () => {
    const exhausted: CheckOutcome = {
      check: 'quota',
      result: 'fail',
      reason: 'quota_exhausted',
      evidence: { source: 'codex_app_server', readingAtMs: LATCHED_AT + 1, resetsAtMs: null }
    }
    const result = applyLatches({
      checks: [unmeteredAuth, exhausted],
      latches: [latch('quota')],
      freshness: 'recheck',
      limitsUpdatedAtMs: LATCHED_AT + 1,
      cliAnsweredAtMs: LATCHED_AT + 2
    })
    expect(result.cleared).toEqual([])
  })

  it('never clears an auth latch from a usage reading outside a re-check', () => {
    const result = applyLatches({
      checks: [unmeteredAuth, cliQuota(LATCHED_AT + 1)],
      latches: [latch('auth')],
      freshness: 'dispatch',
      limitsUpdatedAtMs: LATCHED_AT + 1,
      cliAnsweredAtMs: LATCHED_AT + 1
    })
    expect(result.cleared).toEqual([])
  })

  it('still clears both kinds on Check routes once the CLI answered after the failure', () => {
    const checks = [unmeteredAuth, cliQuota(LATCHED_AT - 1)]
    const result = applyLatches({
      checks,
      latches: [latch('auth'), latch('quota')],
      freshness: 'recheck',
      limitsUpdatedAtMs: LATCHED_AT - 1,
      cliAnsweredAtMs: LATCHED_AT + 1
    })
    expect(result).toEqual({ checks, cleared: ['auth', 'quota'] })
  })
})
