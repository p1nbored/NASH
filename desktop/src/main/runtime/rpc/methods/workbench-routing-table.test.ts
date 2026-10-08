import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WorkbenchRoutingTableCheckRoutesParams,
  WorkbenchRoutingTableListParams,
  WorkbenchRoutingTableSaveParams
} from '../../../../shared/rpc-contract/workbench-run-params'
import {
  WorkbenchRoutingTableCheckResultSchema,
  WorkbenchRoutingTableDecisionResultSchema,
  WorkbenchRoutingTableListResultSchema
} from '../../../../shared/workbench-routing-table-view'
import { createEvaluatorHarness } from '../../../routing-table/availability/route-availability-harness.test-fixture'
import { createRouteResolver } from '../../../routing-table/route-resolver'
import {
  ensureActiveRoutingTable,
  resolveActiveRoutingTable
} from '../../../routing-table/routing-table-activation'
import {
  createTestRoutingTableEnvironment,
  versionFilePath
} from '../../../routing-table/routing-table-test-context.test-fixture'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import { registerRoutingTableContext } from '../../workbench-run/routing-table-context-registry'
import type { RpcContext } from '../core'
import { RpcDispatcher } from '../dispatcher'
import {
  WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD,
  WORKBENCH_ROUTING_TABLE_LIST_METHOD,
  WORKBENCH_ROUTING_TABLE_SAVE_METHOD,
  WORKBENCH_ROUTING_TABLE_METHODS
} from './workbench-routing-table'

// FIXTURE_ONLY: an in-memory routing-table folder; no file on disk and no CLI.
const ASTRA_ROW = {
  task_type: 'software_engineering',
  execution_target: 'codex_cli',
  model: 'gpt-6-astra',
  reasoning_level: 'max'
}

let unregister: (() => void) | null = null

afterEach(() => {
  unregister?.()
  unregister = null
})

function setup(options: { availability?: boolean } = {}) {
  const env = createTestRoutingTableEnvironment()
  const active = ensureActiveRoutingTable(env.ctx)
  if (!active.ok) {
    throw new Error('fixture install failed')
  }
  const orca = { getRuntimeId: vi.fn(() => 'fixture-runtime') }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the routing-table methods read only the registry key and the runtime id.
  const runtime = orca as never
  // FIXTURE_ONLY: B2's evaluator over fake ports, counting every detection, listing and refresh.
  const h = createEvaluatorHarness()
  const resolver = createRouteResolver({
    activeTable: () => resolveActiveRoutingTable(env.ctx),
    evaluator: h.evaluator
  })
  unregister = registerRoutingTableContext(
    runtime,
    env.ctx,
    options.availability === false ? undefined : resolver
  )
  const context: RpcContext = { runtime, workbenchCaller: issueWorkbenchDesktopCaller() }
  const base = { table_version: active.version, sha256: active.sha256 }
  return { env, runtime, context, base, h }
}

const NOT_CHECKED = {
  status: 'unverified',
  reasons: ['not_checked'],
  awaitingUserConfirmation: false
}

describe('workbench.routingTable methods', () => {
  it('saves a desktop edit directly as the next version without a pending proposal', async () => {
    const { env, runtime, context, base } = setup()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKBENCH_ROUTING_TABLE_METHODS })
    const response = await dispatcher.dispatch(
      {
        id: 'save-request',
        authToken: 'fixture-local-token',
        method: 'workbench.routingTable.save',
        params: { base, changes: [ASTRA_ROW] }
      },
      { workbenchCaller: context.workbenchCaller }
    )
    expect(response).toMatchObject({ ok: true, result: { ok: true, version: 2 } })
    const active = resolveActiveRoutingTable(env.ctx)
    expect(
      active.ok &&
        active.table.routes.find((row) => row.task_type === 'software_engineering')?.model
    ).toBe('gpt-6-astra')
    expect([...env.fs.files.keys()].some((path) => path.includes('proposals'))).toBe(false)
  })

  it('rejects old Advanced endpoints without changing the table', async () => {
    const { env, runtime, context } = setup()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKBENCH_ROUTING_TABLE_METHODS })
    for (const action of ['accept', 'reject', 'import', 'revert']) {
      const reply = await dispatcher.dispatch(
        {
          id: action,
          authToken: 'fixture-local-token',
          method: `workbench.routingTable.${action}`,
          params: {}
        },
        { workbenchCaller: context.workbenchCaller }
      )
      expect(reply).toMatchObject({ ok: false, error: { code: 'method_not_found' } })
    }
    expect(env.fs.files.has(versionFilePath(2))).toBe(false)
  })

  it('saves only for the trusted desktop caller and accepts no caller identity from the wire', async () => {
    const { env, runtime, base, h } = setup()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKBENCH_ROUTING_TABLE_METHODS })
    const forged = Object.freeze({ principalId: 'local-desktop-ui', source: 'desktop_ui' as const })
    const calls: [string, unknown][] = [
      ['workbench.routingTable.list', {}],
      ['workbench.routingTable.save', { base, changes: [ASTRA_ROW] }],
      ['workbench.routingTable.checkRoutes', {}]
    ]
    for (const options of [{}, { workbenchCaller: forged }]) {
      for (const [method, params] of calls) {
        const response = await dispatcher.dispatch(
          { id: 'fixture-request', authToken: 'fixture-local-token', method, params },
          options
        )
        expect(response, method).toMatchObject({
          ok: false,
          error: { code: 'workbench_forbidden' }
        })
      }
    }
    expect(env.fs.files.has(versionFilePath(2))).toBe(false)
    expect(h.calls).toMatchObject({ detect: 0, claude: 0, codex: 0, agy: 0, refresh: 0 })
  })

  it('lists only the active table and cached availability', async () => {
    const { context, base } = setup()
    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )
    expect(Object.keys(listed).sort()).toEqual(['active', 'availability'])
    expect(listed.active).toMatchObject({
      ok: true,
      version: 1,
      sha256: base.sha256,
      source: 'bundled'
    })
    expect(WORKBENCH_ROUTING_TABLE_LIST_METHOD.params).toBe(WorkbenchRoutingTableListParams)
    expect(WORKBENCH_ROUTING_TABLE_SAVE_METHOD.params).toBe(WorkbenchRoutingTableSaveParams)
    expect(WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD.params).toBe(
      WorkbenchRoutingTableCheckRoutesParams
    )
  })

  it('fences stale saves and leaves the newer active table intact', () => {
    const { env, context, base } = setup()
    const edit = WorkbenchRoutingTableSaveParams.parse({ base, changes: [ASTRA_ROW] })
    expect(
      WorkbenchRoutingTableDecisionResultSchema.parse(
        WORKBENCH_ROUTING_TABLE_SAVE_METHOD.handler(edit, context)
      )
    ).toMatchObject({ ok: true, version: 2 })
    expect(WORKBENCH_ROUTING_TABLE_SAVE_METHOD.handler(edit, context)).toEqual({
      ok: false,
      reason: 'base_not_active',
      detail: null
    })
    expect(resolveActiveRoutingTable(env.ctx)).toMatchObject({ ok: true, version: 2 })
    expect(env.fs.files.has(versionFilePath(3))).toBe(false)
  })

  it('rejects an unchanged save without writing a version', () => {
    const { env, context, base } = setup()
    expect(
      WORKBENCH_ROUTING_TABLE_SAVE_METHOD.handler({ base, changes: [] }, context)
    ).toMatchObject({ ok: false, reason: 'no_change' })
    expect(env.fs.files.has(versionFilePath(2))).toBe(false)
  })

  it('persists a reviewer-only edit without changing the task routes', () => {
    const { env, context, base } = setup()
    const before = resolveActiveRoutingTable(env.ctx)
    if (!before.ok) {
      throw new Error('fixture install failed')
    }
    const validation = {
      ...before.table.validation,
      reviewers: before.table.validation.reviewers.map((reviewer, index) =>
        index === 0 ? { ...reviewer, model: 'gpt-6-astra' } : reviewer
      )
    }
    const result = WORKBENCH_ROUTING_TABLE_SAVE_METHOD.handler(
      { base, changes: [], validation },
      context
    )
    expect(result).toMatchObject({ ok: true, version: 2 })
    const after = resolveActiveRoutingTable(env.ctx)
    expect(after.ok && after.table.validation).toEqual(validation)
    expect(after.ok && after.table.routes).toEqual(before.table.routes)
  })

  it('reports a damaged store without replacing it or starting checks', async () => {
    const { env, context, h } = setup()
    env.fs.files.set(versionFilePath(1), '{"tampered":true}')
    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )
    const refusal = {
      ok: false,
      reason: 'routing_table_integrity_failed',
      detail: 'version_invalid'
    }
    expect(listed.active).toEqual(refusal)
    expect(listed.availability).toBeNull()
    expect(
      WorkbenchRoutingTableCheckResultSchema.parse(
        await WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD.handler({}, context)
      )
    ).toEqual(refusal)
    expect(h.calls).toMatchObject({ detect: 0, claude: 0, codex: 0, agy: 0, refresh: 0 })
  })

  it('refuses reads until the routing table is registered', () => {
    const { context } = setup()
    unregister?.()
    unregister = null
    for (const method of [
      WORKBENCH_ROUTING_TABLE_LIST_METHOD,
      WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD
    ]) {
      expect(() => method.handler({}, context)).toThrow(
        expect.objectContaining({ code: 'workbench_routing_table_unavailable' })
      )
    }
  })
})

describe('route availability in the Routing Table view', () => {
  it('lists every route as not checked from cached readings, starting no probe', async () => {
    const { context, h } = setup()

    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )

    expect(listed.availability?.coordinator).toEqual(NOT_CHECKED)
    expect(listed.availability?.routes).toHaveLength(10)
    expect(
      listed.availability?.routes.every((row) => row.availability.status === 'unverified')
    ).toBe(true)
    expect(listed.availability?.reviewers).toEqual([NOT_CHECKED, NOT_CHECKED])
    expect(h.calls).toMatchObject({ detect: 0, claude: 0, codex: 0, agy: 0, refresh: 0 })
  })

  it('checks the routes on demand, then lists the readings that check left', async () => {
    const { context, h, base } = setup()

    const checked = WorkbenchRoutingTableCheckResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD.handler({}, context)
    )
    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )

    expect(h.calls).toMatchObject({ detect: 1, claude: 1, codex: 1, agy: 1, refresh: 1 })
    expect(checked).toMatchObject({ ok: true, version: base.table_version, sha256: base.sha256 })
    if (!checked.ok) {
      throw new Error('check refused')
    }
    expect(checked.availability.coordinator.status).toBe('available')
    expect(listed.availability).toEqual(checked.availability)
  })

  it('still lists the table when availability cannot be read', async () => {
    const { env, runtime, context } = setup({ availability: false })
    unregister?.()
    const failing = { evaluateTable: () => Promise.reject(new Error('FIXTURE_ONLY evaluator bug')) }
    unregister = registerRoutingTableContext(runtime, env.ctx, failing)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )

    expect(listed.availability).toBeNull()
    expect(listed.active.ok).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('FIXTURE_ONLY')
    warn.mockRestore()
  })

  it('reports no availability when none is installed, and refuses Check routes with a code', async () => {
    const { context } = setup({ availability: false })

    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )

    expect(listed.availability).toBeNull()
    expect(() => WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD.handler({}, context)).toThrow(
      expect.objectContaining({ code: 'workbench_route_availability_unavailable' })
    )
  })
})
