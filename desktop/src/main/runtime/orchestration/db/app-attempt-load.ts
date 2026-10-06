import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import type { DispatchContextRow, MessageRow, TaskRow, WorkerDispatchRow } from '../types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { AttemptExecutorSchema } from './app-attempt-route-guard'
import type { AppAttemptView } from './app-attempt-input'
import type { ExecutorProcessRecord } from './executor-process-record'
import type { ExecutorProcessStore } from './executor-process-store'

// Reading an attempt back out of Orca and the app's side rows, and the state a change may start from.

const StartOptionsSchema = z.object({ executor: AttemptExecutorSchema, route_id: z.string() })

export type LoadedAttempt = {
  dispatch: DispatchContextRow
  worker: WorkerDispatchRow
  task: TaskRow
  /** Null for an in-session attempt, and for a process attempt whose executor row was never written. */
  executor: ExecutorProcessRecord | null
  kind: 'process' | 'in_session'
  /** The route the attempt was started on, from Orca's start options. */
  routeId: string
}

function notFound(): OrchestrationError {
  return new OrchestrationError('autopilot_attempt_not_found', 'The attempt was not found.')
}

/** Side rows outlive an Orca reset, so a Dispatch Orca lacks but the app holds rows for is orphaned. */
function holdsSideRows(db: Database.Database, dispatchId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS found FROM executor_processes WHERE dispatch_id = ?
       UNION ALL SELECT 1 FROM task_validations WHERE dispatch_id = ?
       UNION ALL SELECT 1 FROM attempt_artifacts WHERE dispatch_id = ?`
    )
    .get(dispatchId, dispatchId, dispatchId)
  return row !== undefined
}

/** An attempt is a Dispatch of a task that has a TaskSpec, started through the app's own start path. */
export function loadAttempt(
  owner: OrchestrationDb,
  executors: ExecutorProcessStore,
  dispatchId: string
): LoadedAttempt {
  const dispatch = owner.getDispatchContextById(dispatchId)
  if (!dispatch) {
    throw holdsSideRows(owner.db, dispatchId)
      ? new OrchestrationError(
          'autopilot_attempt_orphaned',
          'Orca no longer holds this attempt, as after a reset.'
        )
      : notFound()
  }
  const worker = owner.getWorkerDispatch(dispatchId)
  const task = owner.getTask(dispatch.task_id)
  const isAppTask = owner.db
    .prepare('SELECT 1 AS found FROM task_specs WHERE task_id = ? AND run_id = ?')
    .get(dispatch.task_id, dispatch.run_id)
  const options = worker ? StartOptionsSchema.safeParse(parseJson(worker.start_options)) : null
  if (!worker || !task || !isAppTask || !options?.success) {
    throw notFound()
  }
  return {
    dispatch,
    worker,
    task,
    executor: executors.get(dispatchId),
    kind: options.data.executor === 'in_session' ? 'in_session' : 'process',
    routeId: options.data.route_id
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export type AttemptExpectation = {
  dispatch: readonly string[]
  worker: readonly string[]
  task: readonly string[]
  stage?: readonly string[]
  executor?: readonly string[]
  /** Only a failed start may be recorded for a process attempt whose executor row was never written. */
  executorMayBeMissing?: boolean
}

/** A settlement applies to one exact state; anything else is a conflict and nothing is written. */
export function expectAttempt(attempt: LoadedAttempt, expected: AttemptExpectation): void {
  const executorFits =
    expected.executor === undefined || attempt.kind === 'in_session'
      ? true
      : attempt.executor === null
        ? expected.executorMayBeMissing === true
        : expected.executor.includes(attempt.executor.state)
  const fits =
    expected.dispatch.includes(attempt.dispatch.status) &&
    expected.worker.includes(attempt.worker.state) &&
    expected.task.includes(attempt.task.status) &&
    (expected.stage === undefined || expected.stage.includes(attempt.worker.stage)) &&
    executorFits
  if (!fits) {
    throw new OrchestrationError(
      'autopilot_attempt_conflict',
      `The attempt cannot take this change from its current state (${attempt.worker.state}, ${attempt.worker.stage}).`
    )
  }
}

/** A process attempt without its executor row is a crash between the two start writes: no process ever ran. */
export function requireExecutorRecord(attempt: LoadedAttempt): void {
  if (attempt.kind === 'process' && attempt.executor === null) {
    throw new OrchestrationError(
      'autopilot_recovery_required',
      'The attempt has no executor record. Only a failed start can be recorded for it.'
    )
  }
}

export function readAttemptView(
  owner: OrchestrationDb,
  executors: ExecutorProcessStore,
  dispatchId: string,
  notice: MessageRow | null
): AppAttemptView {
  const dispatch = owner.getDispatchContextById(dispatchId)
  const worker = owner.getWorkerDispatch(dispatchId)
  const task = dispatch ? owner.getTask(dispatch.task_id) : undefined
  if (!dispatch || !worker || !task) {
    throw new OrchestrationError('autopilot_recovery_required', 'The attempt rows disappeared.')
  }
  return {
    dispatchId,
    taskId: task.id,
    taskStatus: task.status,
    dispatchStatus: dispatch.status,
    workerState: worker.state,
    workerStage: worker.stage,
    executor: executors.get(dispatchId),
    notice
  }
}
