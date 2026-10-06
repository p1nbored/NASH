import { z } from 'zod'
import { MAX_VALIDATION_REVIEWERS } from './routing-table/routing-table-schema'
import { ROUTING_TASK_TYPES } from './routing-table/routing-table-taxonomy'

// Route availability for the Settings Routing Table (D-016): reason codes only, never CLI output or paths.

/** Certain failures; `availability_record_damaged` holds every route until a check reads it again. */
export const ROUTE_UNAVAILABLE_REASONS = [
  'cli_missing',
  'cli_disabled',
  'cli_not_launchable',
  'model_not_listed',
  'model_excluded',
  'reasoning_unsupported',
  'auth_failed',
  'not_entitled',
  'quota_exhausted',
  'workspace_not_git',
  'availability_record_damaged'
] as const

/** Not proven either way; `not_checked` means nothing has looked at the route recently. */
export const ROUTE_UNVERIFIED_REASONS = [
  'not_checked',
  'cli_unobserved',
  'model_list_unavailable',
  'reasoning_unverified',
  'auth_unobserved'
] as const

export type RouteUnavailableReason = (typeof ROUTE_UNAVAILABLE_REASONS)[number]
export type RouteUnverifiedReason = (typeof ROUTE_UNVERIFIED_REASONS)[number]
export type RouteAvailabilityReason = RouteUnavailableReason | RouteUnverifiedReason

/** True when a reading rests on a default the user has not confirmed yet. */
const AwaitingSchema = z.boolean()

const distinct = (values: readonly string[]): boolean => new Set(values).size === values.length

export const RouteAvailabilityViewSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('available'),
      reasons: z.tuple([]),
      awaitingUserConfirmation: AwaitingSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('unavailable'),
      reasons: z
        .array(z.enum(ROUTE_UNAVAILABLE_REASONS))
        .min(1)
        .max(ROUTE_UNAVAILABLE_REASONS.length)
        .refine(distinct, 'Reasons repeat'),
      awaitingUserConfirmation: AwaitingSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('unverified'),
      reasons: z
        .array(z.enum(ROUTE_UNVERIFIED_REASONS))
        .min(1)
        .max(ROUTE_UNVERIFIED_REASONS.length)
        .refine(distinct, 'Reasons repeat')
        .refine(
          (reasons) => !reasons.includes('not_checked') || reasons.length === 1,
          'A route that was not checked has no other reason'
        ),
      awaitingUserConfirmation: AwaitingSchema
    })
    .strict()
])
export type RouteAvailabilityView = z.infer<typeof RouteAvailabilityViewSchema>
export type RouteAvailabilityStatus = RouteAvailabilityView['status']

/** The coordinator, one entry per task-type row and the validation reviewers in table order. */
export const RoutingTableAvailabilityViewSchema = z
  .object({
    coordinator: RouteAvailabilityViewSchema,
    routes: z
      .array(
        z
          .object({
            taskType: z.enum(ROUTING_TASK_TYPES),
            availability: RouteAvailabilityViewSchema
          })
          .strict()
      )
      .max(ROUTING_TASK_TYPES.length),
    reviewers: z.array(RouteAvailabilityViewSchema).max(MAX_VALIDATION_REVIEWERS)
  })
  .strict()
export type RoutingTableAvailabilityView = z.infer<typeof RoutingTableAvailabilityViewSchema>
