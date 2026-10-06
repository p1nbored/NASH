import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../shared/rate-limit-types'
import { FIXTURE_USER_DATA } from '../routing-table-test-context.test-fixture'
import {
  createEvaluatorHarness,
  type HarnessOverrides
} from './route-availability-harness.test-fixture'
import { createMemoryAvailabilityFs } from './route-availability-fs.test-fixture'
import type { RouteAvailabilityResult } from './route-availability-types'
import {
  CODEX_MODELS,
  NOW_MS,
  failedListing,
  headroomOf,
  limitsOf,
  listingOf,
  subjectOf
} from './route-availability.test-fixture'

// NASH reads usage only through each CLI (user instruction 2026-10-06): a fresh CLI reading at
// 100% blocks its routes, a missing or stale one never does, and CLI-reported failures latch.
const codex = subjectOf('codex_cli', 'gpt-6.1-sol', 'max')
const claudeSubagent = subjectOf('claude_subagent', 'claude-opus-5-5', 'max')
const claudeHeadless = subjectOf('claude_headless', 'claude-sonnet-5-5', 'high')
const agy = subjectOf('agy_cli', 'gemini-3.8-flash-high', 'high', 'if_supported')
const DISPATCH = { freshness: 'dispatch', workspace: { kind: 'git-worktree' } } as const
const RECHECK = { freshness: 'recheck' } as const
const MINUTE = 60_000
const CODEX_KEY = 'codex_cli|gpt-6.1-sol|max'
const LATCH_FILE = join(FIXTURE_USER_DATA, 'routing-table', 'availability.json')
const RESET_AT = NOW_MS + 2 * 60 * MINUTE

function cliReading(
  provider: 'claude' | 'codex' | 'antigravity',
  usedPercent: number,
  updatedAt: number
): ProviderRateLimits {
  return limitsOf(provider, {
    session: { usedPercent, windowMinutes: 300, resetsAt: RESET_AT, resetDescription: null },
    weekly: null,
    updatedAt,
    usageMetadata: { source: provider === 'claude' ? 'live-session' : 'cli' }
  })
}

const cliUsage = (overrides: HarnessOverrides = {}) =>
  createEvaluatorHarness({ usageSource: 'cli-native', ...overrides })

function authAndQuota(result: RouteAvailabilityResult | undefined) {
  return result?.snapshot.checks.filter(
    (check) => check.check === 'auth' || check.check === 'quota'
  )
}

describe('route availability on CLI usage readings', () => {
  it('reads the usage state but never refreshes it, at dispatch, re-check or a cached read', async () => {
    const h = cliUsage()
    await h.evaluator.evaluate([codex, agy], DISPATCH)
    await h.evaluator.evaluate([codex, agy], RECHECK)
    await h.evaluator.evaluate([codex, agy], { freshness: 'cached' })
    expect(h.calls.read).toBe(3)
    expect(h.calls.refresh).toBe(0)
  })

  it('passes auth and quota as not metered when no reading came from a CLI', async () => {
    const h = cliUsage({ readRateLimits: () => null })
    const results = await h.evaluator.evaluate(
      [codex, claudeSubagent, claudeHeadless, agy],
      DISPATCH
    )
    for (const result of results) {
      expect(result).toMatchObject({ status: 'available', reasons: [] })
      expect(authAndQuota(result)).toEqual([
        { check: 'auth', result: 'pass', evidence: { metered: false } },
        { check: 'quota', result: 'pass', evidence: { metered: false } }
      ])
    }
  })

  it('blocks a route whose fresh CLI reading is at 100%, with the source and reset time', async () => {
    const h = cliUsage({
      readRateLimits: () =>
        headroomOf({ codex: cliReading('codex', 100, NOW_MS - MINUTE), claude: null })
    })
    const [codexResult, claudeResult] = await h.evaluator.evaluate(
      [codex, claudeSubagent],
      DISPATCH
    )
    expect(codexResult).toMatchObject({ status: 'unavailable', reasons: ['quota_exhausted'] })
    expect(authAndQuota(codexResult)?.at(-1)).toEqual({
      check: 'quota',
      result: 'fail',
      reason: 'quota_exhausted',
      evidence: { source: 'codex_app_server', readingAtMs: NOW_MS - MINUTE, resetsAtMs: RESET_AT }
    })
    expect(codexResult?.snapshot.observedAtMs.rateLimits).toBe(NOW_MS - MINUTE)
    expect(claudeResult?.status).toBe('available')
  })

  it("blocks every Claude route, the headless reviewer included, on the status line's 100%", async () => {
    const h = cliUsage({
      readRateLimits: () => headroomOf({ claude: cliReading('claude', 100, NOW_MS - MINUTE) })
    })
    const results = await h.evaluator.evaluate([claudeSubagent, claudeHeadless, agy], DISPATCH)
    expect(results.map((result) => result.status)).toEqual([
      'unavailable',
      'unavailable',
      'available'
    ])
    expect(authAndQuota(results[1])?.at(-1)).toMatchObject({
      evidence: { source: 'claude_status_line' }
    })
  })

  it('never blocks on a stale reading', async () => {
    const h = cliUsage({
      readRateLimits: () =>
        headroomOf({ antigravity: cliReading('antigravity', 100, NOW_MS - 31 * MINUTE) })
    })
    const [result] = await h.evaluator.evaluate([agy], DISPATCH)
    expect(result?.status).toBe('available')
    expect(authAndQuota(result)?.at(-1)).toEqual({
      check: 'quota',
      result: 'pass',
      evidence: { metered: false }
    })
  })

  it('still blocks a route whose CLI reported an auth or a quota failure', async () => {
    const h = cliUsage()
    h.evaluator.latch(codex, 'auth')
    h.evaluator.latch(agy, 'quota')
    const [codexResult, agyResult, other] = await h.evaluator.evaluate(
      [codex, agy, claudeSubagent],
      DISPATCH
    )
    expect(codexResult).toMatchObject({
      status: 'unavailable',
      reasons: ['auth_failed'],
      cli: null
    })
    expect(agyResult).toMatchObject({ status: 'unavailable', reasons: ['quota_exhausted'] })
    expect(other?.status).toBe('available')
    const [cached] = await h.evaluator.evaluate([codex], { freshness: 'cached' })
    expect(cached?.status).toBe('unavailable')
  })

  it('clears a quota latch at dispatch once a newer CLI reading shows the limit reset', async () => {
    const reading = { current: cliReading('codex', 100, NOW_MS - MINUTE) }
    const h = cliUsage({ readRateLimits: () => headroomOf({ codex: reading.current }) })
    h.evaluator.latch(codex, 'quota')
    h.clock.nowMs += 5 * MINUTE
    const [held] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(held?.status).toBe('unavailable')
    reading.current = cliReading('codex', 30, h.clock.nowMs - 1_000)
    const [released] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(released?.status).toBe('available')
    expect(h.store.latchesFor(CODEX_KEY)).toEqual([])
  })

  it('keeps a quota latch while the newest CLI reading predates the failure', async () => {
    const h = cliUsage({
      readRateLimits: () => headroomOf({ codex: cliReading('codex', 30, NOW_MS - MINUTE) })
    })
    h.evaluator.latch(codex, 'quota')
    h.clock.nowMs += MINUTE
    const [result] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(result).toMatchObject({ status: 'unavailable', reasons: ['quota_exhausted'] })
    expect(h.store.latchesFor(CODEX_KEY)).toHaveLength(1)
  })

  it('keeps an auth latch through usage readings and clears it on a re-check the CLI answers', async () => {
    const h = cliUsage({
      readRateLimits: () => headroomOf({ codex: cliReading('codex', 30, NOW_MS + MINUTE) })
    })
    h.evaluator.latch(codex, 'auth')
    h.clock.nowMs += 5 * MINUTE
    const [held] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(held).toMatchObject({ status: 'unavailable', reasons: ['auth_failed'] })
    const [released] = await h.evaluator.evaluate([codex], RECHECK)
    expect(released?.status).toBe('available')
    expect(h.store.latchesFor(CODEX_KEY)).toEqual([])
  })

  it('keeps the latch when the re-check gets no answer from the CLI', async () => {
    const h = cliUsage({ models: { codex: async () => failedListing(NOW_MS + 5 * MINUTE) } })
    h.evaluator.latch(codex, 'auth')
    h.clock.nowMs += 5 * MINUTE
    const [result] = await h.evaluator.evaluate([codex], RECHECK)
    expect(result).toMatchObject({ status: 'unavailable', reasons: ['auth_failed'] })
    expect(h.store.latchesFor(CODEX_KEY)).toHaveLength(1)
  })

  it('keeps the latch when the CLI answer predates the failure', async () => {
    const h = cliUsage({ models: { codex: async () => listingOf(CODEX_MODELS, NOW_MS - MINUTE) } })
    h.evaluator.latch(codex, 'auth')
    const [result] = await h.evaluator.evaluate([codex], RECHECK)
    expect(result?.status).toBe('unavailable')
    expect(h.store.latchesFor(CODEX_KEY)).toHaveLength(1)
  })

  it('persists the latch so a restart still holds the route', async () => {
    const h = cliUsage()
    h.evaluator.latch(codex, 'auth')
    const restarted = cliUsage({ fs: h.fs })
    const [result] = await restarted.evaluator.evaluate([codex], DISPATCH)
    expect(result).toMatchObject({ status: 'unavailable', reasons: ['auth_failed'] })
  })

  it('holds every route on a damaged latch file until a re-check reads the CLI again', async () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(LATCH_FILE, '{not json', NOW_MS - 10 * MINUTE)
    const h = cliUsage({ fs })
    h.clock.nowMs += 5 * MINUTE
    const [held] = await h.evaluator.evaluate([codex], DISPATCH)
    expect(held).toMatchObject({
      status: 'unavailable',
      reasons: ['auth_failed', 'quota_exhausted']
    })
    const [released] = await h.evaluator.evaluate([codex], RECHECK)
    expect(released?.status).toBe('available')
    const [other] = await h.evaluator.evaluate([claudeSubagent], DISPATCH)
    expect(other?.status).toBe('unavailable')
  })
})
