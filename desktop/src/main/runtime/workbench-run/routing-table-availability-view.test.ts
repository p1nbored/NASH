import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTING_TASK_TYPES } from '../../../shared/routing-table/routing-table-taxonomy'
import {
  ROUTE_UNAVAILABLE_REASONS,
  ROUTE_UNVERIFIED_REASONS,
  type RouteAvailabilityView
} from '../../../shared/workbench-route-availability-view'
import {
  createEvaluatorHarness,
  type HarnessOverrides
} from '../../routing-table/availability/route-availability-harness.test-fixture'
import {
  AGY_MODELS,
  NOW_MS,
  listingOf
} from '../../routing-table/availability/route-availability.test-fixture'
import {
  UNAVAILABLE_REASONS,
  UNVERIFIED_REASONS
} from '../../routing-table/availability/route-availability-types'
import { createMemoryAvailabilityFs } from '../../routing-table/availability/route-availability-fs.test-fixture'
import { createRouteResolver } from '../../routing-table/route-resolver'
import { ROUTING_TABLE_DIR_NAME } from '../../routing-table/routing-table-file-store'
import {
  ensureActiveRoutingTable,
  resolveActiveRoutingTable
} from '../../routing-table/routing-table-activation'
import {
  FIXTURE_USER_DATA,
  createTestRoutingTableEnvironment
} from '../../routing-table/routing-table-test-context.test-fixture'
import {
  ROUTE_READING_FRESH_MS,
  checkedTableAvailability,
  checkedRouteView,
  listedTableAvailability
} from './routing-table-availability-view'

// FIXTURE_ONLY: B2's evaluator over fake ports; no CLI, network, credential or file is touched.
const AVAILABILITY_FILE = join(FIXTURE_USER_DATA, ROUTING_TABLE_DIR_NAME, 'availability.json')
const NOT_CHECKED: RouteAvailabilityView = {
  status: 'unverified',
  reasons: ['not_checked'],
  awaitingUserConfirmation: false
}
const AVAILABLE: RouteAvailabilityView = {
  status: 'available',
  reasons: [],
  awaitingUserConfirmation: false
}

function setup(overrides: HarnessOverrides = {}) {
  const env = createTestRoutingTableEnvironment()
  const installed = ensureActiveRoutingTable(env.ctx)
  if (!installed.ok) {
    throw new Error('fixture table not installed')
  }
  const h = createEvaluatorHarness(overrides)
  const resolver = createRouteResolver({
    activeTable: () => resolveActiveRoutingTable(env.ctx),
    evaluator: h.evaluator
  })
  return { h, resolver, table: installed.table }
}

function allViews(view: Awaited<ReturnType<typeof listedTableAvailability>>) {
  return [view.coordinator, ...view.routes.map((row) => row.availability), ...view.reviewers]
}

describe('listed route availability (cached readings only)', () => {
  it('reports every route as not checked before anything was read, and starts nothing', async () => {
    const { h, resolver, table } = setup()

    const view = await listedTableAvailability(resolver, table)

    expect(view.routes.map((row) => row.taskType)).toEqual([...ROUTING_TASK_TYPES])
    expect(view.reviewers).toHaveLength(table.validation.reviewers.length)
    expect(allViews(view).every((entry) => entry.status === 'unverified')).toBe(true)
    expect(new Set(allViews(view).map((entry) => JSON.stringify(entry)))).toEqual(
      new Set([JSON.stringify(NOT_CHECKED)])
    )
    // Why: no detection, no model listing and no rate-limit refresh; only held state is read.
    expect(h.calls).toMatchObject({ detect: 0, claude: 0, codex: 0, agy: 0, refresh: 0 })
  })

  it('shows the readings a check left behind, then not checked once they are stale', async () => {
    const { h, resolver, table } = setup()
    const checked = await checkedTableAvailability(resolver, table)
    const callsAfterCheck = { ...h.calls }

    const listed = await listedTableAvailability(resolver, table)

    expect(allViews(checked).every((entry) => entry.status === 'available')).toBe(true)
    expect(listed).toEqual(checked)
    expect(h.calls).toMatchObject({
      detect: callsAfterCheck.detect,
      claude: callsAfterCheck.claude,
      codex: callsAfterCheck.codex,
      agy: callsAfterCheck.agy,
      refresh: callsAfterCheck.refresh
    })

    h.clock.nowMs += ROUTE_READING_FRESH_MS + 1
    const later = await listedTableAvailability(resolver, table)
    expect(allViews(later).every((entry) => entry.reasons[0] === 'not_checked')).toBe(true)
  })

  it('keeps a route the executor reported as failed unavailable, even with no fresh reading', async () => {
    const { h, resolver, table } = setup()
    const resolved = await resolver.resolveRoute({ taskType: 'general_research_analysis' })
    if (!resolved.ok) {
      throw new Error('route not resolved')
    }
    h.clock.nowMs += ROUTE_READING_FRESH_MS + 1
    resolver.latch(resolved.route.availability.subject, 'quota')

    const view = await listedTableAvailability(resolver, table)
    const research = view.routes.find((row) => row.taskType === 'general_research_analysis')

    expect(research?.availability).toEqual({
      status: 'unavailable',
      reasons: ['quota_exhausted'],
      awaitingUserConfirmation: false
    })
  })

  it('calls a route not checked when only another CLI was read, as by one dispatch', async () => {
    const { h, resolver, table } = setup()
    const dispatched = await resolver.resolveRoute({ taskType: 'routine_analysis_batch' })
    expect(dispatched.ok && dispatched.route.target).toBe('codex_cli')
    expect(h.calls).toMatchObject({ detect: 1, codex: 1, claude: 0, agy: 0 })

    const view = await listedTableAvailability(resolver, table)
    const byType = new Map(view.routes.map((row) => [row.taskType, row.availability]))

    expect(byType.get('routine_analysis_batch')?.status).toBe('available')
    expect(byType.get('software_engineering')).toEqual(NOT_CHECKED)
    expect(byType.get('fast_writing_or_alternative_draft')).toEqual(NOT_CHECKED)
  })

  it('shows a CLI that fresh detection found missing, though no model list was read', async () => {
    const { resolver, table } = setup({ detected: async () => ['claude', 'codex'] })
    await resolver.resolveRoute({ taskType: 'routine_analysis_batch' })

    const view = await listedTableAvailability(resolver, table)
    const agy = view.routes.find((row) => row.taskType === 'fast_writing_or_alternative_draft')

    expect(agy?.availability).toEqual({
      status: 'unavailable',
      reasons: ['cli_missing'],
      awaitingUserConfirmation: false
    })
  })

  it('names a damaged availability record instead of reporting a sign-in or quota failure', async () => {
    const fs = createMemoryAvailabilityFs(() => NOW_MS)
    fs.seed(AVAILABILITY_FILE, '{"damaged":', NOW_MS - 600_000)
    const { resolver, table } = setup({ fs })

    const view = await listedTableAvailability(resolver, table)

    expect(view.coordinator).toEqual({
      status: 'unavailable',
      reasons: ['availability_record_damaged'],
      awaitingUserConfirmation: false
    })
    const checked = await checkedTableAvailability(resolver, table)
    expect(checked.coordinator.status).toBe('available')
  })

  it('keeps an unobserved reading from a recent check instead of calling it not checked', async () => {
    const { resolver, table } = setup({
      models: { codex: async () => ({ ok: false, observedAtMs: NOW_MS }) }
    })
    await checkedTableAvailability(resolver, table)

    const view = await listedTableAvailability(resolver, table)
    const codexRows = view.routes.filter((row) => {
      const route = table.routes.find((entry) => entry.task_type === row.taskType)
      return route?.execution_target === 'codex_cli'
    })

    expect(codexRows.length).toBeGreaterThan(0)
    for (const row of codexRows) {
      expect(row.availability).toEqual({
        status: 'unverified',
        reasons: ['model_list_unavailable'],
        awaitingUserConfirmation: false
      })
    }
  })
})

describe('checked route availability (Check now)', () => {
  it('reads every source again: detection, each CLI model listing and the rate limits', async () => {
    const { h, resolver, table } = setup()

    await checkedTableAvailability(resolver, table)

    expect(h.calls).toMatchObject({ detect: 1, claude: 1, codex: 1, agy: 1, refresh: 1 })
  })

  it('reports an unlisted model as unavailable with its reason code', async () => {
    const withoutFlash = AGY_MODELS.filter((model) => !model.id.startsWith('gemini-3.8-flash'))
    const { resolver, table } = setup({
      models: { agy: async () => listingOf(withoutFlash, NOW_MS) }
    })

    const view = await checkedTableAvailability(resolver, table)
    const agyRows = view.routes.filter((row) => {
      const route = table.routes.find((entry) => entry.task_type === row.taskType)
      return route?.execution_target === 'agy_cli'
    })

    expect(agyRows.length).toBeGreaterThan(0)
    expect(agyRows[0]?.availability).toEqual({
      status: 'unavailable',
      reasons: ['model_not_listed'],
      awaitingUserConfirmation: false
    })
    expect(view.coordinator).toEqual(AVAILABLE)
  })

  it('shows a codex route in a folder workspace as available, resting on no default (D-027)', async () => {
    const { resolver } = setup()
    const resolved = await resolver.resolveRoute({
      taskType: 'routine_analysis_batch',
      workspace: { kind: 'folder' }
    })
    if (!resolved.ok) {
      throw new Error('route not resolved')
    }

    expect(resolved.route.target).toBe('codex_cli')
    expect(checkedRouteView(resolved.route.availability)).toEqual(AVAILABLE)
  })
})

describe('the shared reason vocabulary', () => {
  it('names every reason the availability checks can give', () => {
    expect(ROUTE_UNAVAILABLE_REASONS).toEqual(expect.arrayContaining([...UNAVAILABLE_REASONS]))
    expect(ROUTE_UNVERIFIED_REASONS).toEqual(expect.arrayContaining([...UNVERIFIED_REASONS]))
    // Why one extra each: the view adds `availability_record_damaged` and `not_checked`.
    expect(ROUTE_UNAVAILABLE_REASONS).toHaveLength(UNAVAILABLE_REASONS.length + 1)
    expect(ROUTE_UNVERIFIED_REASONS).toHaveLength(UNVERIFIED_REASONS.length + 1)
  })
})
