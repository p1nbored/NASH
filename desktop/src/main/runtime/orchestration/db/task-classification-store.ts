import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import {
  JsonObjectSchema,
  parseNullableJsonColumn,
  toNullableJsonColumn
} from './autopilot-json-column'
import { taskOrphanedSql } from './autopilot-orphan-detection'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import { TASK_CLASSIFICATION_OUTCOMES } from './autopilot-task-schema-definition'
import {
  AutopilotIdSchema,
  ReasonCodeSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
  parseAutopilotInput,
  parseStoredRow,
  runAutopilotWrite
} from './autopilot-store-input'

export const TASK_CLASSIFICATION_ANSWERS_MAX_CHARS = 2048

// Why: the classifier names itself as the endpoint returns it (for example `@cf/cloudflare/clef`).
const ClassifierModelSchema = z.string().regex(/^[A-Za-z0-9@][A-Za-z0-9@._:/-]{0,127}$/)
// Why: the taxonomy is enumerated by the routing table, not here, so a taxonomy change needs no schema bump.
const TaskTypeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

export const TaskClassificationInputSchema = z
  .object({
    taskId: AutopilotIdSchema,
    attempt: z.number().int().positive(),
    outcome: z.enum(TASK_CLASSIFICATION_OUTCOMES),
    detail: ReasonCodeSchema.nullable(),
    needsDelegation: z.boolean().nullable(),
    taskType: TaskTypeSchema.nullable(),
    answers: JsonObjectSchema.nullable(),
    bundleSha256: Sha256HexSchema.nullable(),
    taxonomyVersion: z.number().int().positive().nullable(),
    profileSha256: Sha256HexSchema.nullable(),
    classifierModel: ClassifierModelSchema.nullable(),
    rawResponseId: AutopilotIdSchema.nullable(),
    spendReservationId: AutopilotIdSchema.nullable(),
    timestamp: UtcTimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    const classified = input.outcome === 'classified'
    // Why: a classified result carries both answers and no reason; any other outcome carries a reason and no answer.
    if (classified !== (input.detail === null)) {
      context.addIssue({ code: 'custom', path: ['detail'], message: 'detail does not fit outcome' })
    }
    if (classified !== (input.needsDelegation !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['needsDelegation'],
        message: 'does not fit outcome'
      })
    }
    if (classified !== (input.taskType !== null)) {
      context.addIssue({ code: 'custom', path: ['taskType'], message: 'does not fit outcome' })
    }
  })
export type TaskClassificationInput = z.input<typeof TaskClassificationInputSchema>

export type TaskClassificationRecord = {
  classificationId: string
  taskId: string
  attempt: number
  outcome: (typeof TASK_CLASSIFICATION_OUTCOMES)[number]
  detail: string | null
  needsDelegation: boolean | null
  taskType: string | null
  answers: z.infer<typeof JsonObjectSchema> | null
  bundleSha256: string | null
  taxonomyVersion: number | null
  profileSha256: string | null
  classifierModel: string | null
  rawResponseId: string | null
  spendReservationId: string | null
  createdAt: string
  /** True once Orca no longer holds the task, as after any Orca reset. */
  orphaned: boolean
}

const RowSchema = z.object({
  classification_id: z.string(),
  task_id: z.string(),
  attempt: z.number(),
  outcome: z.enum(TASK_CLASSIFICATION_OUTCOMES),
  detail: z.string().nullable(),
  needs_delegation: z.number().nullable(),
  task_type: z.string().nullable(),
  answers: z.string().nullable(),
  bundle_sha256: z.string().nullable(),
  taxonomy_version: z.number().nullable(),
  profile_sha256: z.string().nullable(),
  classifier_model: z.string().nullable(),
  raw_response_id: z.string().nullable(),
  spend_reservation_id: z.string().nullable(),
  created_at: z.string(),
  orphaned: z.number()
})

const SELECT_CLASSIFICATION = `SELECT classification_id, task_id, attempt, outcome, detail, needs_delegation,
  task_type, answers, bundle_sha256, taxonomy_version, profile_sha256, classifier_model, raw_response_id,
  spend_reservation_id, created_at, ${taskOrphanedSql('task_classifications.task_id')} AS orphaned
  FROM task_classifications`

function toRecord(row: unknown): TaskClassificationRecord {
  const stored = parseStoredRow(RowSchema, row, 'task classification')
  return {
    classificationId: stored.classification_id,
    taskId: stored.task_id,
    attempt: stored.attempt,
    outcome: stored.outcome,
    detail: stored.detail,
    needsDelegation: stored.needs_delegation === null ? null : stored.needs_delegation === 1,
    taskType: stored.task_type,
    answers: parseNullableJsonColumn(stored.answers, JsonObjectSchema, 'task classification'),
    bundleSha256: stored.bundle_sha256,
    taxonomyVersion: stored.taxonomy_version,
    profileSha256: stored.profile_sha256,
    classifierModel: stored.classifier_model,
    rawResponseId: stored.raw_response_id,
    spendReservationId: stored.spend_reservation_id,
    createdAt: stored.created_at,
    orphaned: stored.orphaned === 1
  }
}

const stores = new WeakMap<OrchestrationDb, TaskClassificationStore>()

export function getTaskClassificationStore(owner: OrchestrationDb): TaskClassificationStore {
  let store = stores.get(owner)
  if (!store) {
    store = new TaskClassificationStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/** What Clef decided for each attempt at classifying a TaskSpec; the routing decision is a separate record. */
export class TaskClassificationStore {
  constructor(private readonly db: Database.Database) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(classificationId: string): TaskClassificationRecord | null {
    const row = this.db
      .prepare(`${SELECT_CLASSIFICATION} WHERE classification_id = ?`)
      .get(classificationId)
    return row ? toRecord(row) : null
  }

  getForAttempt(taskId: string, attempt: number): TaskClassificationRecord | null {
    const row = this.db
      .prepare(`${SELECT_CLASSIFICATION} WHERE task_id = ? AND attempt = ?`)
      .get(taskId, attempt)
    return row ? toRecord(row) : null
  }

  latestForTask(taskId: string): TaskClassificationRecord | null {
    const row = this.db
      .prepare(`${SELECT_CLASSIFICATION} WHERE task_id = ? ORDER BY attempt DESC LIMIT 1`)
      .get(taskId)
    return row ? toRecord(row) : null
  }

  listForTask(taskId: string): TaskClassificationRecord[] {
    return this.db
      .prepare(`${SELECT_CLASSIFICATION} WHERE task_id = ? ORDER BY attempt`)
      .all(taskId)
      .map(toRecord)
  }

  nextAttempt(taskId: string): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(MAX(attempt), 0) + 1 AS next FROM task_classifications WHERE task_id = ?'
      )
      .get(taskId)
    return Number(row?.next)
  }

  /** One row per attempt of a task; a second record for the same attempt is refused, never merged. */
  record(input: TaskClassificationInput): TaskClassificationRecord {
    const params = parseAutopilotInput(TaskClassificationInputSchema, input, 'task classification')
    const answers = toNullableJsonColumn(
      params.answers,
      TASK_CLASSIFICATION_ANSWERS_MAX_CHARS,
      'classification answers'
    )
    return runAutopilotWrite(this.db, 'autopilot_task_classification', () => {
      if (
        !this.db.prepare('SELECT 1 AS found FROM task_specs WHERE task_id = ?').get(params.taskId)
      ) {
        throw new OrchestrationError(
          'autopilot_task_spec_not_found',
          'The task has no TaskSpec to classify.'
        )
      }
      this.requireLinked(
        params.spendReservationId,
        'SELECT 1 AS found FROM workbench_clef_spend WHERE reservation_id = ?',
        'autopilot_spend_reservation_not_found'
      )
      this.requireLinked(
        params.rawResponseId,
        'SELECT 1 AS found FROM workbench_clef_raw_responses WHERE raw_response_id = ?',
        'autopilot_raw_response_not_found'
      )
      if (this.getForAttempt(params.taskId, params.attempt)) {
        throw new OrchestrationError(
          'autopilot_classification_conflict',
          'That attempt already has a classification.'
        )
      }
      const classificationId = `classification_${randomUUID()}`
      this.db
        .prepare(
          `INSERT INTO task_classifications (classification_id, task_id, attempt, outcome, detail, needs_delegation,
            task_type, answers, bundle_sha256, taxonomy_version, profile_sha256, classifier_model,
            raw_response_id, spend_reservation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          classificationId,
          params.taskId,
          params.attempt,
          params.outcome,
          params.detail,
          params.needsDelegation === null ? null : Number(params.needsDelegation),
          params.taskType,
          answers,
          params.bundleSha256,
          params.taxonomyVersion,
          params.profileSha256,
          params.classifierModel,
          params.rawResponseId,
          params.spendReservationId,
          params.timestamp
        )
      const record = this.get(classificationId)
      if (!record) {
        throw new OrchestrationError(
          'autopilot_recovery_required',
          'The classification row disappeared.'
        )
      }
      return record
    })
  }

  private requireLinked(id: string | null, sql: string, code: string): void {
    if (id !== null && !this.db.prepare(sql).get(id)) {
      throw new OrchestrationError(code, 'The linked spend record was not found.')
    }
  }
}
