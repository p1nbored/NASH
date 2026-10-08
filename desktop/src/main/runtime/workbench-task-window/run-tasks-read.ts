import { isNativeTaskAttempt } from '../workflow-run/app-run-policy'
import { z } from 'zod'
import {
  WorkbenchRunTasksResultSchema,
  type TaskWindowAttemptState,
  type TaskWindowExecutorKind,
  type WorkbenchRunTask,
  type WorkbenchRunTaskAttempt,
  type WorkbenchRunTasksResult
} from '../../../shared/rpc-contract/workbench-task-window-params'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getTaskRouteStore, type TaskRouteRecord } from '../orchestration/db/task-route-store'
import type { DispatchStatus, TaskRow } from '../orchestration/types'
import { requireWorkflowRun } from '../workbench-run/workbench-run-view-read'
import { sessionIdFromStructuredWorkerIncarnation } from '../structured-worker-identity'
import { parseOrcaSessionAddress } from '../../../shared/orca-session-address'

export type RunTasksReadDeps = { readonly owner: OrchestrationDb }

// Why bounds: the list is polled every few seconds; a run with more tasks shows the first ones.
export const RUN_TASKS_MAX = 200
export const TASK_ATTEMPTS_MAX = 20

const ROUTE_EXECUTORS: Readonly<Record<string, TaskWindowExecutorKind>> = {
  codex_cli: 'codex',
  agy_cli: 'agy',
  claude_subagent: 'claude_subagent',
  claude_workflow: 'claude_workflow',
  claude_primary: 'claude_primary'
}

const NATIVE_WORKER_STATES: Readonly<Record<string, string>> = {
  ready: 'running',
  succeeded: 'completed',
  stopping: 'running',
  abandoned: 'failed'
}

const DISPATCH_STATES: Readonly<Record<DispatchStatus, TaskWindowAttemptState>> = {
  pending: 'starting',
  dispatched: 'running',
  completed: 'completed',
  failed: 'failed',
  circuit_broken: 'failed'
}

/** The task's route names its executor; an unrouted task belongs to the primary session. */
export function taskExecutorKind(route: TaskRouteRecord | null): TaskWindowExecutorKind {
  const target = route?.target
  return target && Object.hasOwn(ROUTE_EXECUTORS, target)
    ? ROUTE_EXECUTORS[target]
    : 'claude_primary'
}

const DispatchRowSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'dispatched', 'completed', 'failed', 'circuit_broken']),
  created_at: z.string(),
  dispatched_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  process_incarnation: z.string().nullable()
})

/** Native worker and in-session attempts share the dispatch lifecycle. */
function dispatchAttempts(
  owner: OrchestrationDb,
  taskId: string,
  executorKind: TaskWindowExecutorKind
): WorkbenchRunTaskAttempt[] {
  return owner.db
    .prepare(
      `SELECT id, status, created_at, dispatched_at, completed_at, process_incarnation FROM dispatch_contexts
        WHERE task_id = ? ORDER BY rowid DESC LIMIT ?`
    )
    .all(taskId, TASK_ATTEMPTS_MAX)
    .flatMap((row) => {
      const parsed = DispatchRowSchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })
    .toReversed()
    .map((row) => {
      const worker = isNativeTaskAttempt(owner, row.id) ? owner.getWorkerDispatch(row.id) : null
      const sessionId =
        worker &&
        (sessionIdFromStructuredWorkerIncarnation(row.process_incarnation) ??
          parseOrcaSessionAddress(worker.agent_terminal_handle))
      const source: WorkbenchRunTaskAttempt['source'] =
        worker && sessionId && worker.worktree_id
          ? {
              kind: 'session',
              worktreeId: worker.worktree_id,
              sessionId,
              agent:
                executorKind === 'codex'
                  ? 'codex'
                  : executorKind === 'agy'
                    ? 'antigravity'
                    : 'claude'
            }
          : worker?.agent_terminal_handle && !sessionId
            ? { kind: 'terminal', terminal: worker.agent_terminal_handle }
            : null
      return {
        dispatchId: row.id,
        state: worker
          ? (NATIVE_WORKER_STATES[worker.state] ?? worker.state)
          : DISPATCH_STATES[row.status],
        startedAt: row.dispatched_at ?? row.created_at,
        settledAt: row.completed_at,
        source
      }
    })
}

function taskView(deps: RunTasksReadDeps, task: TaskRow): WorkbenchRunTask {
  const executorKind = taskExecutorKind(getTaskRouteStore(deps.owner).latestForTask(task.id))
  const attempts = dispatchAttempts(deps.owner, task.id, executorKind)
  return {
    taskId: task.id,
    title: task.task_title ?? task.display_name ?? null,
    executorKind,
    attempts
  }
}

/** A run's task states and references to their existing native session surfaces. */
export async function readRunTasks(
  deps: RunTasksReadDeps,
  runId: string
): Promise<WorkbenchRunTasksResult> {
  const run = requireWorkflowRun(deps.owner, runId)
  const tasks = deps.owner.listTasks({ runId: run.runId }).slice(0, RUN_TASKS_MAX)
  const views: WorkbenchRunTask[] = []
  for (const task of tasks) {
    views.push(taskView(deps, task))
  }
  return WorkbenchRunTasksResultSchema.parse({ tasks: views })
}
