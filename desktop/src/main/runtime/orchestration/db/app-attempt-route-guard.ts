import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { EXECUTOR_KINDS } from './autopilot-task-schema-definition'

export const ATTEMPT_EXECUTORS = [...EXECUTOR_KINDS, 'in_session'] as const
export const AttemptExecutorSchema = z.enum(ATTEMPT_EXECUTORS)
export type AttemptExecutor = (typeof ATTEMPT_EXECUTORS)[number]

/** The targets the primary session carries out itself: a native subagent, a workflow, or its own turn. */
const IN_SESSION_TARGETS: readonly string[] = [
  'claude_primary',
  'claude_subagent',
  'claude_workflow'
]

/**
 * Nothing is substituted: the route must be this task's, available, and name the executor that is
 * about to run. A route that is unavailable or unverified is never dispatched.
 */
export function assertDispatchableRoute(
  db: Database.Database,
  params: { taskId: string; routeId: string; executor: AttemptExecutor }
): void {
  const route = db
    .prepare(
      `SELECT r.status, r.target, r.model, r.policy_level FROM task_routes r
         JOIN task_classifications c ON c.classification_id = r.classification_id
        WHERE r.route_id = ? AND c.task_id = ?`
    )
    .get(params.routeId, params.taskId)
  if (!route) {
    throw new OrchestrationError('autopilot_route_not_found', 'The route was not found.')
  }
  // Why: a task the classification kept with the primary still gets an attempt (U29); only the
  // primary itself can run it, so a process executor is never admitted on such a route.
  if (route.status === 'not_delegated' && params.executor === 'in_session') {
    return
  }
  const target = String(route.target)
  const namesExecutor =
    params.executor === 'in_session'
      ? IN_SESSION_TARGETS.includes(target)
      : target === params.executor
  // Why: a headless executor needs a concrete model; only an in-session route may inherit one.
  const hasModel =
    Boolean(route.model) || (params.executor === 'in_session' && route.policy_level === 'inherit')
  if (route.status !== 'available' || !namesExecutor || !hasModel) {
    throw new OrchestrationError(
      'autopilot_route_not_dispatchable',
      'The route is not available for this executor.'
    )
  }
}
