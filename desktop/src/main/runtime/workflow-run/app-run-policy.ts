import type { OrchestrationDb, TaskStatus } from '../orchestration/db'
import { isEquivalentPaneKey } from '../orchestration/db/pane-key-match'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrchestrationCoordinatorKey } from '../orchestration/orchestration-caller-identity'
import { appRunReadersFor, type AppRunReaders } from './app-run-readers'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { retireUnboundPrimaryOwner } from './primary-session-run-binding'

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
  stopUnavailable: 'autopilot_policy_stop_unavailable'
} as const

export function isNativeTaskAttempt(db: OrchestrationDb, dispatchId: string): boolean {
  const worker = db.getWorkerDispatch(dispatchId)
  return worker !== undefined && JSON.parse(worker.start_options).nativeTask === true
}

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

/** Attachment preserves native tasks already present; new tasks still pass classification and routing. */
function isPreAttachmentNativeTask(db: OrchestrationDb, runId: string, taskId?: string): boolean {
  if (!taskId) {
    return false
  }
  const receipt = getPrimarySessionStore(db).latestForRun(runId)?.receipt
  if (receipt?.nativeCoordinator !== true || typeof receipt.nativeTaskBoundary !== 'number') {
    return false
  }
  return Boolean(
    db.db
      .prepare(`SELECT 1 FROM tasks WHERE id = ? AND run_id = ? AND rowid <= ?
    AND NOT EXISTS (SELECT 1 FROM task_specs WHERE task_id = tasks.id)`)
      .get(taskId, runId, receipt.nativeTaskBoundary)
  )
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
  if (isPreAttachmentNativeTask(db, input.runId, input.taskId)) {
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
  if (isPreAttachmentNativeTask(db, input.runId, input.taskId)) {
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
    assertCoordinatorMayLeaveRun(db, ownRun)
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
    assertCoordinatorMayLeaveRun(db, ownRun)
  }
  if (view.findAppRun(runId)) {
    assertCoordinatorMayLeaveRun(db, runId)
  }
}

/** Rebinding may not strand an active worker, unresolved task or approval. */
function assertCoordinatorMayLeaveRun(db: OrchestrationDb, runId: string): void {
  const tasks = db.db
    .prepare(
      "SELECT 1 FROM tasks WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'canceled') LIMIT 1"
    )
    .get(runId)
  const attempts = db.db
    .prepare(
      "SELECT 1 FROM dispatch_contexts WHERE run_id = ? AND status IN ('pending', 'dispatched') LIMIT 1"
    )
    .get(runId)
  const permissions = db.db
    .prepare("SELECT 1 FROM permission_decisions WHERE run_id = ? AND status = 'pending' LIMIT 1")
    .get(runId)
  const owner = getPrimarySessionStore(db).findLiveByRun(runId)
  if (
    tasks ||
    attempts ||
    permissions ||
    (owner && !['running', 'unverifiable'].includes(owner.state))
  ) {
    throw appRunRefusal(
      APP_RUN_POLICY_ERROR_CODES.primaryFenced,
      `Run ${runId} still has pending work or an unconfirmed coordinator; finish or cancel it before switching.`,
      { runId }
    )
  }
}

/** Releases only metadata after native run binding changed; the CLI and its context keep running. */
export function retireUnboundCoordinatorOwners(
  db: OrchestrationDb,
  runIds: readonly string[]
): void {
  const readers = appRunReadersFor(db)
  for (const runId of new Set(runIds)) {
    if (!readers.findAppRun(runId)) {
      continue
    }
    const owner = getPrimarySessionStore(db).findLiveByRun(runId)
    if (owner) {
      retireUnboundPrimaryOwner(db, owner, new Date().toISOString())
    }
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
