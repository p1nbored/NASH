import type { OrchestrationDb } from '../orchestration/db'
import { WORKFLOW_RUN_STATUSES } from '../orchestration/db/autopilot-run-schema-definition'
import type { EXECUTOR_KINDS } from '../orchestration/db/autopilot-task-schema-definition'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import {
  WORKFLOW_RUN_TERMINAL_STATUSES,
  type WorkflowRunStatus
} from '../orchestration/db/workflow-run-transition'

export type ExecutorKind = (typeof EXECUTOR_KINDS)[number]

export type AppRunRecord = { runId: string; status: WorkflowRunStatus }
export type LivePrimaryPane = { runId: string; paneKey: string | null }

/**
 * The narrow, read-only view the single-authority guards take of the app's side tables. The guards
 * never write, and a run without a workflow_runs row is simply absent from every answer here.
 */
export type AppRunReaders = {
  /** The app's record of a run, or null when the run has no workflow_runs row. */
  findAppRun(runId: string): AppRunRecord | null
  /** App runs that have not reached completed, failed or canceled, oldest first. */
  listOpenAppRuns(): readonly AppRunRecord[]
  /** The pane of each live primary session; a session still starting has no pane yet. */
  listLivePrimaryPanes(): readonly LivePrimaryPane[]
  /** True when a validator recorded a passing verdict for the task (task_validations, written by B3). */
  hasPassingValidation(taskId: string): boolean
  /** The executor kind of an app-owned Codex or agy attempt, or null for every other dispatch. */
  findExecutorAttempt(dispatchId: string): { kind: ExecutorKind } | null
}

/** What every guard sees before the app ever recorded a run: no app run, no pass, no executor. */
export const NO_APP_RUNS: AppRunReaders = Object.freeze({
  findAppRun: () => null,
  listOpenAppRuns: () => [],
  listLivePrimaryPanes: () => [],
  hasPassingValidation: () => false,
  findExecutorAttempt: () => null
})

const READ_LIMIT = 1000
const TERMINAL: ReadonlySet<string> = new Set(WORKFLOW_RUN_TERMINAL_STATUSES)
const OPEN_STATUSES = WORKFLOW_RUN_STATUSES.filter((status) => !TERMINAL.has(status))

function isExecutorKind(value: unknown): value is ExecutorKind {
  return value === 'codex_cli' || value === 'agy_cli'
}

// Why: probing sqlite_master keeps an Orca database that never ran the app untouched; opening the
// stores would create the family, so they are only reached once workflow_runs exists.
function hasAppRunTables(owner: OrchestrationDb): boolean {
  return (
    owner.db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'workflow_runs'"
      )
      .get() !== undefined
  )
}

/**
 * Reads through the A2 stores for runs and owners, which verify the schema and fail closed when it
 * has drifted. The stores open on first use, so the two plain SELECTs (validation, executor) never
 * need an idle connection and may run inside a transaction.
 */
export function appRunReadersFor(owner: OrchestrationDb): AppRunReaders {
  if (!hasAppRunTables(owner)) {
    return NO_APP_RUNS
  }
  return {
    findAppRun: (runId) => {
      const run = getWorkflowRunStore(owner).get(runId)
      return run ? { runId: run.runId, status: run.status } : null
    },
    listOpenAppRuns: () =>
      getWorkflowRunStore(owner)
        .listByStatus(OPEN_STATUSES, READ_LIMIT)
        .map((run) => ({ runId: run.runId, status: run.status })),
    listLivePrimaryPanes: () =>
      getPrimarySessionStore(owner)
        .listLive(READ_LIMIT)
        .map((session) => ({ runId: session.runId, paneKey: session.paneKey })),
    // Why: Orca's reset deletes tasks but not these rows, so a pass whose task is gone is no pass.
    hasPassingValidation: (taskId) =>
      owner.db
        .prepare(
          `SELECT 1 AS passed FROM task_validations v
            WHERE v.task_id = ? AND v.verdict = 'pass'
              AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = v.task_id) LIMIT 1`
        )
        .get(taskId) !== undefined,
    // Why: an executor row whose dispatch Orca deleted is an orphan, not an attempt to guard.
    findExecutorAttempt: (dispatchId) => {
      const row = owner.db
        .prepare(
          `SELECT e.executor_kind FROM executor_processes e WHERE e.dispatch_id = ?
            AND EXISTS (SELECT 1 FROM dispatch_contexts d WHERE d.id = e.dispatch_id)`
        )
        .get(dispatchId)
      return row && isExecutorKind(row.executor_kind) ? { kind: row.executor_kind } : null
    }
  }
}
