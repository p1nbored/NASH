import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { assertDispatchableRoute } from './app-attempt-route-guard'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import {
  AutopilotLimitSchema,
  parseAutopilotInput,
  runAutopilotWrite
} from './autopilot-store-input'
import {
  ExecutorProcessStartInputSchema,
  SELECT_EXECUTOR_PROCESS,
  toExecutorProcessRecord,
  type ExecutorProcessRecord,
  type ExecutorProcessStartInput
} from './executor-process-record'

export type { ExecutorProcessRecord, ExecutorProcessStartInput } from './executor-process-record'
export {
  EXECUTOR_PROCESS_TRANSITIONS,
  applyExecutorTransition,
  type ExecutorProcessState,
  type ExecutorTransition
} from './executor-process-transition'

const stores = new WeakMap<OrchestrationDb, ExecutorProcessStore>()

export function getExecutorProcessStore(owner: OrchestrationDb): ExecutorProcessStore {
  let store = stores.get(owner)
  if (!store) {
    store = new ExecutorProcessStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/**
 * The process behind an attempt run by the Codex or agy CLI, one row per Orca Dispatch. Only the
 * start is written here; every later move goes through app-attempt-settlement, so this row and
 * Orca's Dispatch, worker and Task can never disagree.
 */
export class ExecutorProcessStore {
  constructor(private readonly db: Database.Database) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(dispatchId: string): ExecutorProcessRecord | null {
    const row = this.db.prepare(`${SELECT_EXECUTOR_PROCESS} WHERE dispatch_id = ?`).get(dispatchId)
    return row ? toExecutorProcessRecord(row) : null
  }

  /** Executors still starting or running, oldest first; restart reconciliation reads these. */
  listOpen(limit: number): ExecutorProcessRecord[] {
    const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'executor list limit')
    return this.db
      .prepare(
        `${SELECT_EXECUTOR_PROCESS} WHERE state IN ('starting', 'running') ORDER BY started_at, rowid LIMIT ?`
      )
      .all(bound)
      .map(toExecutorProcessRecord)
  }

  listForTask(taskId: string): ExecutorProcessRecord[] {
    return this.db
      .prepare(`${SELECT_EXECUTOR_PROCESS} WHERE task_id = ? ORDER BY started_at, rowid`)
      .all(taskId)
      .map(toExecutorProcessRecord)
  }

  /** Records the executor of a Dispatch Orca has just opened, so a crash leaves evidence to reconcile. */
  insertStarting(input: ExecutorProcessStartInput): ExecutorProcessRecord {
    const params = parseAutopilotInput(ExecutorProcessStartInputSchema, input, 'executor process')
    return runAutopilotWrite(this.db, 'autopilot_executor', () => {
      if (this.get(params.dispatchId)) {
        throw new OrchestrationError(
          'autopilot_executor_conflict',
          'That Dispatch already has an executor.'
        )
      }
      this.requireStartingAttempt(params)
      assertDispatchableRoute(this.db, {
        taskId: params.taskId,
        routeId: params.routeId,
        executor: params.executorKind
      })
      this.db
        .prepare(
          `INSERT INTO executor_processes (dispatch_id, run_id, task_id, executor_kind, route_id, state,
            run_directory, started_at) VALUES (?, ?, ?, ?, ?, 'starting', ?, ?)`
        )
        .run(
          params.dispatchId,
          params.runId,
          params.taskId,
          params.executorKind,
          params.routeId,
          params.runDirectory,
          params.timestamp
        )
      const record = this.get(params.dispatchId)
      if (!record) {
        throw new OrchestrationError('autopilot_recovery_required', 'The executor row disappeared.')
      }
      return record
    })
  }

  /** The Dispatch must be Orca's, for this task and run, a task of the app, and still starting. */
  private requireStartingAttempt(params: { dispatchId: string; taskId: string; runId: string }) {
    const dispatch = this.db
      .prepare(
        `SELECT d.status AS dispatch_status, w.state AS worker_state
           FROM dispatch_contexts d
           JOIN task_specs s ON s.task_id = d.task_id AND s.run_id = d.run_id
           LEFT JOIN worker_dispatches w ON w.dispatch_id = d.id
          WHERE d.id = ? AND d.task_id = ? AND d.run_id = ?`
      )
      .get(params.dispatchId, params.taskId, params.runId)
    if (!dispatch) {
      throw new OrchestrationError('autopilot_attempt_not_found', 'The attempt was not found.')
    }
    if (dispatch.dispatch_status !== 'pending' || dispatch.worker_state !== 'starting') {
      throw new OrchestrationError(
        'autopilot_attempt_conflict',
        'The attempt is no longer starting.'
      )
    }
  }
}
