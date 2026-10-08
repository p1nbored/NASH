import { z } from 'zod'
import { RoutingTableSchema, Sha256HexSchema } from './routing-table/routing-table-schema'
import { RoutingTableAvailabilityViewSchema } from './workbench-route-availability-view'

/**
 * What the desktop's Routing Table screen reads (D-016: the user activates every change). Results are
 * mapped field by field in main, so file paths and stack text never reach the renderer.
 */

const CodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const VersionSchema = z.number().int().min(1)
const TABLE_SOURCES = ['bundled', 'user'] as const

const RoutingModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  efforts: z.array(z.string())
})
export const RoutingModelListsSchema = z.object({
  claude: z.array(RoutingModelSchema).nullable(),
  codex: z.array(RoutingModelSchema).nullable(),
  agy: z.array(RoutingModelSchema).nullable()
})
export type RoutingModelLists = z.infer<typeof RoutingModelListsSchema>
export type RoutingModel = z.infer<typeof RoutingModelSchema>

/** A refusal: its reason code and an integrity detail when there is one. */
export const RoutingTableRefusalViewSchema = z
  .object({
    ok: z.literal(false),
    reason: CodeSchema,
    detail: CodeSchema.nullable()
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

export const WorkbenchRoutingTableListResultSchema = z
  .object({
    active: RoutingTableActiveViewSchema,
    /** The active table's routes from cached readings only; null without an active table or checks. */
    availability: RoutingTableAvailabilityViewSchema.nullable(),
    models: RoutingModelListsSchema.optional()
  })
  .strict()

/** `checkRoutes`: every route of the active table read again, named by the version it checked. */
export const WorkbenchRoutingTableCheckResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      version: VersionSchema,
      sha256: Sha256HexSchema,
      availability: RoutingTableAvailabilityViewSchema,
      models: RoutingModelListsSchema.optional()
    })
    .strict(),
  RoutingTableRefusalViewSchema
])

/** A direct save names the version it activated. */
export const WorkbenchRoutingTableDecisionResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      version: VersionSchema,
      sha256: Sha256HexSchema
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
