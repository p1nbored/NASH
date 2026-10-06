import { z } from 'zod'

export const ROUTING_STATUSES = [
  'not_configured',
  'sealing_unavailable',
  'contract_unverified',
  'identity_unpinned',
  'ready',
  'unreachable',
  'circuit_open',
  'quota_latched',
  'auth_failed'
] as const
export const RoutingStatusSchema = z.enum(ROUTING_STATUSES)
export type RoutingStatus = z.infer<typeof RoutingStatusSchema>

/** R33 reasons. */
export const ROUTE_BLOCKER_REASONS = [
  'classifier_unavailable',
  'invalid_output',
  'missing_inputs',
  'ambiguous',
  'no_eligible_profile',
  // Why: a Workbench request whose primary session could not be launched (D-016); additive.
  'launch_blocked'
] as const
export const RouteBlockerReasonSchema = z.enum(ROUTE_BLOCKER_REASONS)
export type RouteBlockerReason = z.infer<typeof RouteBlockerReasonSchema>

/** R33 details. */
export const R33_ROUTE_BLOCKER_DETAILS = [
  'not_configured',
  'clef_identity_unpinned',
  'transient_exhausted',
  'quota_exhausted',
  // Why kept after D-022: the ledger refused a billed attempt (the 2-attempt retry bound or a failed reservation); not a spend limit.
  'budget_exhausted',
  'auth_or_account',
  'model_unavailable',
  'request_rejected',
  'data_boundary_forbids',
  'possible_truncation',
  'model_identity_mismatch',
  'low_margin',
  'needs_clarification'
] as const
/** Phase-1 additions to R33; each is an extension pending user review. */
export const PHASE1_ROUTE_BLOCKER_DETAIL_EXTENSIONS = [
  'contract_unverified',
  'interrupted',
  'choice_outside_legal_set',
  'inconsistent_type_profile',
  'required_profile_unavailable',
  'non_english_objective',
  'estimate_exceeded',
  'routing_in_progress',
  // Why: ARCH 6.1's no_eligible_profile detail for an empty eligible set (R12).
  'empty_set',
  'response_schema_violation'
] as const
/** D-016 additions: classification of a TaskSpec and the launch of the primary session. */
export const D016_ROUTE_BLOCKER_DETAIL_EXTENSIONS = [
  'inconsistent_delegation',
  'coordinator_route_unavailable',
  'launch_refused',
  'launch_unverifiable'
] as const
export const ROUTE_BLOCKER_DETAILS = [
  ...R33_ROUTE_BLOCKER_DETAILS,
  ...PHASE1_ROUTE_BLOCKER_DETAIL_EXTENSIONS,
  ...D016_ROUTE_BLOCKER_DETAIL_EXTENSIONS
] as const
export const RouteBlockerDetailSchema = z.enum(ROUTE_BLOCKER_DETAILS)
export type RouteBlockerDetail = z.infer<typeof RouteBlockerDetailSchema>

export const RouteBlockerSchema = z
  .object({ reason: RouteBlockerReasonSchema, detail: RouteBlockerDetailSchema })
  .strict()
export type RouteBlocker = z.infer<typeof RouteBlockerSchema>

/** Ids of stored Clef records (spend reservations, raw responses, classifications). */
export const ClefRecordIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
