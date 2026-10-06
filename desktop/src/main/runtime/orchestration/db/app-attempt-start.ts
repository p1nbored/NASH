import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { assertDispatchableRoute } from './app-attempt-route-guard'
import {
  AppAttemptStartInputSchema,
  type AppAttemptStartInput,
  type AppAttemptView
} from './app-attempt-input'
import { loadAttempt, readAttemptView } from './app-attempt-load'
import { failStartInOrca } from './app-attempt-orca-writes'
import {
  parseAutopilotInput,
  requireIdleAutopilotConnection,
  runAutopilotWrite
} from './autopilot-store-input'
import type { ExecutorProcessStore } from './executor-process-store'
import type { TaskSpecStore } from './task-spec-store'

/** Where a run's executors keep their files, relative to the app's data folder: one folder per attempt. */
export function appAttemptRunDirectory(runId: string, dispatchId: string): string {
  return `autopilot-runs/${runId}/${dispatchId}`
}

/**
 * Opens Orca's Dispatch for an attempt and records its executor beside it. Orca's own start refuses
 * a task that is not ready (or not retryable from the stated attempt), so a dependent task cannot
 * start until its dependencies are completed by a validation. A start on an unavailable route is
 * refused before Orca writes anything.
 */
export function startAppAttempt(
  owner: OrchestrationDb,
  stores: { executors: ExecutorProcessStore; specs: TaskSpecStore },
  input: AppAttemptStartInput
): AppAttemptView {
  const params = parseAutopilotInput(AppAttemptStartInputSchema, input, 'attempt start')
  // Why: Orca's start opens its own transaction, so this cannot run inside one.
  requireIdleAutopilotConnection(owner.db)
  const spec = stores.specs.get(params.taskId)
  if (!spec) {
    throw new OrchestrationError('autopilot_task_spec_not_found', 'The task has no TaskSpec.')
  }
  const run = owner.db.prepare('SELECT status FROM workflow_runs WHERE run_id = ?').get(spec.runId)
  if (run?.status !== 'active') {
    throw new OrchestrationError(
      'autopilot_run_not_live',
      'An attempt can only start in an active run.'
    )
  }
  assertDispatchableRoute(owner.db, {
    taskId: params.taskId,
    routeId: params.routeId,
    executor: params.executor
  })
  const started = owner.createStartingWorkerDispatch({
    taskId: params.taskId,
    startOptions: { executor: params.executor, route_id: params.routeId },
    creator: params.creator,
    maxDepth: params.maxDepth,
    retryOf: params.retryOf,
    runtimeEpoch: params.runtimeEpoch,
    mutationReceipt: params.mutationReceipt
  })
  const dispatchId = started.dispatch.id
  if (params.executor !== 'in_session') {
    try {
      stores.executors.insertStarting({
        dispatchId,
        runId: spec.runId,
        taskId: params.taskId,
        executorKind: params.executor,
        routeId: params.routeId,
        runDirectory: appAttemptRunDirectory(spec.runId, dispatchId),
        timestamp: params.timestamp
      })
    } catch (error) {
      failUnrecordedStart(owner, stores.executors, {
        dispatchId,
        timestamp: params.timestamp,
        cause: error
      })
      throw error
    }
  }
  return readAttemptView(owner, stores.executors, dispatchId, null)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Leaves no Dispatch behind that nothing will ever run: it fails, and the task can be retried from it. */
function failUnrecordedStart(
  owner: OrchestrationDb,
  executors: ExecutorProcessStore,
  failed: { dispatchId: string; timestamp: string; cause: unknown }
): void {
  try {
    runAutopilotWrite(owner.db, 'autopilot_attempt_start', () => {
      const attempt = loadAttempt(owner, executors, failed.dispatchId)
      failStartInOrca(owner, attempt, 'executor_record_failed', failed.timestamp)
    })
  } catch (undoError) {
    throw new OrchestrationError(
      'autopilot_recovery_required',
      'The attempt could not be recorded, and its start could not be undone.',
      { recordError: errorText(failed.cause), undoError: errorText(undoError) }
    )
  }
}
