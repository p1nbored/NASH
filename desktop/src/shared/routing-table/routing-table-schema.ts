import { z } from 'zod'
import { isEnglishText } from '../english-text'
import { PinnedModelIdSchema } from './model-pin-policy'
import {
  CONCRETE_REASONING_LEVELS,
  COORDINATOR_TASK_TYPE,
  EXECUTION_TARGETS,
  INHERIT,
  INHERITING_TARGETS,
  REASONING_LEVELS,
  REASONING_REQUIREMENTS,
  ROUTING_TASK_TYPES,
  VALIDATION_REVIEWER_TARGETS
} from './routing-table-taxonomy'

export const ROUTING_TABLE_SCHEMA_VERSION = 1
export const MAX_VALIDATION_REVIEWERS = 8
const NOTES_MAX_CHARS = 500

export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/)

/** D-013: internal text is English; names, paths and quotations belong in the evidence documents. */
export const EnglishTextSchema = (maxChars: number) =>
  z.string().min(1).max(maxChars).refine(isEnglishText, 'English only (D-013)')

export const BenchmarkSourceSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9 .&()/-]{1,80}$/),
    url: z
      .url({ protocol: /^https$/ })
      .max(300)
      .optional()
  })
  .strict()

export const RouteSchema = z
  .object({
    task_type: z.enum(ROUTING_TASK_TYPES),
    execution_target: z.enum(EXECUTION_TARGETS),
    // Why: PinnedModelIdSchema refuses aliases, selectors and rejected slugs, so only `inherit` is added here.
    model: z.union([z.literal(INHERIT), PinnedModelIdSchema]),
    reasoning_level: z.enum(REASONING_LEVELS),
    reasoning_requirement: z.enum(REASONING_REQUIREMENTS).default('required'),
    // Why: informational only; no routing code reads these three fields.
    benchmark_sources: z.array(BenchmarkSourceSchema).max(8).optional(),
    benchmark_snapshot_date: z.iso.date().optional(),
    notes: EnglishTextSchema(NOTES_MAX_CHARS).optional()
  })
  .strict()
  .superRefine((route, ctx) => {
    const inherits = route.model === INHERIT || route.reasoning_level === INHERIT
    const target = route.execution_target
    if (inherits && !INHERITING_TARGETS.includes(target)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only claude_primary and claude_workflow may inherit'
      })
    }
    if (
      target === 'claude_primary' &&
      !(route.model === INHERIT && route.reasoning_level === INHERIT)
    ) {
      ctx.addIssue({ code: 'custom', message: 'claude_primary uses the coordinator configuration' })
    }
    if (route.task_type === COORDINATOR_TASK_TYPE && target !== 'claude_primary') {
      ctx.addIssue({
        code: 'custom',
        message: 'coordinator_reasoning stays in the primary session'
      })
    }
    if (route.reasoning_requirement === 'if_supported' && route.reasoning_level === INHERIT) {
      ctx.addIssue({ code: 'custom', message: 'if_supported needs a concrete level' })
    }
  })
export type Route = z.infer<typeof RouteSchema>

/** The primary session's own launch configuration; `inherit` rows resolve to it. */
export const CoordinatorSchema = z
  .object({
    agent: z.enum(['claude', 'codex']),
    model: PinnedModelIdSchema,
    reasoning_level: z.enum(CONCRETE_REASONING_LEVELS)
  })
  .strict()
export type Coordinator = z.infer<typeof CoordinatorSchema>

/** D-017: a different model than the one that did the work reviews it when no automatic check exists. */
export const ValidationReviewerSchema = z
  .object({
    target: z.enum(VALIDATION_REVIEWER_TARGETS),
    model: PinnedModelIdSchema,
    reasoning_level: z.enum(CONCRETE_REASONING_LEVELS)
  })
  .strict()
export type ValidationReviewer = z.infer<typeof ValidationReviewerSchema>

export const ValidationPolicySchema = z
  .object({
    /** Ordered: the validator uses the first reviewer whose model differs from the worker's. */
    reviewers: z.array(ValidationReviewerSchema).max(MAX_VALIDATION_REVIEWERS),
    notes: EnglishTextSchema(NOTES_MAX_CHARS).optional()
  })
  .strict()
export type ValidationPolicy = z.infer<typeof ValidationPolicySchema>

export const TableVersionRefSchema = z
  .object({ table_version: z.number().int().min(1), sha256: Sha256HexSchema })
  .strict()
export type TableVersionRef = z.infer<typeof TableVersionRefSchema>

export const RoutingTableSchema = z
  .object({
    schema_version: z.literal(ROUTING_TABLE_SCHEMA_VERSION),
    table_version: z.number().int().min(1),
    taxonomy_version: z.number().int().min(1),
    source: z.enum(['bundled', 'user']),
    based_on: TableVersionRefSchema.nullable(),
    created_at: z.iso.datetime({ offset: true }),
    coordinator: CoordinatorSchema,
    routes: z.array(RouteSchema).length(ROUTING_TASK_TYPES.length),
    validation: ValidationPolicySchema,
    notes: EnglishTextSchema(NOTES_MAX_CHARS).optional()
  })
  .strict()
  .superRefine((table, ctx) => {
    // Why: total and unique, one row per task type in taxonomy order, so a lookup can never miss.
    if (!table.routes.every((route, index) => route.task_type === ROUTING_TASK_TYPES[index])) {
      ctx.addIssue({
        code: 'custom',
        path: ['routes'],
        message: 'One route per task type, in taxonomy order'
      })
    }
  })
export type RoutingTable = z.infer<typeof RoutingTableSchema>
