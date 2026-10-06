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
import {
  getExecutorProcessStore,
  type ExecutorProcessRecord
} from '../orchestration/db/executor-process-store'
import { getTaskRouteStore, type TaskRouteRecord } from '../orchestration/db/task-route-store'
import type { DispatchStatus, TaskRow } from '../orchestration/types'
import { requireWorkflowRun } from '../workbench-run/workbench-run-view-read'
import { locateAttemptTranscript, type AttemptTranscriptRoots } from './attempt-transcript-file'

export type RunTasksReadDeps = AttemptTranscriptRoots & { readonly owner: OrchestrationDb }

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

const DISPATCH_STATES: Readonly<Record<DispatchStatus, TaskWindowAttemptState>> = {
  pending: 'starting',
  dispatched: 'running',
  completed: 'completed',
  failed: 'failed',
  circuit_broken: 'failed'
}

/** The executor that ran the task wins; otherwise its route; a task kept with the primary is the primary's. */
export function taskExecutorKind(
  rows: readonly ExecutorProcessRecord[],
  route: TaskRouteRecord | null
): TaskWindowExecutorKind {
  const ran = rows.at(-1)?.executorKind
  if (ran) {
    return ran === 'agy_cli' ? 'agy' : 'codex'
  }
  const target = route?.target
  return target && Object.hasOwn(ROUTE_EXECUTORS, target)
    ? ROUTE_EXECUTORS[target]
    : 'claude_primary'
}

async function processAttempt(
  deps: RunTasksReadDeps,
  row: ExecutorProcessRecord
): Promise<WorkbenchRunTaskAttempt> {
  const location = await locateAttemptTranscript(deps, row.runDirectory)
  return {
    dispatchId: row.dispatchId,
    state: row.state,
    startedAt: row.startedAt,
    settledAt: row.settledAt,
    hasTranscript: location.kind === 'file',
    // Why null: a writing task's worktree reaches the window in its transcript's start record (D-025);
    // this row's `merged` flag would need a git check of the run worktree that NASH does not run.
    worktree: null
  }
}

const DispatchRowSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'dispatched', 'completed', 'failed', 'circuit_broken']),
  created_at: z.string(),
  dispatched_at: z.string().nullable(),
  completed_at: z.string().nullable()
})

/** A task the primary session runs has Orca Dispatches and no executor process or transcript. */
function sessionAttempts(owner: OrchestrationDb, taskId: string): WorkbenchRunTaskAttempt[] {
  return owner.db
    .prepare(
      `SELECT id, status, created_at, dispatched_at, completed_at FROM dispatch_contexts
        WHERE task_id = ? ORDER BY rowid DESC LIMIT ?`
    )
    .all(taskId, TASK_ATTEMPTS_MAX)
    .flatMap((row) => {
      const parsed = DispatchRowSchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })
    .toReversed()
    .map((row) => ({
      dispatchId: row.id,
      state: DISPATCH_STATES[row.status],
      startedAt: row.dispatched_at ?? row.created_at,
      settledAt: row.completed_at,
      hasTranscript: false,
      worktree: null
    }))
}

async function taskView(deps: RunTasksReadDeps, task: TaskRow): Promise<WorkbenchRunTask> {
  const rows = getExecutorProcessStore(deps.owner).listForTask(task.id).slice(-TASK_ATTEMPTS_MAX)
  const executorKind = taskExecutorKind(rows, getTaskRouteStore(deps.owner).latestForTask(task.id))
  const runsAsProcess = executorKind === 'codex' || executorKind === 'agy'
  return {
    taskId: task.id,
    title: task.task_title ?? task.display_name ?? null,
    executorKind,
    attempts: runsAsProcess
      ? await Promise.all(rows.map((row) => processAttempt(deps, row)))
      : sessionAttempts(deps.owner, task.id)
  }
}

/** D-024: a run's tasks for the Workbench, with each attempt's state; no output or path leaves main. */
export async function readRunTasks(
  deps: RunTasksReadDeps,
  runId: string
): Promise<WorkbenchRunTasksResult> {
  const run = requireWorkflowRun(deps.owner, runId)
  const tasks = deps.owner.listTasks({ runId: run.runId }).slice(0, RUN_TASKS_MAX)
  const views: WorkbenchRunTask[] = []
  for (const task of tasks) {
    views.push(await taskView(deps, task))
  }
  return WorkbenchRunTasksResultSchema.parse({ tasks: views })
}
