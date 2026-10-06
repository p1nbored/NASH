import { z } from 'zod'
import {
  ProposalDecisionSchema,
  ProposalIdSchema,
  RoutingTableProposalSchema
} from './routing-table/routing-table-proposal-schema'
import { RoutingTableSchema, Sha256HexSchema } from './routing-table/routing-table-schema'
import { RoutingTableAvailabilityViewSchema } from './workbench-route-availability-view'

/**
 * What the desktop's Routing Table screen reads (D-016: the user activates every change). Results are
 * mapped field by field in main, so file paths and stack text never reach the renderer.
 */

const CodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const VersionSchema = z.number().int().min(1)
const TABLE_SOURCES = ['bundled', 'user'] as const

/** A refusal: its reason code, an integrity detail when there is one, and the duplicate it matched. */
export const RoutingTableRefusalViewSchema = z
  .object({
    ok: z.literal(false),
    reason: CodeSchema,
    detail: CodeSchema.nullable(),
    existingProposalId: ProposalIdSchema.nullable()
  })
  .strict()
export type RoutingTableRefusalView = z.infer<typeof RoutingTableRefusalViewSchema>

export const RoutingTableActiveViewSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      version: VersionSchema,
      sha256: Sha256HexSchema,
      source: z.enum(TABLE_SOURCES),
      table: RoutingTableSchema
    })
    .strict(),
  RoutingTableRefusalViewSchema
])

export const RoutingTableVersionViewSchema = z
  .object({
    version: VersionSchema,
    sha256: Sha256HexSchema,
    source: z.enum(TABLE_SOURCES),
    acceptedAt: z.iso.datetime({ offset: true }),
    proposalId: ProposalIdSchema.nullable()
  })
  .strict()

export const RoutingTableProposalEntryViewSchema = z
  .object({
    proposal: RoutingTableProposalSchema,
    decision: ProposalDecisionSchema.nullable(),
    /** Pending, but its base is no longer the active version: accepting it would supersede it. */
    stale: z.boolean()
  })
  .strict()

export const WorkbenchRoutingTableListResultSchema = z
  .object({
    active: RoutingTableActiveViewSchema,
    /** Null when the version index cannot be read; the active view then carries the refusal. */
    activeVersion: VersionSchema.nullable(),
    versions: z.array(RoutingTableVersionViewSchema),
    proposals: z.array(RoutingTableProposalEntryViewSchema),
    unreadableProposalIds: z.array(z.string().max(256)),
    /** The active table's routes from cached readings only; null without an active table or checks. */
    availability: RoutingTableAvailabilityViewSchema.nullable()
  })
  .strict()

/** `checkRoutes`: every route of the active table read again, named by the version it checked. */
export const WorkbenchRoutingTableCheckResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      version: VersionSchema,
      sha256: Sha256HexSchema,
      availability: RoutingTableAvailabilityViewSchema
    })
    .strict(),
  RoutingTableRefusalViewSchema
])

/** Accept and revert name the version they activated; reject and import name the proposal. */
export const WorkbenchRoutingTableDecisionResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      version: VersionSchema.nullable(),
      sha256: Sha256HexSchema.nullable(),
      proposalId: ProposalIdSchema.nullable()
    })
    .strict(),
  RoutingTableRefusalViewSchema
])

export type WorkbenchRoutingTableListResult = z.infer<typeof WorkbenchRoutingTableListResultSchema>
export type WorkbenchRoutingTableDecisionResult = z.infer<
  typeof WorkbenchRoutingTableDecisionResultSchema
>
export type WorkbenchRoutingTableCheckResult = z.infer<
  typeof WorkbenchRoutingTableCheckResultSchema
>
