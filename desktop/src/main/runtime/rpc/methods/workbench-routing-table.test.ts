import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WorkbenchRoutingTableAcceptParams,
  WorkbenchRoutingTableCheckRoutesParams,
  WorkbenchRoutingTableImportParams,
  WorkbenchRoutingTableListParams,
  WorkbenchRoutingTableRejectParams,
  WorkbenchRoutingTableRevertParams
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
  listRoutingTableProposals,
  submitRoutingTableProposal
} from '../../../routing-table/routing-table-proposals'
import {
  createTestRoutingTableEnvironment,
  versionFilePath,
  type TestRoutingTableEnvironment
} from '../../../routing-table/routing-table-test-context.test-fixture'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import { registerRoutingTableContext } from '../../workbench-run/routing-table-context-registry'
import type { RpcContext } from '../core'
import { RpcDispatcher } from '../dispatcher'
import {
  WORKBENCH_ROUTING_TABLE_ACCEPT_METHOD,
  WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD,
  WORKBENCH_ROUTING_TABLE_IMPORT_METHOD,
  WORKBENCH_ROUTING_TABLE_LIST_METHOD,
  WORKBENCH_ROUTING_TABLE_METHODS,
  WORKBENCH_ROUTING_TABLE_REJECT_METHOD,
  WORKBENCH_ROUTING_TABLE_REVERT_METHOD
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

function submission(base: { table_version: number; sha256: string }, proposer = 'agent') {
  return {
    schema_version: 1,
    proposer,
    base,
    changes: [ASTRA_ROW],
    rationale: 'A newer model leads the engineering benchmarks.',
    evidence: [{ name: 'Artificial Analysis' }]
  }
}

function agentProposal(
  env: TestRoutingTableEnvironment,
  base: { table_version: number; sha256: string }
) {
  const result = submitRoutingTableProposal(env.ctx, submission(base), 'agent')
  if (!result.ok) {
    throw new Error(`fixture proposal: ${result.reason}`)
  }
  return result.proposalId
}

function decisionOf(env: TestRoutingTableEnvironment, proposalId: string) {
  return listRoutingTableProposals(env.ctx).entries.find(
    (entry) => entry.proposal.proposal_id === proposalId
  )?.decision
}

describe('workbench.routingTable methods', () => {
  it('declares list, accept, reject, import, revert and checkRoutes with the shared params', () => {
    expect(WORKBENCH_ROUTING_TABLE_METHODS.map((method) => method.name)).toEqual([
      'workbench.routingTable.list',
      'workbench.routingTable.accept',
      'workbench.routingTable.reject',
      'workbench.routingTable.import',
      'workbench.routingTable.revert',
      'workbench.routingTable.checkRoutes'
    ])
    expect(WORKBENCH_ROUTING_TABLE_LIST_METHOD.params).toBe(WorkbenchRoutingTableListParams)
    expect(WORKBENCH_ROUTING_TABLE_ACCEPT_METHOD.params).toBe(WorkbenchRoutingTableAcceptParams)
    expect(WORKBENCH_ROUTING_TABLE_REJECT_METHOD.params).toBe(WorkbenchRoutingTableRejectParams)
    expect(WORKBENCH_ROUTING_TABLE_IMPORT_METHOD.params).toBe(WorkbenchRoutingTableImportParams)
    expect(WORKBENCH_ROUTING_TABLE_REVERT_METHOD.params).toBe(WorkbenchRoutingTableRevertParams)
    expect(WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD.params).toBe(
      WorkbenchRoutingTableCheckRoutesParams
    )
  })

  it('accepts a table only for the trusted desktop caller', async () => {
    const { env, runtime, base, h } = setup()
    const proposalId = agentProposal(env, base)
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKBENCH_ROUTING_TABLE_METHODS })
    const forged = Object.freeze({ principalId: 'local-desktop-ui', source: 'desktop_ui' as const })
    const calls: [string, unknown][] = [
      ['workbench.routingTable.list', {}],
      ['workbench.routingTable.accept', { proposalId }],
      ['workbench.routingTable.reject', { proposalId }],
      ['workbench.routingTable.import', { proposal: submission(base, 'user_import') }],
      ['workbench.routingTable.revert', { version: 1 }],
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
    expect(decisionOf(env, proposalId)).toBeNull()
    expect(env.fs.files.has(versionFilePath(2))).toBe(false)
    // Why: a refused caller must not start a CLI model listing through checkRoutes either.
    expect(h.calls).toMatchObject({ detect: 0, claude: 0, codex: 0, agy: 0, refresh: 0 })
  })

  it('lists the active table, its versions and the proposals', async () => {
    const { env, context, base } = setup()
    const proposalId = agentProposal(env, base)
    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )
    expect(listed).toMatchObject({
      active: { ok: true, version: 1, sha256: base.sha256, source: 'bundled' },
      activeVersion: 1,
      versions: [{ version: 1, sha256: base.sha256, source: 'bundled', proposalId: null }],
      proposals: [
        { proposal: { proposal_id: proposalId, proposer: 'agent' }, decision: null, stale: false }
      ],
      unreadableProposalIds: []
    })
  })

  it('accepts a proposal as the next version, then reverts to the first as a new version', () => {
    const { env, context, base } = setup()
    const proposalId = agentProposal(env, base)
    const accepted = WorkbenchRoutingTableDecisionResultSchema.parse(
      WORKBENCH_ROUTING_TABLE_ACCEPT_METHOD.handler({ proposalId }, context)
    )
    expect(accepted).toMatchObject({ ok: true, version: 2, proposalId })
    expect(decisionOf(env, proposalId)).toMatchObject({
      decision: 'accepted',
      decided_by: 'desktop_user'
    })
    const reverted = WORKBENCH_ROUTING_TABLE_REVERT_METHOD.handler({ version: 1 }, context)
    expect(reverted).toMatchObject({ ok: true, version: 3, proposalId: null })
  })

  it('records a modified acceptance', () => {
    const { env, context, base } = setup()
    const proposalId = agentProposal(env, base)
    const modification = WorkbenchRoutingTableAcceptParams.parse({
      proposalId,
      modification: { changes: [{ ...ASTRA_ROW, model: 'gpt-6.1-sol', reasoning_level: 'high' }] }
    }).modification
    expect(
      WORKBENCH_ROUTING_TABLE_ACCEPT_METHOD.handler({ proposalId, modification }, context)
    ).toMatchObject({ ok: true, version: 2 })
    expect(decisionOf(env, proposalId)).toMatchObject({ decision: 'accepted_modified' })
  })

  it('rejects once and reports a second decision as already decided', () => {
    const { env, context, base } = setup()
    const proposalId = agentProposal(env, base)
    expect(WORKBENCH_ROUTING_TABLE_REJECT_METHOD.handler({ proposalId }, context)).toEqual({
      ok: true,
      version: null,
      sha256: null,
      proposalId
    })
    expect(WORKBENCH_ROUTING_TABLE_ACCEPT_METHOD.handler({ proposalId }, context)).toEqual({
      ok: false,
      reason: 'already_decided',
      detail: null,
      existingProposalId: null
    })
    expect(decisionOf(env, proposalId)).toMatchObject({ decision: 'rejected' })
  })

  it('imports the user change set as a pending proposal and refuses another proposer', () => {
    const { env, context, base } = setup()
    const imported = WORKBENCH_ROUTING_TABLE_IMPORT_METHOD.handler(
      WorkbenchRoutingTableImportParams.parse({ proposal: submission(base, 'user_import') }),
      context
    )
    expect(imported).toMatchObject({ ok: true, version: null })
    const pending = listRoutingTableProposals(env.ctx).entries
    expect(pending.map((entry) => [entry.proposal.proposer, entry.decision])).toEqual([
      ['user_import', null]
    ])
    const posing = WORKBENCH_ROUTING_TABLE_IMPORT_METHOD.handler(
      WorkbenchRoutingTableImportParams.parse({ proposal: submission(base, 'bundled_update') }),
      context
    )
    expect(posing).toMatchObject({ ok: false, reason: 'forbidden_proposer' })
  })

  it('reports a damaged store as a refusal with its detail, and never the bundled table', async () => {
    const { env, context, h } = setup()
    env.fs.files.set(versionFilePath(1), '{"tampered":true}')
    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )
    const refusal = {
      ok: false,
      reason: 'routing_table_integrity_failed',
      detail: 'version_invalid',
      existingProposalId: null
    }
    expect(listed.active).toEqual(refusal)
    expect(listed.availability).toBeNull()
    const checked = await WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD.handler({}, context)
    expect(WorkbenchRoutingTableCheckResultSchema.parse(checked)).toEqual(refusal)
    expect(h.calls).toMatchObject({ detect: 0, claude: 0, codex: 0, agy: 0, refresh: 0 })
  })

  it('refuses every method until the routing table is registered', () => {
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

  it('still lists the table, versions and proposals when availability cannot be read', async () => {
    const { env, runtime, context, base } = setup({ availability: false })
    const proposalId = agentProposal(env, base)
    unregister?.()
    const failing = { evaluateTable: () => Promise.reject(new Error('FIXTURE_ONLY evaluator bug')) }
    unregister = registerRoutingTableContext(runtime, env.ctx, failing)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const listed = WorkbenchRoutingTableListResultSchema.parse(
      await WORKBENCH_ROUTING_TABLE_LIST_METHOD.handler({}, context)
    )

    expect(listed.availability).toBeNull()
    expect(listed.active.ok).toBe(true)
    expect(listed.proposals.map((entry) => entry.proposal.proposal_id)).toEqual([proposalId])
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
