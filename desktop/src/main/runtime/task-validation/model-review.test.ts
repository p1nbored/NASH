import { describe, expect, it } from 'vitest'
import type {
  RouteAvailabilityResult,
  RouteSubject
} from '../../routing-table/availability/route-availability-types'
import type { ReviewerResolution } from '../../routing-table/route-resolver'
import { runModelReview, selectReviewer, type ReviewerResolverPort } from './model-review'
import type { ReviewerRequest, ReviewerRunner, ReviewerRunOutcome } from './reviewer-runner'

const SNAPSHOT = {
  checkedAtMs: 0,
  freshness: 'dispatch',
  workspaceKind: 'git-worktree',
  checks: [],
  observedAtMs: { detection: 0, models: 0, rateLimits: 0 }
} as const

function subject(target: 'codex_cli' | 'claude_headless', model: string): RouteSubject {
  return {
    target,
    model,
    reasoningLevel: 'high',
    requirement: 'required',
    inheritsCoordinator: false
  }
}

function available(
  target: 'codex_cli' | 'claude_headless',
  model: string
): RouteAvailabilityResult {
  return {
    subject: subject(target, model),
    snapshot: SNAPSHOT,
    status: 'available',
    reasons: [],
    cli: {
      target,
      model,
      effort: 'high',
      effortDelivery: target === 'codex_cli' ? 'codex_config_override' : 'claude_effort_flag',
      requestedLevel: 'high',
      requirement: 'required',
      resolution: 'applied'
    }
  }
}

function unverified(model: string): RouteAvailabilityResult {
  return {
    subject: subject('claude_headless', model),
    snapshot: SNAPSHOT,
    status: 'unverified',
    reasons: ['auth_unobserved'],
    cli: null
  }
}

function resolverAnswering(resolution: ReviewerResolution): ReviewerResolverPort & {
  asked: (string | null | undefined)[]
  latched: [RouteSubject, string][]
} {
  const asked: (string | null | undefined)[] = []
  const latched: [RouteSubject, string][] = []
  return {
    asked,
    latched,
    resolveValidationReviewer: async (input) => {
      asked.push(input.workModel)
      return resolution
    },
    latch: (routeSubject, kind) => {
      latched.push([routeSubject, kind])
    }
  }
}

const TABLE = { version: 1, sha256: 'c'.repeat(64) }
const codexReviewer = (model = 'gpt-6.1-sol'): ReviewerResolution => ({
  ok: true,
  table: TABLE,
  reviewer: { target: 'codex_cli', model, reasoning_level: 'high' },
  availability: available('codex_cli', model)
})

const PASS = JSON.stringify({
  verdict: 'pass',
  criteria: [{ index: 1, met: true, reason: 'The report exists.' }],
  summary: 'The work meets its criterion.'
})

function runnerAnswering(
  outcome: ReviewerRunOutcome
): ReviewerRunner & { requests: ReviewerRequest[] } {
  const requests: ReviewerRequest[] = []
  const runner: ReviewerRunner = async (request) => {
    requests.push(request)
    return outcome
  }
  return Object.assign(runner, { requests })
}

const SELECT = { workModel: 'claude-sonnet-5-5', workspaceId: 'repo::/repo' }

describe('reviewer selection (D-020)', () => {
  it('asks for the first reviewer of a different model, with the work model normalized', async () => {
    const resolver = resolverAnswering(codexReviewer())
    const selection = await selectReviewer(
      { ...SELECT, workModel: 'claude-sonnet-5-5-high' },
      resolver
    )
    expect(resolver.asked).toEqual(['claude-sonnet-5-5'])
    expect(selection).toMatchObject({
      ok: true,
      reviewer: { target: 'codex_cli', model: 'gpt-6.1-sol', effort: 'high' }
    })
  })

  it('does not dispatch an unavailable or unverified reviewer, and names it for the record', async () => {
    const resolver = resolverAnswering({
      ok: true,
      table: TABLE,
      reviewer: { target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'high' },
      availability: unverified('claude-opus-5-5')
    })
    expect(await selectReviewer(SELECT, resolver)).toMatchObject({
      ok: false,
      reviewerModel: 'claude-opus-5-5',
      reason: 'reviewer_unverified'
    })
    expect(resolver.asked).toHaveLength(1)
  })

  it('refuses a reviewer the table chose that is the work model under another spelling', async () => {
    const resolver = resolverAnswering(codexReviewer('gpt-6.1-sol-high'))
    expect(await selectReviewer({ ...SELECT, workModel: 'gpt-6.1-sol' }, resolver)).toMatchObject({
      ok: false,
      reviewerModel: null,
      reason: 'reviewer_not_independent'
    })
  })

  it('has no reviewer when the work model is unknown, none is independent, or the table is missing', async () => {
    const resolver = resolverAnswering(codexReviewer())
    expect(await selectReviewer({ ...SELECT, workModel: 'opus' }, resolver)).toMatchObject({
      ok: false,
      reason: 'work_model_unknown'
    })
    expect(resolver.asked).toEqual([])
    for (const reason of ['no_independent_reviewer', 'routing_table_not_installed'] as const) {
      expect(await selectReviewer(SELECT, resolverAnswering({ ok: false, reason }))).toMatchObject({
        ok: false,
        reviewerModel: null,
        reason
      })
    }
  })
})

describe('model review run', () => {
  async function review(
    outcome: ReviewerRunOutcome,
    workModel = 'claude-sonnet-5-5',
    resolution: ReviewerResolution = codexReviewer()
  ) {
    const resolver = resolverAnswering(resolution)
    const selection = await selectReviewer({ ...SELECT, workModel }, resolver)
    if (!selection.ok) {
      throw new Error('fixture selection failed')
    }
    const runner = runnerAnswering(outcome)
    const result = await runModelReview(
      selection,
      {
        prompt: 'Review prompt.',
        criteriaCount: 1,
        workModel,
        workspacePath: 'C:/repo',
        workspaceKind: 'folder',
        runId: 'review-1'
      },
      { resolver, runners: { codex_cli: runner, claude_headless: runnerAnswering(outcome) } }
    )
    return { result, runner, resolver }
  }

  it('runs the selected reviewer read-only and turns its verdict into checks with evidence', async () => {
    const { result, runner } = await review({
      status: 'completed',
      text: PASS,
      outputSha256: 'd'.repeat(64),
      reportedModels: []
    })
    expect(runner.requests[0]).toMatchObject({
      model: 'gpt-6.1-sol',
      effort: 'high',
      workspacePath: 'C:/repo',
      workspaceKind: 'folder',
      runId: 'review-1'
    })
    expect(result.checks.map((check) => [check.kind, check.status])).toEqual([
      ['model_review', 'pass'],
      ['review_criterion', 'pass']
    ])
    expect(result.evidence).toEqual([
      { kind: 'review_output', ref: 'd'.repeat(64) },
      { kind: 'reviewer_run', ref: 'review-1' }
    ])
  })

  it('cannot decide when the reply is malformed or the CLI reports serving the work model', async () => {
    const malformed = await review({
      status: 'completed',
      text: 'Looks good.',
      outputSha256: 'd'.repeat(64),
      reportedModels: []
    })
    expect(malformed.result.checks).toEqual([
      expect.objectContaining({ kind: 'model_review', status: 'inconclusive' })
    ])
    const same = await review({
      status: 'completed',
      text: PASS,
      outputSha256: 'd'.repeat(64),
      reportedModels: ['claude-sonnet-5-5']
    })
    expect(same.result.checks).toEqual([expect.objectContaining({ status: 'inconclusive' })])
  })

  it('latches the reviewer route on a blocked run and cannot decide', async () => {
    const { result, resolver } = await review({ status: 'blocked', reason: 'auth' })
    expect(resolver.latched).toEqual([[subject('codex_cli', 'gpt-6.1-sol'), 'auth']])
    expect(result.checks).toEqual([
      expect.objectContaining({ status: 'inconclusive', note: 'The reviewer was blocked (auth).' })
    ])
  })

  it('cannot decide when the run failed or could not start', async () => {
    for (const outcome of [
      { status: 'failed', reason: 'timed_out' },
      { status: 'unavailable', reason: 'cli_missing' }
    ] as const) {
      const { result } = await review(outcome)
      expect(result.checks).toEqual([
        expect.objectContaining({ kind: 'model_review', status: 'inconclusive' })
      ])
    }
  })

  it('cannot decide when the CLI reports a model it cannot show is different', async () => {
    const unknown = await review({
      status: 'completed',
      text: PASS,
      outputSha256: 'd'.repeat(64),
      reportedModels: ['opus']
    })
    expect(unknown.result.checks).toEqual([expect.objectContaining({ status: 'inconclusive' })])
  })

  it('needs the headless Claude reviewer to report which model served it', async () => {
    const claude: ReviewerResolution = {
      ok: true,
      table: TABLE,
      reviewer: { target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'high' },
      availability: available('claude_headless', 'claude-opus-5-5')
    }
    const completed = (reportedModels: string[]): ReviewerRunOutcome => ({
      status: 'completed',
      text: PASS,
      outputSha256: 'd'.repeat(64),
      reportedModels
    })
    const silent = await review(completed([]), 'gpt-6.1-sol', claude)
    expect(silent.result.checks).toEqual([expect.objectContaining({ status: 'inconclusive' })])
    const reported = await review(completed(['claude-opus-5-5']), 'gpt-6.1-sol', claude)
    expect(reported.result.checks[0]).toMatchObject({ kind: 'model_review', status: 'pass' })
  })
})
