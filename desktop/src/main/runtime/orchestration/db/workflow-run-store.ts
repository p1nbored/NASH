import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import {
  AUTOPILOT_EFFORT_LEVELS,
  WORKFLOW_RUN_ACCESS_LEVELS,
  WORKFLOW_RUN_STATUSES
} from './autopilot-run-schema-definition'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import {
  AutopilotAccessSchema,
  AutopilotEffortSchema,
  AutopilotIdSchema,
  AutopilotLimitSchema,
  AutopilotModelIdSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
  parseAutopilotInput,
  parseStoredRow,
  runAutopilotWrite
} from './autopilot-store-input'
import { transitionWorkflowRun, type WorkflowRunStatus } from './workflow-run-transition'

export const WorkflowRunCreateSchema = z
  .object({
    runId: AutopilotIdSchema,
    requestId: AutopilotIdSchema,
    workspaceId: z.string().min(1).max(512),
    workspaceBinding: z.string().min(1).max(128),
    requestedAccess: AutopilotAccessSchema,
    routingTableVersion: z.number().int().positive(),
    routingTableSha256: Sha256HexSchema,
    coordinatorAgent: z.enum(['claude', 'codex']),
    coordinatorModel: AutopilotModelIdSchema,
    coordinatorEffort: AutopilotEffortSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
export type WorkflowRunCreate = z.infer<typeof WorkflowRunCreateSchema>

const WorkflowRunTransitionInputSchema = z
  .object({
    runId: AutopilotIdSchema,
    from: z.enum(WORKFLOW_RUN_STATUSES),
    to: z.enum(WORKFLOW_RUN_STATUSES),
    expectedRevision: z.number().int().positive(),
    reason: z.string().nullable(),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type WorkflowRunTransitionInput = z.infer<typeof WorkflowRunTransitionInputSchema>

const WorkflowRunRowSchema = z.object({
  run_id: z.string(),
  request_id: z.string(),
  workspace_id: z.string(),
  workspace_binding: z.string(),
  status: z.enum(WORKFLOW_RUN_STATUSES),
  revision: z.number(),
  requested_access: z.enum(WORKFLOW_RUN_ACCESS_LEVELS),
  routing_table_version: z.number(),
  routing_table_sha256: z.string(),
  coordinator_agent: z.enum(['claude', 'codex']),
  coordinator_model: z.string(),
  coordinator_effort: z.enum(AUTOPILOT_EFFORT_LEVELS),
  end_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  ended_at: z.string().nullable()
})

export type WorkflowRunRecord = {
  runId: string
  requestId: string
  workspaceId: string
  workspaceBinding: string
  status: WorkflowRunStatus
  revision: number
  requestedAccess: (typeof WORKFLOW_RUN_ACCESS_LEVELS)[number]
  routingTableVersion: number
  routingTableSha256: string
  coordinatorAgent: 'claude' | 'codex'
  coordinatorModel: string
  coordinatorEffort: (typeof AUTOPILOT_EFFORT_LEVELS)[number]
  endReason: string | null
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

const COLUMNS = `run_id, request_id, workspace_id, workspace_binding, status, revision, requested_access,
  routing_table_version, routing_table_sha256, coordinator_model,
  coordinator_agent, coordinator_effort, end_reason, created_at, updated_at, ended_at`

function toRecord(row: unknown): WorkflowRunRecord {
  const stored = parseStoredRow(WorkflowRunRowSchema, row, 'workflow run')
  return {
    runId: stored.run_id,
    requestId: stored.request_id,
    workspaceId: stored.workspace_id,
    workspaceBinding: stored.workspace_binding,
    status: stored.status,
    revision: stored.revision,
    requestedAccess: stored.requested_access,
    routingTableVersion: stored.routing_table_version,
    routingTableSha256: stored.routing_table_sha256,
    coordinatorAgent: stored.coordinator_agent,
    coordinatorModel: stored.coordinator_model,
    coordinatorEffort: stored.coordinator_effort,
    endReason: stored.end_reason,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
    endedAt: stored.ended_at
  }
}

const stores = new WeakMap<OrchestrationDb, WorkflowRunStore>()

export function getWorkflowRunStore(owner: OrchestrationDb): WorkflowRunStore {
  let store = stores.get(owner)
  if (!store) {
    store = new WorkflowRunStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/** The app's record of one run; Orca's own runs, tasks and attempts stay the execution state. */
export class WorkflowRunStore {
  constructor(private readonly db: Database.Database) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(runId: string): WorkflowRunRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM workflow_runs WHERE run_id = ?`).get(runId)
    return row ? toRecord(row) : null
  }

  getByRequestId(requestId: string): WorkflowRunRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM workflow_runs WHERE request_id = ?`)
      .get(requestId)
    return row ? toRecord(row) : null
  }

  /** Runs in the given statuses, oldest first; restart reconciliation reads the open ones. */
  listByStatus(statuses: readonly WorkflowRunStatus[], limit: number): WorkflowRunRecord[] {
    const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'run list limit')
    if (statuses.length === 0) {
      return []
    }
    const placeholders = statuses.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM workflow_runs WHERE status IN (${placeholders}) ORDER BY created_at, run_id LIMIT ?`
      )
      .all(...statuses, bound)
      .map(toRecord)
  }

  /** One run per request: a repeated request returns the existing run and starts nothing. */
  create(input: WorkflowRunCreate): { duplicate: boolean; run: WorkflowRunRecord } {
    const params = parseAutopilotInput(WorkflowRunCreateSchema, input, 'workflow run')
    return runAutopilotWrite(this.db, 'autopilot_run', () => {
      const existing = this.getByRequestId(params.requestId)
      if (existing) {
        return { duplicate: true, run: existing }
      }
      if (this.get(params.runId)) {
        throw new OrchestrationError(
          'autopilot_run_conflict',
          'That run id already belongs to another request.'
        )
      }
      this.db
        .prepare(
          `INSERT INTO workflow_runs (run_id, request_id, workspace_id, workspace_binding, status, revision,
            requested_access, routing_table_version, routing_table_sha256,
            coordinator_agent, coordinator_model, coordinator_effort, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'launching', 1, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.runId,
          params.requestId,
          params.workspaceId,
          params.workspaceBinding,
          params.requestedAccess,
          params.routingTableVersion,
          params.routingTableSha256,
          params.coordinatorAgent,
          params.coordinatorModel,
          params.coordinatorEffort,
          params.timestamp,
          params.timestamp
        )
      return { duplicate: false, run: this.requireRun(params.runId) }
    })
  }

  /** Moves along the frozen edge list, fenced by status and revision; the loser of a race gets a conflict. */
  transition(input: WorkflowRunTransitionInput): WorkflowRunRecord {
    const params = parseAutopilotInput(WorkflowRunTransitionInputSchema, input, 'run transition')
    transitionWorkflowRun(this.db, params)
    return this.requireRun(params.runId)
  }

  private requireRun(runId: string): WorkflowRunRecord {
    const run = this.get(runId)
    if (!run) {
      throw new OrchestrationError('autopilot_run_not_found', 'The run was not found.')
    }
    return run
  }
}
