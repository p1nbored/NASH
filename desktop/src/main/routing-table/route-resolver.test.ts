import { describe, expect, it } from 'vitest'
import { ROUTING_TASK_TYPES } from '../../shared/routing-table/routing-table-taxonomy'
import {
  activateRoutingTable,
  ensureActiveRoutingTable,
  resolveActiveRoutingTable
} from './routing-table-activation'
import {
  createEvaluatorHarness,
  type HarnessOverrides
} from './availability/route-availability-harness.test-fixture'
import { headroomOf, limitsOf } from './availability/route-availability.test-fixture'
import { isDispatchable } from './availability/route-availability-types'
import { createRouteResolver } from './route-resolver'
import {
  createTestRoutingTableEnvironment,
  parsedTestTable,
  versionFilePath
} from './routing-table-test-context.test-fixture'

const GIT = { kind: 'git-worktree' } as const

function setup(
  overrides: HarnessOverrides = {},
  envOptions: Parameters<typeof createTestRoutingTableEnvironment>[0] = {}
) {
  const env = createTestRoutingTableEnvironment(envOptions)
  const installed = ensureActiveRoutingTable(env.ctx)
  const h = createEvaluatorHarness(overrides)
  const resolver = createRouteResolver({
    activeTable: () => resolveActiveRoutingTable(env.ctx),
    evaluator: h.evaluator
  })
  return { env, h, resolver, installed }
}

function untouched(h: ReturnType<typeof createEvaluatorHarness>): boolean {
  return Object.values(h.calls).every((count) => count === 0)
}

describe('resolveRoute', () => {
  it('resolves a row of the active table with its version, hash and configured values', async () => {
    const { resolver, installed } = setup()
    const resolution = await resolver.resolveRoute({
      taskType: 'software_engineering',
      workspace: GIT
    })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok || !installed.ok) {
      return
    }
    expect(resolution.route).toMatchObject({
      taskType: 'software_engineering',
      target: 'claude_subagent',
      table: { version: installed.version, sha256: installed.sha256 },
      configured: { model: 'claude-sonnet-5-5', reasoningLevel: 'max', requirement: 'required' }
    })
    expect(resolution.route.availability).toMatchObject({
      status: 'available',
      cli: { model: 'claude-sonnet-5-5', effort: 'max', effortDelivery: 'claude_agents_field' }
    })
  })

  it('resolves every task type of the default table when everything is available', async () => {
    const { resolver } = setup()
    const statuses: Record<string, string> = {}
    for (const taskType of ROUTING_TASK_TYPES) {
      const resolution = await resolver.resolveRoute({ taskType, workspace: GIT })
      statuses[taskType] = resolution.ok ? resolution.route.availability.status : resolution.reason
    }
    expect(Object.values(statuses).every((status) => status === 'available')).toBe(true)
    expect(Object.keys(statuses)).toEqual([...ROUTING_TASK_TYPES])
  })

  it('keeps the inherited rows on the coordinator configuration and records that they inherit', async () => {
    const { resolver } = setup()
    const primary = await resolver.resolveRoute({
      taskType: 'coordinator_reasoning',
      workspace: GIT
    })
    const workflow = await resolver.resolveRoute({
      taskType: 'configured_project_workflow',
      workspace: GIT
    })
    expect(primary.ok && primary.route.configured).toMatchObject({
      model: 'inherit',
      reasoningLevel: 'inherit'
    })
    expect(primary.ok && primary.route.availability.subject).toMatchObject({
      target: 'claude_primary',
      model: 'claude-opus-5-5',
      reasoningLevel: 'max',
      inheritsCoordinator: true
    })
    expect(workflow.ok && workflow.route.availability.cli).toMatchObject({
      effort: null,
      effortDelivery: 'claude_inherited'
    })
  })

  it('resolves the agy row to the variant id with no effort flag', async () => {
    const { resolver } = setup()
    const resolution = await resolver.resolveRoute({
      taskType: 'fast_writing_or_alternative_draft',
      workspace: GIT
    })
    expect(resolution.ok && resolution.route.availability.cli).toMatchObject({
      model: 'gemini-3.8-flash-high',
      effort: null,
      effortDelivery: 'agy_model_id_variant',
      requirement: 'if_supported',
      resolution: 'encoded_in_model_id'
    })
  })

  it('keeps the codex rows available in a folder workspace, like the others (D-027)', async () => {
    const { resolver } = setup()
    const results: Record<string, unknown> = {}
    for (const taskType of ROUTING_TASK_TYPES) {
      const resolution = await resolver.resolveRoute({ taskType, workspace: { kind: 'folder' } })
      results[taskType] = resolution.ok
        ? [
            resolution.route.target,
            resolution.route.availability.status,
            resolution.route.availability.reasons
          ]
        : resolution.reason
    }
    expect(results.scientific_experiment_validation).toEqual(['codex_cli', 'available', []])
    expect(results.routine_analysis_batch).toEqual(['codex_cli', 'available', []])
    expect(results.software_engineering).toEqual(['claude_subagent', 'available', []])
    expect(results.fast_writing_or_alternative_draft).toEqual(['agy_cli', 'available', []])
  })

  it('never substitutes a route: a missing CLI leaves that row unavailable and its model unchanged', async () => {
    const { resolver } = setup({ detected: async () => ['claude', 'antigravity'] })
    const codex = await resolver.resolveRoute({
      taskType: 'general_research_analysis',
      workspace: GIT
    })
    expect(codex.ok && codex.route.availability).toMatchObject({
      status: 'unavailable',
      reasons: ['cli_missing'],
      cli: null,
      subject: { target: 'codex_cli', model: 'gpt-6.1-sol', reasoningLevel: 'max' }
    })
    const claude = await resolver.resolveRoute({ taskType: 'software_engineering', workspace: GIT })
    expect(claude.ok && claude.route.availability.status).toBe('available')
  })

  it('cannot dispatch while the login is unobserved: that route is unverified, not available', async () => {
    const { resolver } = setup({ readRateLimits: () => null })
    const resolution = await resolver.resolveRoute({
      taskType: 'software_engineering',
      workspace: GIT
    })
    expect(resolution.ok && resolution.route.availability).toMatchObject({
      status: 'unverified',
      reasons: ['auth_unobserved'],
      cli: null
    })
    expect(resolution.ok && isDispatchable(resolution.route.availability)).toBe(false)
  })

  describe('with a live primary session', () => {
    const LIVE = {
      runId: 'run-1',
      ownerId: 'owner-1',
      agent: 'claude' as const,
      model: 'claude-opus-5-5',
      effort: 'max' as const
    }
    const deferred = () =>
      headroomOf({
        claude: limitsOf('claude', {
          status: 'error',
          usageMetadata: { failureKind: 'deferred-by-live-session' }
        })
      })

    it('lets the in-session routes pass on the login of the primary session', async () => {
      const { resolver } = setup({ readRateLimits: deferred })
      for (const taskType of ['software_engineering', 'configured_project_workflow'] as const) {
        const resolution = await resolver.resolveRoute({
          taskType,
          workspace: GIT,
          liveRunPrimary: LIVE
        })
        expect(resolution.ok && resolution.route.availability.status).toBe('available')
        expect(
          resolution.ok &&
            resolution.route.availability.snapshot.checks.find((check) => check.check === 'auth')
        ).toMatchObject({ evidence: { basis: 'auth_inherited_from_live_primary' } })
      }
    })

    it('stays unverified without that evidence, for the primary row, and for a headless reviewer', async () => {
      const { resolver } = setup({ readRateLimits: deferred })
      const bare = await resolver.resolveRoute({ taskType: 'software_engineering', workspace: GIT })
      expect(bare.ok && bare.route.availability).toMatchObject({
        status: 'unverified',
        reasons: ['auth_unobserved']
      })
      const primary = await resolver.resolveRoute({
        taskType: 'coordinator_reasoning',
        workspace: GIT,
        liveRunPrimary: LIVE
      })
      expect(primary.ok && primary.route.availability.status).toBe('unverified')
      const reviewer = await resolver.resolveValidationReviewer({
        workModel: 'gpt-6.1-sol',
        workspace: GIT,
        liveRunPrimary: LIVE
      })
      expect(reviewer.ok && reviewer.availability.status).toBe('unverified')
    })

    it('still holds an executor-reported auth failure', async () => {
      const { resolver } = setup({ readRateLimits: deferred })
      const first = await resolver.resolveRoute({
        taskType: 'software_engineering',
        workspace: GIT,
        liveRunPrimary: LIVE
      })
      if (!first.ok) {
        throw new Error('route not resolved')
      }
      resolver.latch(first.route.availability.subject, 'auth')
      const held = await resolver.resolveRoute({
        taskType: 'software_engineering',
        workspace: GIT,
        liveRunPrimary: LIVE
      })
      expect(held.ok && held.route.availability).toMatchObject({
        status: 'unavailable',
        reasons: ['auth_failed']
      })
    })
  })

  it('refuses a task type the table does not route, without checking anything', async () => {
    const { resolver, h } = setup()
    for (const taskType of ['needs_clarification', 'made_up', '', '__proto__', 'constructor']) {
      expect(await resolver.resolveRoute({ taskType })).toEqual({
        ok: false,
        reason: 'unknown_task_type'
      })
    }
    expect(untouched(h)).toBe(true)
  })

  it('defaults to a dispatch-time check and honours a cached read', async () => {
    const { resolver, h } = setup()
    await resolver.resolveRoute({ taskType: 'software_engineering' })
    expect(h.calls.detect).toBe(1)
    const cached = await resolver.resolveRoute({
      taskType: 'software_engineering',
      freshness: 'cached'
    })
    expect(cached.ok && cached.route.availability.snapshot.freshness).toBe('cached')
    expect(h.calls.detect).toBe(1)
  })
})

describe('the active table gates everything', () => {
  it('reports a table that was never installed, without checking anything', async () => {
    const env = createTestRoutingTableEnvironment()
    const h = createEvaluatorHarness()
    const resolver = createRouteResolver({
      activeTable: () => resolveActiveRoutingTable(env.ctx),
      evaluator: h.evaluator
    })
    expect(await resolver.resolveRoute({ taskType: 'software_engineering' })).toEqual({
      ok: false,
      reason: 'routing_table_not_installed'
    })
    expect((await resolver.resolveCoordinator({})).ok).toBe(false)
    expect(untouched(h)).toBe(true)
  })

  it('reports a damaged table and never falls back to the bundled one', async () => {
    const { env, resolver, h } = setup()
    env.fs.files.set(versionFilePath(1), '{"tampered":true}')
    const resolution = await resolver.resolveRoute({ taskType: 'software_engineering' })
    expect(resolution).toMatchObject({ ok: false, reason: 'routing_table_integrity_failed' })
    expect(untouched(h)).toBe(true)
  })

  it('refuses a table of another taxonomy', async () => {
    const first = setup()
    const other = createTestRoutingTableEnvironment({
      fs: first.env.fs,
      expectedTaxonomyVersion: 3
    })
    const h = createEvaluatorHarness()
    const resolver = createRouteResolver({
      activeTable: () => resolveActiveRoutingTable(other.ctx),
      evaluator: h.evaluator
    })
    expect(await resolver.resolveRoute({ taskType: 'software_engineering' })).toMatchObject({
      ok: false,
      reason: 'routing_table_taxonomy_mismatch'
    })
  })
})

describe('resolveCoordinator', () => {
  it('checks the coordinator configuration as the primary session', async () => {
    const { resolver, installed } = setup()
    const resolution = await resolver.resolveCoordinator({ workspace: GIT })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok || !installed.ok) {
      return
    }
    expect(resolution.table).toEqual({ version: installed.version, sha256: installed.sha256 })
    expect(resolution.coordinator).toEqual({ model: 'claude-opus-5-5', reasoningLevel: 'max' })
    expect(resolution.availability).toMatchObject({
      status: 'available',
      cli: { target: 'claude_primary', effort: 'max', effortDelivery: 'claude_effort_flag' }
    })
  })

  it('blocks the coordinator when claude is not usable, with the reasons', async () => {
    const { resolver } = setup({ detected: async () => ['codex'] })
    const resolution = await resolver.resolveCoordinator({ workspace: GIT })
    expect(resolution.ok && resolution.availability).toMatchObject({
      status: 'unavailable',
      reasons: ['cli_missing']
    })
  })
})

describe('resolveValidationReviewer', () => {
  it('takes the first reviewer whose model differs from the work model, and checks it', async () => {
    const { resolver } = setup()
    const afterCodex = await resolver.resolveValidationReviewer({
      workModel: 'gpt-6.1-sol',
      workspace: GIT
    })
    expect(afterCodex.ok && afterCodex.reviewer).toMatchObject({
      target: 'claude_headless',
      model: 'claude-opus-5-5'
    })
    expect(afterCodex.ok && afterCodex.availability.cli).toMatchObject({
      target: 'claude_headless',
      effort: 'high',
      effortDelivery: 'claude_effort_flag'
    })
    const afterClaude = await resolver.resolveValidationReviewer({
      workModel: 'claude-opus-5-5',
      workspace: GIT
    })
    expect(afterClaude.ok && afterClaude.availability.cli).toMatchObject({
      target: 'codex_cli',
      model: 'gpt-6.1-sol',
      effort: 'high',
      effortDelivery: 'codex_config_override'
    })
  })

  it('refuses an unknown work model, because independence cannot be shown', async () => {
    const { resolver, h } = setup()
    for (const workModel of [null, undefined, '  ']) {
      expect(await resolver.resolveValidationReviewer({ workModel })).toEqual({
        ok: false,
        reason: 'work_model_unknown'
      })
    }
    expect(untouched(h)).toBe(true)
  })

  it('reports no independent reviewer when the list is empty', async () => {
    const { env, resolver } = setup()
    const table = parsedTestTable({
      table_version: 2,
      source: 'user',
      based_on: { table_version: 1, sha256: 'a'.repeat(64) },
      validation: { reviewers: [] }
    })
    expect(activateRoutingTable(env.ctx, { table, proposalId: null }).ok).toBe(true)
    expect(await resolver.resolveValidationReviewer({ workModel: 'gpt-6.1-sol' })).toEqual({
      ok: false,
      reason: 'no_independent_reviewer'
    })
  })

  it('does not skip to the next reviewer when the chosen one is unavailable', async () => {
    const { resolver } = setup({ detected: async () => ['claude', 'antigravity'] })
    const resolution = await resolver.resolveValidationReviewer({
      workModel: 'some-other-model',
      workspace: GIT
    })
    expect(resolution.ok && resolution.reviewer.target).toBe('codex_cli')
    expect(resolution.ok && resolution.availability).toMatchObject({
      status: 'unavailable',
      reasons: ['cli_missing'],
      cli: null
    })
  })

  it('holds a codex reviewer to the same workspace check as any codex route', async () => {
    const { resolver } = setup()
    const inFolder = await resolver.resolveValidationReviewer({
      workModel: 'claude-opus-5-5',
      workspace: { kind: 'folder' }
    })
    expect(inFolder.ok && inFolder.availability.reasons).toEqual([])
    const floating = await resolver.resolveValidationReviewer({
      workModel: 'claude-opus-5-5',
      workspace: { kind: 'floating' }
    })
    expect(floating.ok && floating.availability.reasons).toEqual(['workspace_not_git'])
  })
})

describe('evaluateTable', () => {
  it('checks the coordinator, every route and every reviewer of a table with one read per source', async () => {
    const { resolver, h, installed } = setup()
    if (!installed.ok) {
      throw new Error('table not installed')
    }
    const view = await resolver.evaluateTable(installed.table, {
      freshness: 'dispatch',
      workspace: GIT
    })
    expect(view.coordinator.status).toBe('available')
    expect(view.routes.map((row) => row.taskType)).toEqual([...ROUTING_TASK_TYPES])
    expect(view.reviewers.map((row) => row.reviewer.target)).toEqual([
      'codex_cli',
      'claude_headless'
    ])
    expect(
      [...view.routes, ...view.reviewers].every((row) => row.availability.status === 'available')
    ).toBe(true)
    expect(h.calls).toMatchObject({ detect: 1, claude: 1, codex: 1, agy: 1 })
  })

  it('reports an unsupported coordinator level of a table that is not active yet', async () => {
    const { resolver } = setup()
    const candidate = parsedTestTable({
      coordinator: { agent: 'claude', model: 'claude-haiku-4-5-20251001', reasoning_level: 'high' }
    })
    const view = await resolver.evaluateTable(candidate, { freshness: 'dispatch', workspace: GIT })
    expect(view.coordinator).toMatchObject({
      status: 'unavailable',
      reasons: ['reasoning_unsupported']
    })
  })
})

describe('recheck and latch', () => {
  it('re-evaluates a recorded subject without consulting the table', async () => {
    const { resolver } = setup()
    const first = await resolver.resolveRoute({ taskType: 'software_engineering', workspace: GIT })
    const subject = first.ok ? first.route.availability.subject : null
    expect(subject).not.toBeNull()
    const again = subject
      ? await resolver.recheck(subject, { freshness: 'dispatch', workspace: GIT })
      : null
    expect(again).toMatchObject({ status: 'available', subject })
  })

  it('holds a route after an executor reported an auth failure, until a re-check', async () => {
    const { resolver, h } = setup()
    const first = await resolver.resolveRoute({
      taskType: 'general_research_analysis',
      workspace: GIT
    })
    const subject = first.ok ? first.route.availability.subject : null
    if (!subject) {
      throw new Error('route not resolved')
    }
    resolver.latch(subject, 'auth')
    const held = await resolver.resolveRoute({
      taskType: 'general_research_analysis',
      workspace: GIT
    })
    expect(held.ok && held.route.availability).toMatchObject({
      status: 'unavailable',
      reasons: ['auth_failed']
    })
    h.clock.nowMs += 5 * 60_000
    const released = await resolver.recheck(subject, { freshness: 'recheck', workspace: GIT })
    expect(released.status).toBe('available')
  })
})

it('keeps inherited routes on the live run primary when the table switches CLI, model and effort', async () => {
  let table = parsedTestTable()
  const h = createEvaluatorHarness()
  const resolver = createRouteResolver({
    activeTable: () => ({ ok: true, table, version: 1, sha256: 'a'.repeat(64), source: 'user' }),
    evaluator: h.evaluator
  })
  const primary = {
    runId: 'run-original',
    ownerId: 'owner-original',
    agent: 'claude' as const,
    model: 'claude-opus-5-5',
    effort: 'max' as const
  }
  table = parsedTestTable({
    coordinator: { agent: 'codex', model: 'gpt-6.1-sol', reasoning_level: 'high' }
  })
  for (const taskType of ['coordinator_reasoning', 'configured_project_workflow']) {
    const resolved = await resolver.resolveRoute({
      taskType,
      workspace: GIT,
      liveRunPrimary: primary
    })
    expect(resolved.ok && resolved.route.availability).toMatchObject({
      status: 'available',
      subject: { primaryAgent: 'claude', model: 'claude-opus-5-5', reasoningLevel: 'max' }
    })
  }
  const delegated = await resolver.resolveRoute({
    taskType: 'software_engineering',
    workspace: GIT,
    liveRunPrimary: primary
  })
  expect(delegated.ok && delegated.route.availability.subject).toMatchObject({
    target: 'claude_subagent',
    model: 'claude-sonnet-5-5',
    reasoningLevel: 'max'
  })
  expect(await resolver.resolveCoordinator({ workspace: GIT })).toMatchObject({
    ok: true,
    agent: 'codex',
    coordinator: { model: 'gpt-6.1-sol', reasoningLevel: 'high' }
  })
})
