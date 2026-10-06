import type { OrchestrationDb, TaskStatus } from '../orchestration/db'
import { isEquivalentPaneKey } from '../orchestration/db/pane-key-match'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrchestrationCoordinatorKey } from '../orchestration/orchestration-caller-identity'
import { appRunReadersFor, type AppRunReaders } from './app-run-readers'

/**
 * Single-authority guards for runs the app owns (runs with a workflow_runs row). Orca keeps its
 * run, task and worker tables; these refusals stop its legacy commands from writing state the
 * app's validators, task-start and primary-session owner must be the only authors of. A run with
 * no workflow_runs row passes every guard untouched.
 */
export const APP_RUN_POLICY_ERROR_CODES = {
  taskStatusRefused: 'autopilot_policy_task_status_refused',
  validationRequired: 'autopilot_policy_validation_required',
  useTaskStart: 'autopilot_policy_use_task_start',
  primaryFenced: 'autopilot_policy_primary_fenced',
  resetRefused: 'autopilot_policy_reset_refused',
  reportRefused: 'autopilot_policy_report_refused',
  stopUnavailable: 'autopilot_policy_stop_unavailable'
} as const

const RESET_RUN_ID_LIMIT = 5

export function appRunRefusal(
  code: string,
  message: string,
  data: object = {}
): OrchestrationError {
  return new OrchestrationError(code, `${message} No effects were applied.`, {
    effectsApplied: false,
    ...data
  })
}

function taskStartHint(taskId: string | undefined): object {
  return taskId ? { nextCommandArgs: ['orchestration', 'task-start', '--task', taskId] } : {}
}

/** task-update in an app run: no dispatched, and completed only once a validator recorded a pass. */
export function assertAppRunTaskUpdateAllowed(
  db: OrchestrationDb,
  input: { runId: string; taskId: string; status: TaskStatus },
  readers?: AppRunReaders
): void {
  if (input.status !== 'dispatched' && input.status !== 'completed') {
    return
  }
  const view = readers ?? appRunReadersFor(db)
  if (!view.findAppRun(input.runId)) {
    return
  }
  if (input.status === 'dispatched') {
    throw appRunRefusal(
      APP_RUN_POLICY_ERROR_CODES.taskStatusRefused,
      `Task ${input.taskId} belongs to an app run: it becomes dispatched only through task-start.`,
      taskStartHint(input.taskId)
    )
  }
  if (!view.hasPassingValidation(input.taskId)) {
    throw appRunRefusal(
      APP_RUN_POLICY_ERROR_CODES.validationRequired,
      `Task ${input.taskId} belongs to an app run: it becomes completed only when a validator records a passing result.`
    )
  }
}

/** worker-start and dispatch in an app run: attempts start only through task-start. */
export function assertAppRunUsesTaskStart(
  db: OrchestrationDb,
  input: { runId: string; command: 'worker-start' | 'dispatch'; taskId?: string | undefined },
  readers?: AppRunReaders
): void {
  if (!(readers ?? appRunReadersFor(db)).findAppRun(input.runId)) {
    return
  }
  const target = input.taskId ?? '<task id>'
  throw appRunRefusal(
    APP_RUN_POLICY_ERROR_CODES.useTaskStart,
    `${input.command} is not available in an app run. Start the task's attempt with task-start --task ${target}.`,
    taskStartHint(input.taskId)
  )
}

// Why both: the owner row names the pane once the launch settled, and Orca's own binding covers the
// window before it did; either one marks the caller as a primary, so a gap in one cannot unfence it.
function primaryRunOf(
  db: OrchestrationDb,
  view: AppRunReaders,
  caller: OrchestrationCoordinatorKey
): string | null {
  const { paneKey } = caller
  if (paneKey !== null) {
    const owned = view
      .listLivePrimaryPanes()
      .find((live) => live.paneKey !== null && isEquivalentPaneKey(live.paneKey, paneKey))
    if (owned) {
      return owned.runId
    }
  }
  const bound = db.runsBoundToCoordinator(caller).find((run) => view.findAppRun(run.id))
  return bound ? bound.id : null
}

/** run-create: the primary of an app run must not open another Run and unbind itself from its own. */
export function assertAppRunPrimaryMayCreateRun(
  db: OrchestrationDb,
  caller: OrchestrationCoordinatorKey,
  readers?: AppRunReaders
): void {
  const ownRun = primaryRunOf(db, readers ?? appRunReadersFor(db), caller)
  if (ownRun) {
    throw appRunRefusal(
      APP_RUN_POLICY_ERROR_CODES.primaryFenced,
      `This terminal is the primary session of app run ${ownRun}; it cannot create another Run.`
    )
  }
}

/** run-use: a primary stays on its run, and only that primary may bind an app run. */
export function assertAppRunUseAllowed(
  db: OrchestrationDb,
  caller: OrchestrationCoordinatorKey,
  runId: string,
  readers?: AppRunReaders
): void {
  const view = readers ?? appRunReadersFor(db)
  const ownRun = primaryRunOf(db, view, caller)
  if (ownRun === runId) {
    return
  }
  if (ownRun) {
    throw appRunRefusal(
      APP_RUN_POLICY_ERROR_CODES.primaryFenced,
      `This terminal is the primary session of app run ${ownRun}; it cannot switch to another Run.`
    )
  }
  if (view.findAppRun(runId)) {
    throw appRunRefusal(
      APP_RUN_POLICY_ERROR_CODES.primaryFenced,
      `Run ${runId} is an app run; only its own primary session can bind to it.`
    )
  }
}

/** reset: it deletes the Orca runs, tasks and mail an open app run still depends on. */
export function assertNoOpenAppRunBeforeReset(db: OrchestrationDb, readers?: AppRunReaders): void {
  const open = (readers ?? appRunReadersFor(db)).listOpenAppRuns()
  if (open.length === 0) {
    return
  }
  throw appRunRefusal(
    APP_RUN_POLICY_ERROR_CODES.resetRefused,
    `Reset is refused while an app run is active (${open.length} open).`,
    { runIds: open.slice(0, RESET_RUN_ID_LIMIT).map((run) => run.runId) }
  )
}

/**
 * settleWorkerReport has no authority check, so it must never settle an app attempt: its claim goes
 * through B3's settlement and a validator. Runs inside Orca's transactions, so it opens no store.
 */
export function assertWorkerReportNotForAppAttempt(
  db: OrchestrationDb,
  dispatchId: string,
  readers?: AppRunReaders
): void {
  if ((readers ?? appRunReadersFor(db)).findExecutorAttempt(dispatchId)) {
    throw appRunRefusal(
      APP_RUN_POLICY_ERROR_CODES.reportRefused,
      `Dispatch ${dispatchId} is an app attempt: its result is recorded by its executor and validated, never reported.`
    )
  }
}
