import { describe, expect, it } from 'vitest'
import { resolveAgentSessionOptionLaunch } from '../../../shared/agent-session-option-launch'
import type { UsageRateLimitFailureKind } from '../../../shared/rate-limit-types'
import { checkClaudeRoute } from './claude-route-checks'
import type { ListedModel } from './model-listing'
import {
  CLAUDE_MODELS,
  NOW_MS,
  detectionOf,
  headroomOf,
  limitsOf,
  listingOf,
  observationsOf,
  failedListing,
  subjectOf
} from './route-availability.test-fixture'
import type { CheckOutcome } from './route-availability-types'

function outcome(checks: readonly CheckOutcome[], name: CheckOutcome['check']) {
  return checks.find((check) => check.check === name)
}

const subagent = (model: string, level: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'max') =>
  subjectOf('claude_subagent', model, level)

describe('claude model check', () => {
  it('passes a pinned full id that the listing names only as a resolved model', () => {
    const { checks, mapping } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    expect(outcome(checks, 'model')).toMatchObject({
      result: 'pass',
      evidence: { matchedBy: 'resolvedModel' }
    })
    expect(checks.every((check) => check.result === 'pass')).toBe(true)
    expect(mapping).toEqual({
      status: 'resolved',
      effort: 'max',
      delivery: 'claude_agents_field',
      resolution: 'applied'
    })
  })

  it('passes a pinned id the listing names as the value itself', () => {
    const { checks } = checkClaudeRoute(
      subagent('claude-fable-5-1'),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    expect(outcome(checks, 'model')).toMatchObject({
      result: 'pass',
      evidence: { matchedBy: 'id' }
    })
  })

  it('fails a model the listing does not name, and then skips the reasoning check', () => {
    const { checks, mapping } = checkClaudeRoute(
      subagent('claude-opus-9-9'),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    expect(outcome(checks, 'model')).toMatchObject({ result: 'fail', reason: 'model_not_listed' })
    expect(outcome(checks, 'reasoning')).toBeUndefined()
    expect(mapping).toBeNull()
  })

  it('never admits a model from an empty listing', () => {
    const { checks } = checkClaudeRoute(subagent('claude-opus-5-5'), observationsOf(listingOf([])))
    expect(outcome(checks, 'model')).toMatchObject({
      result: 'unobserved',
      reason: 'model_list_unavailable'
    })
    expect(outcome(checks, 'reasoning')).toBeUndefined()
  })

  it('is unobserved when the listing could not be read', () => {
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(failedListing())
    )
    expect(outcome(checks, 'model')).toMatchObject({
      result: 'unobserved',
      reason: 'model_list_unavailable'
    })
  })

  it('excludes an alias even though the listing carries it, because an alias pins nothing', () => {
    const { checks } = checkClaudeRoute(subagent('opus'), observationsOf(listingOf(CLAUDE_MODELS)))
    expect(outcome(checks, 'model')).toMatchObject({ result: 'fail', reason: 'model_excluded' })
  })

  it('rejects a Gemini 4 id absent from the Claude listing', () => {
    const { checks } = checkClaudeRoute(
      subagent('gemini-4-flash-high'),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    expect(outcome(checks, 'model')).toMatchObject({ result: 'fail', reason: 'model_not_listed' })
  })
})

describe('claude reasoning check', () => {
  it('refuses any level on a model without effort control (Haiku 4.5)', () => {
    const { checks } = checkClaudeRoute(
      subagent('claude-haiku-4-5-20251001', 'high'),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'fail',
      reason: 'reasoning_unsupported'
    })
  })

  it('lets an if_supported level pass on that model and records that no effort is sent', () => {
    const { checks, mapping } = checkClaudeRoute(
      subjectOf('claude_subagent', 'claude-haiku-4-5-20251001', 'high', 'if_supported'),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'pass',
      evidence: { resolution: 'omitted_unsupported' }
    })
    expect(mapping).toMatchObject({ effort: null, delivery: 'omitted' })
  })

  it('refuses a level missing from the model`s own list, such as max on a model listing three', () => {
    const limited: ListedModel = {
      id: 'claude-mid-1-0',
      resolvedModel: null,
      label: 'Mid',
      efforts: ['low', 'medium', 'high']
    }
    const { checks } = checkClaudeRoute(
      subagent('claude-mid-1-0'),
      observationsOf(listingOf([...CLAUDE_MODELS, limited]))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'fail',
      reason: 'reasoning_unsupported'
    })
  })

  it('is unverified when no listed model carries any effort data', () => {
    const bare = CLAUDE_MODELS.map((model) => ({ ...model, efforts: [] }))
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(bare))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({
      result: 'unobserved',
      reason: 'reasoning_unverified'
    })
  })

  it('needs every row that matches the pinned id to list the level', () => {
    const twin: ListedModel = {
      id: 'opus[1m]',
      resolvedModel: 'claude-opus-5-5',
      label: 'Opus 5.5 (1M)',
      efforts: ['low', 'medium', 'high']
    }
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf([...CLAUDE_MODELS, twin]))
    )
    expect(outcome(checks, 'reasoning')).toMatchObject({ result: 'fail' })
  })

  it.each([
    ['claude_primary', 'claude_effort_flag'],
    ['claude_headless', 'claude_effort_flag'],
    ['claude_subagent', 'claude_agents_field']
  ] as const)('delivers the level for %s as %s', (target, delivery) => {
    const { mapping } = checkClaudeRoute(
      subjectOf(target, 'claude-sonnet-5-5', 'high'),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    expect(mapping).toMatchObject({ status: 'resolved', effort: 'high', delivery })
  })

  it('sends nothing for a workflow that inherits the coordinator configuration', () => {
    const { mapping } = checkClaudeRoute(
      subjectOf('claude_workflow', 'claude-opus-5-5', 'max', 'required', true),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    expect(mapping).toMatchObject({
      effort: null,
      delivery: 'claude_inherited',
      resolution: 'applied'
    })
  })

  it('resolves an effort that Orca`s own launch catalog accepts for the session flag', () => {
    const { mapping } = checkClaudeRoute(
      subjectOf('claude_primary', 'claude-opus-5-5', 'max'),
      observationsOf(listingOf(CLAUDE_MODELS))
    )
    const effort = mapping?.status === 'resolved' ? mapping.effort : null
    expect(effort).toBe('max')
    const launch = resolveAgentSessionOptionLaunch(
      'claude',
      { model: 'claude-opus-5-5', effort: effort ?? '' },
      [],
      false
    )
    expect(launch.args).toEqual(['--model', 'claude-opus-5-5', '--effort', 'max'])
  })
})

describe('claude cli, auth and quota checks', () => {
  it('fails cli_missing and still reports the other checks it could make', () => {
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(CLAUDE_MODELS), { detection: detectionOf(['codex']) })
    )
    expect(outcome(checks, 'cli')).toMatchObject({ result: 'fail', reason: 'cli_missing' })
    expect(outcome(checks, 'model')).toMatchObject({ result: 'pass' })
  })

  it('fails cli_disabled for an agent the user turned off', () => {
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(CLAUDE_MODELS), { detection: detectionOf(undefined, ['claude']) })
    )
    expect(outcome(checks, 'cli')).toMatchObject({ result: 'fail', reason: 'cli_disabled' })
  })

  it.each([
    ['stale-token', 'auth_failed'],
    ['missing-scope', 'auth_failed'],
    ['no-subscription', 'not_entitled']
  ] as const)('maps the %s reading to %s', (kind: UsageRateLimitFailureKind, reason) => {
    const rateLimits = headroomOf({
      claude: limitsOf('claude', { status: 'error', usageMetadata: { failureKind: kind } })
    })
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(CLAUDE_MODELS), { rateLimits })
    )
    expect(outcome(checks, 'auth')).toMatchObject({ result: 'fail', reason })
  })

  it('is unobserved for auth without a reading, which cannot dispatch', () => {
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(CLAUDE_MODELS), { rateLimits: null })
    )
    expect(outcome(checks, 'auth')).toMatchObject({
      result: 'unobserved',
      reason: 'auth_unobserved'
    })
  })

  it('fails quota_exhausted for a known exhausted claude window', () => {
    const exhausted = {
      usedPercent: 100,
      windowMinutes: 300,
      resetsAt: NOW_MS + 1_000,
      resetDescription: null
    }
    const rateLimits = headroomOf({ claude: limitsOf('claude', { session: exhausted }) })
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(CLAUDE_MODELS), { rateLimits })
    )
    expect(outcome(checks, 'quota')).toMatchObject({ result: 'fail', reason: 'quota_exhausted' })
  })

  it('does not look at the workspace: Claude runs in folder workspaces too', () => {
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(CLAUDE_MODELS), { workspaceKind: 'folder' })
    )
    expect(outcome(checks, 'workspace')).toBeUndefined()
  })
})

describe('claude auth inherited from a live primary session', () => {
  const LIVE = {
    runId: 'run-1',
    ownerId: 'owner-1',
    agent: 'claude' as const,
    model: 'claude-opus-5-5',
    effort: 'max' as const
  }
  const deferredLimits = (kind: UsageRateLimitFailureKind = 'deferred-by-live-session') =>
    headroomOf({
      claude: limitsOf('claude', { status: 'error', usageMetadata: { failureKind: kind } })
    })
  const authOf = (
    subject: ReturnType<typeof subjectOf>,
    overrides: Parameters<typeof observationsOf>[1] = {}
  ) =>
    outcome(
      checkClaudeRoute(
        subject,
        observationsOf(listingOf(CLAUDE_MODELS), { rateLimits: deferredLimits(), ...overrides })
      ).checks,
      'auth'
    )

  it.each(['claude_subagent', 'claude_workflow'] as const)(
    'passes a %s route that runs inside the live primary, and records where the login came from',
    (target) => {
      expect(authOf(subjectOf(target, 'claude-opus-5-5', 'max'), { liveRunPrimary: LIVE })).toEqual(
        {
          check: 'auth',
          result: 'pass',
          evidence: {
            basis: 'auth_inherited_from_live_primary',
            runId: 'run-1',
            ownerId: 'owner-1'
          }
        }
      )
    }
  )

  it('does not inherit Claude authentication from a live Codex primary', () => {
    const subject = subjectOf(
      'claude_subagent',
      'claude-opus-5-5',
      'max',
      'required',
      false,
      'codex'
    )
    expect(authOf(subject, { liveRunPrimary: { ...LIVE, agent: 'codex' } })).toMatchObject({
      result: 'unobserved',
      reason: 'auth_unobserved'
    })
    const result = checkClaudeRoute(subject, observationsOf(listingOf(CLAUDE_MODELS)))
    expect(result.mapping).toMatchObject({ delivery: 'claude_effort_flag' })
  })

  it('does not apply to the primary session itself or to the separate headless process', () => {
    for (const target of ['claude_primary', 'claude_headless'] as const) {
      expect(
        authOf(subjectOf(target, 'claude-opus-5-5', 'max'), { liveRunPrimary: LIVE })
      ).toMatchObject({ result: 'unobserved', reason: 'auth_unobserved' })
    }
  })

  it('stays unobserved without evidence of a live primary, or with blank ids', () => {
    const subject = subagent('claude-opus-5-5')
    expect(authOf(subject)).toMatchObject({ result: 'unobserved', reason: 'auth_unobserved' })
    for (const liveRunPrimary of [
      { ...LIVE, runId: '' },
      { ...LIVE, ownerId: '  ' }
    ]) {
      expect(authOf(subject, { liveRunPrimary })).toMatchObject({ result: 'unobserved' })
    }
  })

  it('applies only to the live-session deferral: a login failure or a network error is unchanged', () => {
    const subject = subagent('claude-opus-5-5')
    expect(
      authOf(subject, { liveRunPrimary: LIVE, rateLimits: deferredLimits('stale-token') })
    ).toMatchObject({ result: 'fail', reason: 'auth_failed' })
    expect(
      authOf(subject, { liveRunPrimary: LIVE, rateLimits: deferredLimits('network') })
    ).toMatchObject({ result: 'unobserved', reason: 'auth_unobserved' })
    expect(
      authOf(subject, { liveRunPrimary: LIVE, rateLimits: deferredLimits('no-subscription') })
    ).toMatchObject({ result: 'fail', reason: 'not_entitled' })
  })

  it('records no inheritance when a fresh successful reading already proves the login', () => {
    expect(
      authOf(subagent('claude-opus-5-5'), { liveRunPrimary: LIVE, rateLimits: headroomOf() })
    ).toEqual({ check: 'auth', result: 'pass' })
  })

  it('leaves the quota check as it was', () => {
    const exhausted = {
      usedPercent: 100,
      windowMinutes: 300,
      resetsAt: NOW_MS + 1_000,
      resetDescription: null
    }
    const rateLimits = headroomOf({
      claude: limitsOf('claude', {
        status: 'error',
        session: exhausted,
        usageMetadata: { failureKind: 'deferred-by-live-session' }
      })
    })
    const { checks } = checkClaudeRoute(
      subagent('claude-opus-5-5'),
      observationsOf(listingOf(CLAUDE_MODELS), { rateLimits, liveRunPrimary: LIVE })
    )
    expect(outcome(checks, 'auth')).toMatchObject({ result: 'pass' })
    expect(outcome(checks, 'quota')).toMatchObject({ result: 'fail', reason: 'quota_exhausted' })
  })
})
