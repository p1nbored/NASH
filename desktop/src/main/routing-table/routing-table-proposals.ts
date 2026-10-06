import { canonicalJson } from '../../shared/canonical-json'
import {
  ProposalSubmissionSchema,
  RoutingTableProposalSchema,
  ROUTING_TABLE_CALLERS,
  type ProposalDecision,
  type RoutingTableProposal,
  type StoredProposal
} from '../../shared/routing-table/routing-table-proposal-schema'
import { RoutingTableSchema } from '../../shared/routing-table/routing-table-schema'
import {
  ensureActiveRoutingTable,
  listRoutingTableVersions,
  newestVersionNumber,
  resolveActiveRoutingTable,
  type IntegrityFailure,
  type TaxonomyMismatch
} from './routing-table-activation'
import { routingTableContentSha256 } from './routing-table-bundle'
import type { RoutingTableContext } from './routing-table-context'
import { deriveRoutingTable } from './routing-table-derivation'

/** Proposals: anyone may suggest a change, but only the desktop user decides (D-016). */

export const MAX_PENDING_AGENT_PROPOSALS = 16
// Why: who may submit which kind, so an agent cannot pose as the app update or as the user's import.
const PROPOSERS_BY_CALLER = {
  agent: ['agent'],
  app: ['bundled_update', 'benchmark_review'],
  desktop_user: ['user_import']
} as const

export type SubmitRefusal =
  | {
      readonly ok: false
      readonly reason:
        | 'forbidden_caller'
        | 'forbidden_proposer'
        | 'invalid_proposal'
        | 'invalid_table'
        | 'base_not_active'
        | 'too_many_pending'
        | 'routing_table_not_installed'
    }
  | {
      readonly ok: false
      readonly reason: 'duplicate_content'
      /** The proposal with the same content, or null when the active table already has it. */
      readonly existingProposalId: string | null
    }
  | IntegrityFailure
  | TaxonomyMismatch
export type SubmitResult =
  | { readonly ok: true; readonly proposalId: string; readonly contentSha256: string }
  | SubmitRefusal

export type ProposalListing = {
  readonly entries: readonly {
    readonly proposal: RoutingTableProposal
    readonly decision: ProposalDecision | null
    /** Pending, but its base is no longer the active version, so accepting it would supersede it. */
    readonly stale: boolean
  }[]
  /** Ids of proposal files that could not be read; they never block the others. */
  readonly unreadable: readonly string[]
}

function isCaller(caller: unknown): caller is keyof typeof PROPOSERS_BY_CALLER {
  return ROUTING_TABLE_CALLERS.some((known) => known === caller)
}

function readAllProposals(ctx: RoutingTableContext): {
  stored: StoredProposal[]
  unreadable: string[]
} {
  const stored: StoredProposal[] = []
  const unreadable: string[] = []
  for (const id of ctx.store.listProposalIds()) {
    const read = ctx.store.readProposal(id)
    if (read.ok) {
      stored.push(read.value)
    } else {
      unreadable.push(id)
    }
  }
  const byAge = (a: StoredProposal, b: StoredProposal): number =>
    a.proposal.created_at.localeCompare(b.proposal.created_at) ||
    a.proposal.proposal_id.localeCompare(b.proposal.proposal_id)
  return { stored: stored.sort(byAge), unreadable }
}

/** Pending and rejected proposals count as already seen; superseded ones are free to be rebased. */
function findSameContent(stored: readonly StoredProposal[], contentSha256: string): string | null {
  const same = stored.find(
    (entry) =>
      entry.content_sha256 === contentSha256 &&
      (entry.decision === null || entry.decision.decision === 'rejected')
  )
  return same?.proposal.proposal_id ?? null
}

export function listRoutingTableProposals(ctx: RoutingTableContext): ProposalListing {
  const active = resolveActiveRoutingTable(ctx)
  const { stored, unreadable } = readAllProposals(ctx)
  return {
    entries: stored.map((entry) => ({
      proposal: entry.proposal,
      decision: entry.decision,
      stale: active.ok && entry.decision === null && entry.proposal.base.sha256 !== active.sha256
    })),
    unreadable
  }
}

/** Stores a pending proposal. The active table and every version file stay untouched. */
export function submitRoutingTableProposal(
  ctx: RoutingTableContext,
  input: unknown,
  caller: unknown,
  options: { proposalId?: string } = {}
): SubmitResult {
  if (!isCaller(caller)) {
    return { ok: false, reason: 'forbidden_caller' }
  }
  const parsed = ProposalSubmissionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_proposal' }
  }
  const submission = parsed.data
  const allowedProposers: readonly string[] = PROPOSERS_BY_CALLER[caller]
  if (!allowedProposers.includes(submission.proposer)) {
    return { ok: false, reason: 'forbidden_proposer' }
  }
  const active = resolveActiveRoutingTable(ctx)
  if (!active.ok) {
    return active
  }
  if (
    submission.base.sha256 !== active.sha256 ||
    submission.base.table_version !== active.version
  ) {
    return { ok: false, reason: 'base_not_active' }
  }
  const versions = listRoutingTableVersions(ctx)
  const newest = versions.ok ? newestVersionNumber(versions.versions) : 0
  const candidate = RoutingTableSchema.safeParse(
    deriveRoutingTable(active.table, {
      tableVersion: newest + 1,
      source: 'user',
      basedOn: submission.base,
      createdAt: ctx.now().toISOString(),
      changes: submission.changes,
      ...(submission.coordinator ? { coordinator: submission.coordinator } : {}),
      ...(submission.validation ? { validation: submission.validation } : {})
    })
  )
  if (!candidate.success) {
    return { ok: false, reason: 'invalid_table' }
  }
  const contentSha256 = routingTableContentSha256(candidate.data)
  if (contentSha256 === routingTableContentSha256(active.table)) {
    return { ok: false, reason: 'duplicate_content', existingProposalId: null }
  }
  const { stored } = readAllProposals(ctx)
  const existing = findSameContent(stored, contentSha256)
  if (existing !== null) {
    return { ok: false, reason: 'duplicate_content', existingProposalId: existing }
  }
  const pendingFromAgents = stored.filter(
    (entry) => entry.decision === null && entry.proposal.proposer === 'agent'
  )
  if (submission.proposer === 'agent' && pendingFromAgents.length >= MAX_PENDING_AGENT_PROPOSALS) {
    return { ok: false, reason: 'too_many_pending' }
  }
  const proposalId = options.proposalId ?? ctx.newProposalId()
  if (stored.some((entry) => entry.proposal.proposal_id === proposalId)) {
    throw new Error('A routing table proposal with this id already exists')
  }
  ctx.store.writeProposal({
    schema_version: 1,
    proposal: RoutingTableProposalSchema.parse({
      ...submission,
      proposal_id: proposalId,
      created_at: ctx.now().toISOString()
    }),
    content_sha256: contentSha256,
    decision: null
  })
  return { ok: true, proposalId, contentSha256 }
}

export type BundledUpdateResult =
  | { readonly ok: true; readonly proposalId: string | null }
  | { readonly ok: false; readonly reason: 'bundled_update_refused'; readonly detail: string }
  | IntegrityFailure
  | TaxonomyMismatch

/**
 * Startup: a newer bundled table arrives as one proposal per bundled version, never as an overlay.
 * Whatever the user decides, the same bundled version is not offered again.
 */
export function proposeBundledUpdate(ctx: RoutingTableContext): BundledUpdateResult {
  const active = ensureActiveRoutingTable(ctx)
  if (!active.ok) {
    return active
  }
  const index = ctx.store.readIndex()
  const bundled = ctx.bundled()
  if (!index.ok || bundled.table_version <= index.value.bundled_version_seen) {
    return { ok: true, proposalId: null }
  }
  if (bundled.taxonomy_version !== ctx.expectedTaxonomyVersion) {
    return {
      ok: false,
      reason: 'routing_table_taxonomy_mismatch',
      tableTaxonomyVersion: bundled.taxonomy_version,
      expectedTaxonomyVersion: ctx.expectedTaxonomyVersion
    }
  }
  const proposalId = `bundled-v${bundled.table_version}`
  const markSeen = (): void =>
    ctx.store.writeIndex({ ...index.value, bundled_version_seen: bundled.table_version })
  // Why: a proposal file without a seen mark is a crash between the two writes; it is already offered.
  if (ctx.store.listProposalIds().includes(proposalId)) {
    markSeen()
    return { ok: true, proposalId: null }
  }
  const differs = (left: unknown, right: unknown): boolean =>
    canonicalJson(left) !== canonicalJson(right)
  const changes = bundled.routes.filter((route, position) =>
    differs(route, active.table.routes[position])
  )
  const submitted = submitRoutingTableProposal(
    ctx,
    {
      schema_version: 1,
      proposer: 'bundled_update',
      base: { table_version: active.version, sha256: active.sha256 },
      changes,
      ...(differs(bundled.coordinator, active.table.coordinator)
        ? { coordinator: bundled.coordinator }
        : {}),
      ...(differs(bundled.validation, active.table.validation)
        ? { validation: bundled.validation }
        : {}),
      rationale: `The application update ships bundled routing table version ${bundled.table_version}.`,
      evidence: []
    },
    'app',
    { proposalId }
  )
  // Why: duplicate content means nothing new to offer; any other refusal leaves the version unseen.
  if (!submitted.ok && submitted.reason !== 'duplicate_content') {
    return { ok: false, reason: 'bundled_update_refused', detail: submitted.reason }
  }
  markSeen()
  return { ok: true, proposalId: submitted.ok ? submitted.proposalId : null }
}

export {
  acceptRoutingTableProposal,
  rejectRoutingTableProposal
} from './routing-table-proposal-decisions'
