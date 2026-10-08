import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import type { DispatchContextRow, MessageRow, TaskRow, WorkerDispatchRow } from '../types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { AttemptExecutorSchema } from './app-attempt-route-guard'
import type { AppAttemptView } from './app-attempt-input'

// Reading an attempt back out of Orca and the app's side rows, and the state a change may start from.

const StartOptionsSchema = z.object({ executor: AttemptExecutorSchema, route_id: z.string() })

export type LoadedAttempt = {
  dispatch: DispatchContextRow
  worker: WorkerDispatchRow
  task: TaskRow
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
      `SELECT 1 AS found FROM task_validations WHERE dispatch_id = ?
       UNION ALL SELECT 1 FROM attempt_artifacts WHERE dispatch_id = ?`
    )
    .get(dispatchId, dispatchId)
  return row !== undefined
}

/** An attempt is a Dispatch of a task that has a TaskSpec, started through the app's own start path. */
export function loadAttempt(owner: OrchestrationDb, dispatchId: string): LoadedAttempt {
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
}

/** A settlement applies to one exact state; anything else is a conflict and nothing is written. */
export function expectAttempt(attempt: LoadedAttempt, expected: AttemptExpectation): void {
  const fits =
    expected.dispatch.includes(attempt.dispatch.status) &&
    expected.worker.includes(attempt.worker.state) &&
    expected.task.includes(attempt.task.status) &&
    (expected.stage === undefined || expected.stage.includes(attempt.worker.stage))
  if (!fits) {
    throw new OrchestrationError(
      'autopilot_attempt_conflict',
      `The attempt cannot take this change from its current state (${attempt.worker.state}, ${attempt.worker.stage}).`
    )
  }
}

export function readAttemptView(
  owner: OrchestrationDb,
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
    notice
  }
}
