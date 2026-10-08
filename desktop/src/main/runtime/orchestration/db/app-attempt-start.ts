import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { assertDispatchableRoute } from './app-attempt-route-guard'
import {
  AppAttemptStartInputSchema,
  type AppAttemptStartInput,
  type AppAttemptView
} from './app-attempt-input'
import { readAttemptView } from './app-attempt-load'
import { parseAutopilotInput, requireIdleAutopilotConnection } from './autopilot-store-input'
import type { TaskSpecStore } from './task-spec-store'

/**
 * Opens Orca's Dispatch for an in-session attempt. Orca's own start refuses
 * a task that is not ready (or not retryable from the stated attempt), so a dependent task cannot
 * start until its dependencies are completed by a validation. A start on an unavailable route is
 * refused before Orca writes anything.
 */
export function startAppAttempt(
  owner: OrchestrationDb,
  specs: TaskSpecStore,
  input: AppAttemptStartInput
): AppAttemptView {
  const params = parseAutopilotInput(AppAttemptStartInputSchema, input, 'attempt start')
  // Why: Orca's start opens its own transaction, so this cannot run inside one.
  requireIdleAutopilotConnection(owner.db)
  const spec = specs.get(params.taskId)
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
  return readAttemptView(owner, started.dispatch.id, null)
}
