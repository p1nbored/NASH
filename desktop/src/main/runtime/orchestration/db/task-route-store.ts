import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import {
  JsonObjectSchema,
  parseJsonColumn,
  parseNullableJsonColumn,
  toNullableJsonColumn
} from './autopilot-json-column'
import { taskOrphanedSql } from './autopilot-orphan-detection'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import {
  TASK_ROUTE_POLICY_LEVELS,
  TASK_ROUTE_STATUSES,
  TASK_ROUTE_TARGETS
} from './autopilot-task-schema-definition'
import {
  AutopilotIdSchema,
  AutopilotModelIdSchema,
  ReasonCodeSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
  parseAutopilotInput,
  parseStoredRow,
  runAutopilotWrite
} from './autopilot-store-input'

export const TASK_ROUTE_CLI_SETTING_MAX_CHARS = 2048
export const TASK_ROUTE_AVAILABILITY_MAX_CHARS = 8192
export const TASK_ROUTE_MAX_REASONS = 16

/** Why: only these two run inside the primary session's own configuration, which `inherit` refers to. */
const INHERITING_TARGETS: readonly string[] = ['claude_primary', 'claude_workflow']

export const TaskRouteInputSchema = z
  .object({
    classificationId: AutopilotIdSchema,
    routingTableVersion: z.number().int().positive(),
    routingTableSha256: Sha256HexSchema,
    target: z.enum(TASK_ROUTE_TARGETS).nullable(),
    model: AutopilotModelIdSchema.nullable(),
    policyLevel: z.enum(TASK_ROUTE_POLICY_LEVELS).nullable(),
    cliSetting: JsonObjectSchema.nullable(),
    status: z.enum(TASK_ROUTE_STATUSES),
    reasons: z.array(ReasonCodeSchema).max(TASK_ROUTE_MAX_REASONS),
    availability: JsonObjectSchema.nullable(),
    timestamp: UtcTimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    const issue = (path: string) =>
      context.addIssue({ code: 'custom', path: [path], message: 'does not fit status' })
    if (input.status === 'not_delegated') {
      // Why: a task that stays with the primary has no target, model or setting to dispatch.
      const hasRouteFields =
        input.target !== null ||
        input.model !== null ||
        input.policyLevel !== null ||
        input.cliSetting !== null
      if (hasRouteFields) {
        issue('target')
      }
      return
    }
    if (input.target === null) {
      issue('target')
    }
    if (input.policyLevel === 'inherit' && !INHERITING_TARGETS.includes(input.target ?? '')) {
      issue('policyLevel')
    }
    if (input.status === 'available' && input.model === null && input.policyLevel !== 'inherit') {
      issue('model')
    }
  })
export type TaskRouteInput = z.input<typeof TaskRouteInputSchema>

export type TaskRouteRecord = {
  routeId: string
  classificationId: string
  taskId: string
  routingTableVersion: number
  routingTableSha256: string
  target: (typeof TASK_ROUTE_TARGETS)[number] | null
  model: string | null
  policyLevel: (typeof TASK_ROUTE_POLICY_LEVELS)[number] | null
  cliSetting: z.infer<typeof JsonObjectSchema> | null
  status: (typeof TASK_ROUTE_STATUSES)[number]
  reasons: string[]
  availability: z.infer<typeof JsonObjectSchema> | null
  createdAt: string
  /** True once Orca no longer holds the task, as after any Orca reset. */
  orphaned: boolean
}

const RowSchema = z.object({
  route_id: z.string(),
  classification_id: z.string(),
  task_id: z.string(),
  routing_table_version: z.number(),
  routing_table_sha256: z.string(),
  target: z.enum(TASK_ROUTE_TARGETS).nullable(),
  model: z.string().nullable(),
  policy_level: z.enum(TASK_ROUTE_POLICY_LEVELS).nullable(),
  cli_setting: z.string().nullable(),
  status: z.enum(TASK_ROUTE_STATUSES),
  reasons: z.string(),
  availability: z.string().nullable(),
  created_at: z.string(),
  orphaned: z.number()
})

const SELECT_ROUTE = `SELECT r.route_id, r.classification_id, c.task_id, r.routing_table_version,
  r.routing_table_sha256, r.target, r.model, r.policy_level, r.cli_setting, r.status, r.reasons,
  r.availability, r.created_at, ${taskOrphanedSql('c.task_id')} AS orphaned
  FROM task_routes r JOIN task_classifications c ON c.classification_id = r.classification_id`

function toRecord(row: unknown): TaskRouteRecord {
  const stored = parseStoredRow(RowSchema, row, 'task route')
  return {
    routeId: stored.route_id,
    classificationId: stored.classification_id,
    taskId: stored.task_id,
    routingTableVersion: stored.routing_table_version,
    routingTableSha256: stored.routing_table_sha256,
    target: stored.target,
    model: stored.model,
    policyLevel: stored.policy_level,
    cliSetting: parseNullableJsonColumn(stored.cli_setting, JsonObjectSchema, 'task route'),
    status: stored.status,
    reasons: parseJsonColumn(stored.reasons, z.array(ReasonCodeSchema), 'task route'),
    availability: parseNullableJsonColumn(stored.availability, JsonObjectSchema, 'task route'),
    createdAt: stored.created_at,
    orphaned: stored.orphaned === 1
  }
}

const stores = new WeakMap<OrchestrationDb, TaskRouteStore>()

export function getTaskRouteStore(owner: OrchestrationDb): TaskRouteStore {
  let store = stores.get(owner)
  if (!store) {
    store = new TaskRouteStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/** The Routing Table's answer for a classification, kept as it was when given: re-checks add rows, none change. */
export class TaskRouteStore {
  constructor(private readonly db: Database.Database) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(routeId: string): TaskRouteRecord | null {
    const row = this.db.prepare(`${SELECT_ROUTE} WHERE r.route_id = ?`).get(routeId)
    return row ? toRecord(row) : null
  }

  latestForClassification(classificationId: string): TaskRouteRecord | null {
    const row = this.db
      .prepare(`${SELECT_ROUTE} WHERE r.classification_id = ? ORDER BY r.sequence DESC LIMIT 1`)
      .get(classificationId)
    return row ? toRecord(row) : null
  }

  latestForTask(taskId: string): TaskRouteRecord | null {
    const row = this.db
      .prepare(`${SELECT_ROUTE} WHERE c.task_id = ? ORDER BY r.sequence DESC LIMIT 1`)
      .get(taskId)
    return row ? toRecord(row) : null
  }

  record(input: TaskRouteInput): TaskRouteRecord {
    const params = parseAutopilotInput(TaskRouteInputSchema, input, 'task route')
    const cliSetting = toNullableJsonColumn(
      params.cliSetting,
      TASK_ROUTE_CLI_SETTING_MAX_CHARS,
      'route setting'
    )
    const availability = toNullableJsonColumn(
      params.availability,
      TASK_ROUTE_AVAILABILITY_MAX_CHARS,
      'route availability'
    )
    return runAutopilotWrite(this.db, 'autopilot_task_route', () => {
      const classification = this.db
        .prepare('SELECT 1 AS found FROM task_classifications WHERE classification_id = ?')
        .get(params.classificationId)
      if (!classification) {
        throw new OrchestrationError(
          'autopilot_classification_not_found',
          'The classification was not found.'
        )
      }
      const routeId = `route_${randomUUID()}`
      this.db
        .prepare(
          `INSERT INTO task_routes (route_id, classification_id, routing_table_version, routing_table_sha256,
            target, model, policy_level, cli_setting, status, reasons, availability, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          routeId,
          params.classificationId,
          params.routingTableVersion,
          params.routingTableSha256,
          params.target,
          params.model,
          params.policyLevel,
          cliSetting,
          params.status,
          JSON.stringify(params.reasons),
          availability,
          params.timestamp
        )
      const record = this.get(routeId)
      if (!record) {
        throw new OrchestrationError('autopilot_recovery_required', 'The route row disappeared.')
      }
      return record
    })
  }
}
