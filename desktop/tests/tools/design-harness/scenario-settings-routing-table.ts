import {
  ProposalChangesSchema,
  ProposalSubmissionSchema,
  RoutingTableProposalSchema,
  type ProposalChanges
} from '../../../src/shared/routing-table/routing-table-proposal-schema'
import type { RoutingTable } from '../../../src/shared/routing-table/routing-table-schema'
import type {
  WorkbenchRoutingTableDecisionResult,
  WorkbenchRoutingTableListResult
} from '../../../src/shared/workbench-routing-table-view'
import {
  fixtureListResult,
  fixtureProposal,
  fixtureTable
} from '../../../src/renderer/src/components/settings/routing-table-view.test-fixture'
import {
  checkRoutesReply,
  harnessCheckedAvailability,
  harnessListedAvailability
} from './scenario-settings-route-availability'

// FIXTURE_ONLY Routing Table answers for Settings captures; this state lives in the page and is lost
// on reload. `?routingTable=checked` starts from a finished check, `checkFailed` refuses the check.
export const ROUTING_TABLE_FIXTURE_VARIANTS = [
  'active',
  'empty',
  'damaged',
  'unavailable',
  'refusal',
  'checked',
  'checkFailed'
] as const
export type RoutingTableFixtureVariant = (typeof ROUTING_TABLE_FIXTURE_VARIANTS)[number]

export type SettingsFixtureReply =
  | { ok: true; result: unknown }
  | { ok: false; code: string; message: string }

export function readRoutingTableFixtureVariant(search: string): RoutingTableFixtureVariant {
  const value = new URLSearchParams(search).get('routingTable')
  return ROUTING_TABLE_FIXTURE_VARIANTS.find((variant) => variant === value) ?? 'active'
}

function fixtureSha(version: number): string {
  return String(version % 10).repeat(64)
}

function activeList(): WorkbenchRoutingTableListResult {
  const agentProposal = fixtureProposal({
    proposal_id: 'proposal-0002',
    proposer: 'agent',
    created_at: '2026-10-05T09:20:00Z',
    changes: [
      {
        task_type: 'routine_analysis_batch',
        execution_target: 'codex_cli',
        model: 'gpt-6.1-sol',
        reasoning_level: 'medium'
      }
    ],
    coordinator: { model: 'claude-opus-5-5', reasoning_level: 'xhigh' },
    rationale:
      'Batch runs finish faster at medium effort with no measured loss on the last ten runs.',
    evidence: []
  })
  const staleProposal = fixtureProposal({
    proposal_id: 'proposal-0003',
    proposer: 'benchmark_review',
    base: { table_version: 2, sha256: fixtureSha(2) },
    created_at: '2026-10-04T18:00:00Z',
    changes: [
      {
        task_type: 'high_quality_writing',
        execution_target: 'claude_subagent',
        model: 'claude-sonnet-5-5',
        reasoning_level: 'high'
      }
    ],
    rationale: 'Arena writing scores moved; Sonnet is close to Opus for long reports.',
    evidence: [{ name: 'Arena' }]
  })
  const decided = fixtureProposal({
    proposal_id: 'proposal-0000',
    proposer: 'user_import',
    base: { table_version: 1, sha256: fixtureSha(1) },
    created_at: '2026-10-04T11:50:00Z'
  })
  return fixtureListResult({
    proposals: [
      { proposal: fixtureProposal(), decision: null, stale: false },
      { proposal: agentProposal, decision: null, stale: false },
      { proposal: staleProposal, decision: null, stale: true },
      {
        proposal: decided,
        decision: {
          proposal_id: 'proposal-0000',
          decision: 'accepted',
          resulting: { table_version: 2, sha256: fixtureSha(2) },
          decided_at: '2026-10-04T12:00:00Z',
          decided_by: 'desktop_user'
        },
        stale: false
      }
    ]
  })
}

function initialList(variant: RoutingTableFixtureVariant): WorkbenchRoutingTableListResult {
  if (variant === 'empty') {
    return fixtureListResult({ proposals: [], availability: harnessListedAvailability() })
  }
  if (variant === 'checked') {
    return { ...activeList(), availability: harnessCheckedAvailability() }
  }
  if (variant === 'damaged') {
    return fixtureListResult({
      active: {
        ok: false,
        reason: 'routing_table_integrity_failed',
        detail: 'version_hash_mismatch',
        existingProposalId: null
      },
      activeVersion: null,
      versions: [],
      proposals: [],
      unreadableProposalIds: ['proposal-0009']
    })
  }
  return { ...activeList(), availability: harnessListedAvailability() }
}

function applied(table: RoutingTable, change: ProposalChanges, version: number): RoutingTable {
  return {
    ...table,
    table_version: version,
    source: 'user',
    based_on: { table_version: table.table_version, sha256: fixtureSha(table.table_version) },
    created_at: '2026-10-05T10:00:00Z',
    coordinator: change.coordinator ?? table.coordinator,
    validation: change.validation ?? table.validation,
    routes: table.routes.map(
      (route) => change.changes.find((row) => row.task_type === route.task_type) ?? route
    )
  }
}

type DecisionParams = { proposalId: string; modification: ProposalChanges | undefined }

function decisionParams(params: unknown): DecisionParams {
  const record: Record<string, unknown> =
    typeof params === 'object' && params !== null ? { ...params } : {}
  const modification = ProposalChangesSchema.safeParse(record.modification)
  return {
    proposalId: typeof record.proposalId === 'string' ? record.proposalId : '',
    modification: modification.success ? modification.data : undefined
  }
}

export function createRoutingTableFixture(
  variant: RoutingTableFixtureVariant
): (method: string, params: unknown) => SettingsFixtureReply | null {
  let list = initialList(variant)
  let proposalCounter = 10

  const activate = (change: ProposalChanges, proposalId: string | null): number => {
    const current = list.active.ok ? list.active.table : fixtureTable()
    const version = (list.activeVersion ?? 3) + 1
    list = {
      ...list,
      active: {
        ok: true,
        version,
        sha256: fixtureSha(version),
        source: 'user',
        table: applied(current, change, version)
      },
      activeVersion: version,
      versions: [
        ...list.versions,
        {
          version,
          sha256: fixtureSha(version),
          source: 'user',
          acceptedAt: '2026-10-05T10:00:00Z',
          proposalId
        }
      ],
      // Why: like the store, a pending proposal made for an older version reads as stale.
      proposals: list.proposals.map((entry) => ({
        ...entry,
        stale: entry.decision === null && entry.proposal.base.table_version !== version
      }))
    }
    return version
  }

  const decide = (
    proposalId: string,
    decision: 'accepted' | 'accepted_modified' | 'rejected',
    version: number | null
  ): void => {
    list = {
      ...list,
      proposals: list.proposals.map((entry) =>
        entry.proposal.proposal_id === proposalId
          ? {
              ...entry,
              stale: false,
              decision: {
                proposal_id: proposalId,
                decision,
                resulting:
                  version === null ? null : { table_version: version, sha256: fixtureSha(version) },
                decided_at: '2026-10-05T10:00:00Z',
                decided_by: 'desktop_user'
              }
            }
          : entry
      )
    }
  }

  const accept = (params: DecisionParams): WorkbenchRoutingTableDecisionResult => {
    if (variant === 'refusal') {
      return { ok: false, reason: 'proposal_superseded', detail: null, existingProposalId: null }
    }
    const entry = list.proposals.find((item) => item.proposal.proposal_id === params.proposalId)
    if (!entry || entry.decision !== null) {
      return { ok: false, reason: 'already_decided', detail: null, existingProposalId: null }
    }
    const version = activate(params.modification ?? entry.proposal, entry.proposal.proposal_id)
    decide(
      entry.proposal.proposal_id,
      params.modification ? 'accepted_modified' : 'accepted',
      version
    )
    return {
      ok: true,
      version,
      sha256: fixtureSha(version),
      proposalId: entry.proposal.proposal_id
    }
  }

  const importProposal = (params: unknown): WorkbenchRoutingTableDecisionResult => {
    const record: Record<string, unknown> =
      typeof params === 'object' && params !== null ? { ...params } : {}
    const submission = ProposalSubmissionSchema.safeParse(record.proposal)
    if (!submission.success) {
      return { ok: false, reason: 'invalid_proposal', detail: null, existingProposalId: null }
    }
    proposalCounter += 1
    const proposalId = `proposal-${String(proposalCounter).padStart(4, '0')}`
    const proposal = RoutingTableProposalSchema.parse({
      ...submission.data,
      proposal_id: proposalId,
      created_at: '2026-10-05T10:05:00Z'
    })
    list = { ...list, proposals: [{ proposal, decision: null, stale: false }, ...list.proposals] }
    return { ok: true, version: null, sha256: null, proposalId }
  }

  return (method, params) => {
    if (!method.startsWith('workbench.routingTable.')) {
      return null
    }
    if (variant === 'unavailable') {
      return { ok: false, code: 'method_not_found', message: `Unknown method: ${method}` }
    }
    const input = decisionParams(params)
    switch (method) {
      case 'workbench.routingTable.list':
        return { ok: true, result: list }
      case 'workbench.routingTable.accept':
        return { ok: true, result: accept(input) }
      case 'workbench.routingTable.reject':
        decide(input.proposalId, 'rejected', null)
        return {
          ok: true,
          result: { ok: true, version: null, sha256: null, proposalId: input.proposalId }
        }
      case 'workbench.routingTable.import':
        return { ok: true, result: importProposal(params) }
      case 'workbench.routingTable.revert': {
        const version = activate({ changes: [] }, null)
        return {
          ok: true,
          result: { ok: true, version, sha256: fixtureSha(version), proposalId: null }
        }
      }
      case 'workbench.routingTable.checkRoutes': {
        const reply = checkRoutesReply(list, variant === 'checkFailed')
        if (!reply.ok) {
          return reply
        }
        list = reply.list
        return { ok: true, result: reply.result }
      }
      default:
        return { ok: false, code: 'method_not_found', message: `Unknown method: ${method}` }
    }
  }
}
