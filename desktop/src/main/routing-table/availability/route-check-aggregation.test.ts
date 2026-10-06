import { describe, expect, it } from 'vitest'
import { buildRouteResult, statusFromChecks } from './route-check-aggregation'
import { isDispatchable } from './route-availability-types'
import type { RouteCheckResult } from './route-check-observations'
import { NOW_MS, subjectOf } from './route-availability.test-fixture'
import type { CheckOutcome } from './route-availability-types'

const pass = (check: CheckOutcome['check']): CheckOutcome => ({ check, result: 'pass' })
const context = {
  freshness: 'dispatch',
  nowMs: NOW_MS,
  workspaceKind: 'git-worktree',
  observedAtMs: { detection: NOW_MS, models: NOW_MS - 1_000, rateLimits: NOW_MS - 2_000 }
} as const
const resolved = {
  status: 'resolved',
  effort: 'max',
  delivery: 'codex_config_override',
  resolution: 'applied'
} as const

describe('statusFromChecks', () => {
  it('is available only when every check passes', () => {
    expect(statusFromChecks([pass('cli'), pass('model')])).toEqual({
      status: 'available',
      reasons: []
    })
  })

  it('is unavailable with every failing reason, in check order, without repeats', () => {
    const checks: CheckOutcome[] = [
      { check: 'cli', result: 'fail', reason: 'cli_missing' },
      pass('model'),
      { check: 'auth', result: 'fail', reason: 'auth_failed' },
      { check: 'latch', result: 'fail', reason: 'auth_failed' }
    ]
    expect(statusFromChecks(checks)).toEqual({
      status: 'unavailable',
      reasons: ['cli_missing', 'auth_failed']
    })
  })

  it('lets a certain failure outrank an unobserved check', () => {
    const checks: CheckOutcome[] = [
      { check: 'auth', result: 'unobserved', reason: 'auth_unobserved' },
      { check: 'quota', result: 'fail', reason: 'quota_exhausted' }
    ]
    expect(statusFromChecks(checks)).toEqual({
      status: 'unavailable',
      reasons: ['quota_exhausted']
    })
  })

  it('is unverified when something is unobserved and nothing failed', () => {
    const checks: CheckOutcome[] = [
      pass('cli'),
      { check: 'model', result: 'unobserved', reason: 'model_list_unavailable' },
      { check: 'auth', result: 'unobserved', reason: 'auth_unobserved' }
    ]
    expect(statusFromChecks(checks)).toEqual({
      status: 'unverified',
      reasons: ['model_list_unavailable', 'auth_unobserved']
    })
  })

  it('is unverified for no checks at all: nothing was proven', () => {
    expect(statusFromChecks([])).toEqual({
      status: 'unverified',
      reasons: ['cli_unobserved']
    })
  })
})

describe('buildRouteResult', () => {
  const subject = subjectOf('codex_cli', 'gpt-6.1-sol', 'max')

  it('carries the resolved CLI setting only for an available route', () => {
    const input: RouteCheckResult = { checks: [pass('cli'), pass('model')], mapping: resolved }
    const result = buildRouteResult(subject, input, context)
    expect(result.status).toBe('available')
    expect(result.cli).toEqual({
      target: 'codex_cli',
      model: 'gpt-6.1-sol',
      effort: 'max',
      effortDelivery: 'codex_config_override',
      requestedLevel: 'max',
      requirement: 'required',
      resolution: 'applied'
    })
  })

  it('has no CLI setting when any check failed, and keeps the whole snapshot', () => {
    const input: RouteCheckResult = {
      checks: [pass('cli'), { check: 'workspace', result: 'fail', reason: 'workspace_not_git' }],
      mapping: resolved
    }
    const result = buildRouteResult(subject, input, context)
    expect(result).toMatchObject({
      status: 'unavailable',
      reasons: ['workspace_not_git'],
      cli: null
    })
    expect(result.snapshot).toEqual({
      checkedAtMs: NOW_MS,
      freshness: 'dispatch',
      workspaceKind: 'git-worktree',
      checks: input.checks,
      observedAtMs: context.observedAtMs
    })
  })

  it('refuses to call a route available when the reasoning setting was not resolved', () => {
    for (const mapping of [null, { status: 'unsupported' }, { status: 'unverified' }] as const) {
      const result = buildRouteResult(subject, { checks: [pass('cli')], mapping }, context)
      expect(result).toMatchObject({
        status: 'unverified',
        reasons: ['reasoning_unverified'],
        cli: null
      })
    }
  })

  it('keeps the subject it was asked about', () => {
    const result = buildRouteResult(subject, { checks: [pass('cli')], mapping: resolved }, context)
    expect(result.subject).toBe(subject)
  })
})

describe('isDispatchable', () => {
  const subject = subjectOf('codex_cli', 'gpt-6.1-sol', 'max')

  it('lets only an available route dispatch, not an unverified or unavailable one', () => {
    const available = buildRouteResult(
      subject,
      { checks: [pass('cli')], mapping: resolved },
      context
    )
    const unverified = buildRouteResult(
      subject,
      {
        checks: [{ check: 'auth', result: 'unobserved', reason: 'auth_unobserved' }],
        mapping: resolved
      },
      context
    )
    const unavailable = buildRouteResult(
      subject,
      { checks: [{ check: 'cli', result: 'fail', reason: 'cli_missing' }], mapping: resolved },
      context
    )
    expect([available, unverified, unavailable].map(isDispatchable)).toEqual([true, false, false])
  })
})
