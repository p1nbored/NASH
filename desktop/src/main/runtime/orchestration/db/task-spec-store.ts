import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { taskOrphanedSql } from './autopilot-orphan-detection'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import { TASK_SPEC_DATA_CLASS } from './autopilot-task-schema-definition'
import {
  AutopilotLimitSchema,
  parseAutopilotInput,
  runAutopilotWrite
} from './autopilot-store-input'
import {
  TASK_SPEC_COLUMNS,
  TaskProposalInputSchema,
  TaskSpecInputSchema,
  computeTaskSpecSha256,
  toTaskSpecRecord,
  type TaskProposalInput,
  type TaskSpecInput,
  type TaskSpecRecord
} from './task-spec-record'

export type {
  MachineCheck,
  TaskProposalInput,
  TaskSpecInput,
  TaskSpecRecord
} from './task-spec-record'

const SELECT_SPEC = `SELECT ${TASK_SPEC_COLUMNS}, ${taskOrphanedSql('task_specs.task_id', 'task_specs.run_id')} AS orphaned FROM task_specs`

const stores = new WeakMap<OrchestrationDb, TaskSpecStore>()

export function getTaskSpecStore(owner: OrchestrationDb): TaskSpecStore {
  let store = stores.get(owner)
  if (!store) {
    store = new TaskSpecStore(owner)
    stores.set(owner, store)
  }
  return store
}

/** The app's TaskSpec of an Orca task; the objective itself stays in Orca's task row. */
export class TaskSpecStore {
  private readonly db: Database.Database

  constructor(private readonly owner: OrchestrationDb) {
    this.db = owner.db
    ensureAutopilotRuntimeSchema(this.db)
  }

  get(taskId: string): TaskSpecRecord | null {
    const row = this.db.prepare(`${SELECT_SPEC} WHERE task_id = ?`).get(taskId)
    return row ? toTaskSpecRecord(row) : null
  }

  listByRun(runId: string, limit: number): TaskSpecRecord[] {
    const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'task spec list limit')
    return this.db
      .prepare(`${SELECT_SPEC} WHERE run_id = ? ORDER BY rowid LIMIT ?`)
      .all(runId, bound)
      .map(toTaskSpecRecord)
  }

  /** One spec per task: the same content again is a duplicate, different content is a conflict. */
  insert(input: TaskSpecInput): { duplicate: boolean; record: TaskSpecRecord } {
    const params = parseAutopilotInput(TaskSpecInputSchema, input, 'task spec')
    return runAutopilotWrite(this.db, 'autopilot_task_spec', () => {
      this.requireActiveRun(params.runId)
      return this.insertRow(params)
    })
  }

  /**
   * Creates Orca's task and its TaskSpec together, so no task of an app run is ever left without
   * one. Orca keeps the objective, the dependencies and the task's status; the app keeps the rest.
   */
  propose(input: TaskProposalInput): { taskId: string; record: TaskSpecRecord } {
    // D-027 restriction 6: a TaskSpec may hold any text; Clef masks names and paths and scans it.
    const params = parseAutopilotInput(TaskProposalInputSchema, input, 'task proposal')
    return runAutopilotWrite(this.db, 'autopilot_task_proposal', () => {
      this.requireActiveRun(params.runId)
      const orcaRun = this.db.prepare('SELECT 1 AS found FROM runs WHERE id = ?').get(params.runId)
      if (!orcaRun) {
        throw new OrchestrationError('autopilot_run_not_found', 'The run was not found.')
      }
      const dependencies = params.deps ?? []
      this.requireTasksOfRun(
        params.runId,
        params.parentId ? [...dependencies, params.parentId] : dependencies
      )
      const created = params.createdBy
      const task = this.owner.createTask({
        spec: params.objective,
        taskTitle: params.taskTitle ?? undefined,
        deps: params.deps,
        parentId: params.parentId ?? undefined,
        createdByTerminalHandle: created?.terminalHandle,
        createdByPaneKey: created?.paneKey,
        createdByProcessIncarnation: created?.processIncarnation,
        createdByRunGeneration: created?.runGeneration,
        runId: params.runId
      })
      const { record } = this.insertRow({ ...params, taskId: task.id })
      return { taskId: task.id, record }
    })
  }

  private insertRow(params: TaskSpecInput): { duplicate: boolean; record: TaskSpecRecord } {
    const task = this.db.prepare('SELECT run_id, spec FROM tasks WHERE id = ?').get(params.taskId)
    if (!task || task.run_id !== params.runId) {
      throw new OrchestrationError('autopilot_task_not_found', 'The task was not found.')
    }
    const specSha256 = computeTaskSpecSha256(String(task.spec), params)
    const existing = this.get(params.taskId)
    if (existing) {
      if (existing.specSha256 === specSha256) {
        return { duplicate: true, record: existing }
      }
      throw new OrchestrationError(
        'autopilot_task_spec_conflict',
        'The task already has a different TaskSpec.'
      )
    }
    this.db
      .prepare(
        `INSERT INTO task_specs (task_id, run_id, spec_sha256, expected_outputs, acceptance_criteria,
          machine_checks, task_constraints, access_need, isolation_need, workflow_name, review, data_class, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.taskId,
        params.runId,
        specSha256,
        JSON.stringify(params.expectedOutputs),
        JSON.stringify(params.acceptanceCriteria),
        JSON.stringify(params.machineChecks),
        JSON.stringify(params.constraints),
        params.accessNeed,
        params.isolationNeed,
        params.workflowName,
        params.review ?? null,
        TASK_SPEC_DATA_CLASS,
        params.timestamp
      )
    const record = this.get(params.taskId)
    if (!record) {
      throw new OrchestrationError('autopilot_recovery_required', 'The TaskSpec row disappeared.')
    }
    return { duplicate: false, record }
  }

  /** Dependencies and a parent must be Orca tasks of this same run; Orca's own check would throw plain text. */
  private requireTasksOfRun(runId: string, taskIds: readonly string[]): void {
    for (const taskId of taskIds) {
      const task = this.db.prepare('SELECT run_id FROM tasks WHERE id = ?').get(taskId)
      if (!task || task.run_id !== runId) {
        throw new OrchestrationError('autopilot_task_not_found', 'A named task was not found.')
      }
    }
  }

  private requireActiveRun(runId: string): void {
    const run = this.db.prepare('SELECT status FROM workflow_runs WHERE run_id = ?').get(runId)
    if (!run) {
      throw new OrchestrationError('autopilot_run_not_found', 'The run was not found.')
    }
    if (run.status !== 'active') {
      throw new OrchestrationError(
        'autopilot_run_not_live',
        'A TaskSpec can only be added to an active run.'
      )
    }
  }
}
