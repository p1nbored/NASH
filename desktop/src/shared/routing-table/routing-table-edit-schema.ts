import { z } from 'zod'
import {
  CoordinatorSchema,
  RouteSchema,
  TableVersionRefSchema,
  ValidationPolicySchema
} from './routing-table-schema'
import { ROUTING_TASK_TYPES } from './routing-table-taxonomy'

const ChangeFields = {
  coordinator: CoordinatorSchema.optional(),
  validation: ValidationPolicySchema.optional(),
  changes: z.array(RouteSchema).max(ROUTING_TASK_TYPES.length).default([])
}

function uniqueTasks(
  value: { changes: readonly { task_type: string }[] },
  ctx: z.RefinementCtx
): void {
  const seen = new Set<string>()
  value.changes.forEach((row, index) => {
    if (seen.has(row.task_type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['changes', index, 'task_type'],
        message: 'One replacement row per task type'
      })
    }
    seen.add(row.task_type)
  })
}

export const RoutingTableChangesSchema = z.object(ChangeFields).strict().superRefine(uniqueTasks)
export type RoutingTableChanges = z.infer<typeof RoutingTableChangesSchema>

/** The base fences a save against edits from another settings view. */
export const RoutingTableEditSchema = z
  .object({ base: TableVersionRefSchema, ...ChangeFields })
  .strict()
  .superRefine(uniqueTasks)
export type RoutingTableEdit = z.infer<typeof RoutingTableEditSchema>
