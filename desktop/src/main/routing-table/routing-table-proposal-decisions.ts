import {
  ProposalChangesSchema,
  ProposalIdSchema,
  type ProposalDecision,
  type StoredProposal
} from '../../shared/routing-table/routing-table-proposal-schema'
import { RoutingTableSchema } from '../../shared/routing-table/routing-table-schema'
import {
  activateRoutingTable,
  listRoutingTableVersions,
  newestVersionNumber,
  resolveActiveRoutingTable,
  type IntegrityFailure,
  type TaxonomyMismatch
} from './routing-table-activation'
import { routingTableContentSha256 } from './routing-table-bundle'
import { isDesktopUserCaller, type RoutingTableContext } from './routing-table-context'
import { deriveRoutingTable } from './routing-table-derivation'

/** Accepting or rejecting a proposal: desktop user only, and the first decision is final. */

type DecisionRefusal =
  | {
      readonly ok: false
      readonly reason:
        | 'forbidden_caller'
        | 'proposal_unknown'
        | 'proposal_invalid'
        | 'already_decided'
        | 'routing_table_not_installed'
    }
  | IntegrityFailure
  | TaxonomyMismatch

export type AcceptResult =
  | { readonly ok: true; readonly version: number; readonly sha256: string }
  | DecisionRefusal
  | {
      readonly ok: false
      readonly reason: 'proposal_superseded' | 'invalid_table' | 'no_change' | 'version_conflict'
    }
export type RejectResult = { readonly ok: true } | DecisionRefusal

type PendingProposal = { readonly ok: true; readonly stored: StoredProposal } | DecisionRefusal

function loadPending(
  ctx: RoutingTableContext,
  proposalId: string,
  caller: unknown
): PendingProposal {
  if (!isDesktopUserCaller(caller)) {
    return { ok: false, reason: 'forbidden_caller' }
  }
  if (!ProposalIdSchema.safeParse(proposalId).success) {
    return { ok: false, reason: 'proposal_unknown' }
  }
  const read = ctx.store.readProposal(proposalId)
  if (!read.ok) {
    return {
      ok: false,
      reason: read.reason === 'missing' ? 'proposal_unknown' : 'proposal_invalid'
    }
  }
  return read.value.decision === null
    ? { ok: true, stored: read.value }
    : { ok: false, reason: 'already_decided' }
}

function decisionOf(
  ctx: RoutingTableContext,
  proposalId: string,
  decision: ProposalDecision['decision'],
  resulting: ProposalDecision['resulting']
): ProposalDecision {
  return {
    proposal_id: proposalId,
    decision,
    resulting,
    decided_at: ctx.now().toISOString(),
    decided_by: 'desktop_user'
  }
}

export function rejectRoutingTableProposal(
  ctx: RoutingTableContext,
  input: { proposalId: string; caller: unknown }
): RejectResult {
  const pending = loadPending(ctx, input.proposalId, input.caller)
  if (!pending.ok) {
    return pending
  }
  ctx.store.writeProposal({
    ...pending.stored,
    decision: decisionOf(ctx, input.proposalId, 'rejected', null)
  })
  return { ok: true }
}

/**
 * Accepts a proposal, optionally with the user's own change set, as the next version. A stale base is
 * recorded as superseded and writes no version. The version file, then the index, then the decision.
 */
export function acceptRoutingTableProposal(
  ctx: RoutingTableContext,
  input: { proposalId: string; caller: unknown; modification?: unknown }
): AcceptResult {
  const pending = loadPending(ctx, input.proposalId, input.caller)
  if (!pending.ok) {
    return pending
  }
  const { stored } = pending
  const { proposal } = stored
  const active = resolveActiveRoutingTable(ctx)
  if (!active.ok) {
    return active
  }
  if (proposal.base.sha256 !== active.sha256 || proposal.base.table_version !== active.version) {
    ctx.store.writeProposal({
      ...stored,
      decision: decisionOf(ctx, input.proposalId, 'superseded', null)
    })
    return { ok: false, reason: 'proposal_superseded' }
  }
  const modified = input.modification !== undefined
  const changes = modified ? ProposalChangesSchema.safeParse(input.modification) : null
  if (changes && !changes.success) {
    return { ok: false, reason: 'invalid_table' }
  }
  const applied = changes?.data ?? proposal
  const versions = listRoutingTableVersions(ctx)
  const newest = versions.ok ? newestVersionNumber(versions.versions) : 0
  const candidate = RoutingTableSchema.safeParse(
    deriveRoutingTable(active.table, {
      tableVersion: newest + 1,
      source: !modified && proposal.proposer === 'bundled_update' ? 'bundled' : 'user',
      basedOn: proposal.base,
      createdAt: ctx.now().toISOString(),
      changes: applied.changes,
      ...(applied.coordinator ? { coordinator: applied.coordinator } : {}),
      ...(applied.validation ? { validation: applied.validation } : {})
    })
  )
  if (!candidate.success) {
    return { ok: false, reason: 'invalid_table' }
  }
  if (routingTableContentSha256(candidate.data) === routingTableContentSha256(active.table)) {
    return { ok: false, reason: 'no_change' }
  }
  const activated = activateRoutingTable(ctx, {
    table: candidate.data,
    proposalId: input.proposalId
  })
  if (!activated.ok) {
    return activated
  }
  ctx.store.writeProposal({
    ...stored,
    decision: decisionOf(ctx, input.proposalId, modified ? 'accepted_modified' : 'accepted', {
      table_version: activated.version,
      sha256: activated.sha256
    })
  })
  return activated
}
