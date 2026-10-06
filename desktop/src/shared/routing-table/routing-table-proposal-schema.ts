import { z } from 'zod'
import {
  BenchmarkSourceSchema,
  CoordinatorSchema,
  EnglishTextSchema,
  ROUTING_TABLE_SCHEMA_VERSION,
  RouteSchema,
  Sha256HexSchema,
  TableVersionRefSchema,
  ValidationPolicySchema
} from './routing-table-schema'
import { ROUTING_TASK_TYPES } from './routing-table-taxonomy'

/** Who may propose: agents and app updates propose; only the desktop user decides (D-016). */
export const ROUTING_TABLE_PROPOSERS = [
  'bundled_update',
  'benchmark_review',
  'agent',
  'user_import'
] as const
export const ROUTING_TABLE_CALLERS = ['desktop_user', 'app', 'agent'] as const
export type RoutingTableCaller = (typeof ROUTING_TABLE_CALLERS)[number]
export const PROPOSAL_DECISIONS = [
  'accepted',
  'accepted_modified',
  'rejected',
  'superseded'
] as const

export const ProposalIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)
const RATIONALE_MAX_CHARS = 2000
const MAX_PROPOSAL_EVIDENCE = 16

/** Replacement rows, one per task type, plus optional coordinator and validation replacements. */
const ChangeFields = {
  coordinator: CoordinatorSchema.optional(),
  validation: ValidationPolicySchema.optional()
}

function assertUniqueTaskTypes(
  value: { changes: readonly { task_type: string }[] },
  ctx: z.RefinementCtx
): void {
  const seen = new Set<string>()
  for (const [index, route] of value.changes.entries()) {
    if (seen.has(route.task_type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['changes', index, 'task_type'],
        message: 'One replacement row per task type'
      })
    }
    seen.add(route.task_type)
  }
}

/** A user's modification of a proposal replaces its whole change set. */
export const ProposalChangesSchema = z
  .object({
    ...ChangeFields,
    changes: z.array(RouteSchema).max(ROUTING_TASK_TYPES.length).default([])
  })
  .strict()
  .superRefine(assertUniqueTaskTypes)
export type ProposalChanges = z.infer<typeof ProposalChangesSchema>

const SubmissionObject = z
  .object({
    schema_version: z.literal(ROUTING_TABLE_SCHEMA_VERSION),
    proposer: z.enum(ROUTING_TABLE_PROPOSERS),
    base: TableVersionRefSchema,
    ...ChangeFields,
    changes: z.array(RouteSchema).max(ROUTING_TASK_TYPES.length),
    rationale: EnglishTextSchema(RATIONALE_MAX_CHARS),
    evidence: z.array(BenchmarkSourceSchema).max(MAX_PROPOSAL_EVIDENCE),
    benchmark_snapshot_date: z.iso.date().optional()
  })
  .strict()

/** What a proposer sends; the store assigns the id and the creation time. */
export const ProposalSubmissionSchema = SubmissionObject.superRefine(assertUniqueTaskTypes)
export type ProposalSubmission = z.infer<typeof ProposalSubmissionSchema>

export const RoutingTableProposalSchema = SubmissionObject.extend({
  proposal_id: ProposalIdSchema,
  created_at: z.iso.datetime({ offset: true })
})
  .strict()
  .superRefine(assertUniqueTaskTypes)
export type RoutingTableProposal = z.infer<typeof RoutingTableProposalSchema>

export const ProposalDecisionSchema = z
  .object({
    proposal_id: ProposalIdSchema,
    decision: z.enum(PROPOSAL_DECISIONS),
    resulting: TableVersionRefSchema.nullable(),
    decided_at: z.iso.datetime({ offset: true }),
    decided_by: z.literal('desktop_user')
  })
  .strict()
  .superRefine((decision, ctx) => {
    const activates = decision.decision === 'accepted' || decision.decision === 'accepted_modified'
    if (activates !== (decision.resulting !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['resulting'],
        message: 'Only an accepted proposal has a resulting version'
      })
    }
  })
export type ProposalDecision = z.infer<typeof ProposalDecisionSchema>

/** The proposal file: the proposal as submitted, the hash of the table it yields, and the decision. */
export const StoredProposalSchema = z
  .object({
    schema_version: z.literal(ROUTING_TABLE_SCHEMA_VERSION),
    proposal: RoutingTableProposalSchema,
    content_sha256: Sha256HexSchema,
    decision: ProposalDecisionSchema.nullable()
  })
  .strict()
  .superRefine((stored, ctx) => {
    if (stored.decision && stored.decision.proposal_id !== stored.proposal.proposal_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['decision', 'proposal_id'],
        message: 'The decision belongs to another proposal'
      })
    }
  })
export type StoredProposal = z.infer<typeof StoredProposalSchema>
