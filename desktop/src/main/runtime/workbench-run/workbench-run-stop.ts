import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import { WORKFLOW_RUN_TERMINAL_STATUSES } from '../orchestration/db/workflow-run-transition'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { moveWorkflowRun } from '../workflow-run/primary-session-moves'
import type { PrimarySessionRuntime } from '../workflow-run/primary-session-runtime'
import type { PrimarySessionStopResult } from '../workflow-run/primary-session-stop'

export type RunStopPort = Pick<PrimarySessionRuntime, 'stopPrimarySession' | 'stopRunWorkers'>

export type RunStopOutcome = {
  readonly run: WorkflowRunRecord
  /** False when the run had already ended (failed or canceled) and nothing was stopped. */
  readonly changed: boolean
}

/** The end reason a cancel records on the run and its owner, by who asked. */
export const RUN_CANCEL_REASONS = ['user_canceled', 'dot_canceled'] as const
export type RunCancelReason = (typeof RUN_CANCEL_REASONS)[number]

const TERMINAL: ReadonlySet<string> = new Set(WORKFLOW_RUN_TERMINAL_STATUSES)

function requireStopped(stopped: PrimarySessionStopResult): void {
  if (stopped.outcome === 'refused') {
    // Why: the session ended on its own between the read and the stop; there is nothing left to stop.
    if (stopped.code === 'autopilot_owner_not_live') {
      return
    }
    throw new OrchestrationError(
      'workbench_run_stop_refused',
      'The session could not be stopped now. Nothing was changed.',
      { stopCode: stopped.code }
    )
  }
  if (stopped.outcome === 'stop_unconfirmed') {
    throw new OrchestrationError(
      'workbench_run_stop_unconfirmed',
      'The session could not be confirmed stopped, so the run is still open. Close its terminal tab and try again.'
    )
  }
}

/**
 * Ends a run because its request was canceled or the user stopped it: stops the live primary
 * (interrupt, wait, close), then records the run as canceled. A stop that is not confirmed refuses
 * and records nothing, because the session may still be working. A completed run is never canceled.
 */
export async function stopWorkflowRunForCancel(
  owner: OrchestrationDb,
  runId: string,
  reason: RunCancelReason,
  control: () => RunStopPort
): Promise<RunStopOutcome> {
  const run = getWorkflowRunStore(owner).get(runId)
  if (!run) {
    throw new OrchestrationError('workbench_run_not_found', 'The run was not found.')
  }
  if (run.status === 'completed') {
    throw new OrchestrationError(
      'workbench_run_completed',
      'The run already completed, so there is nothing to cancel.'
    )
  }
  if (TERMINAL.has(run.status)) {
    await control().stopRunWorkers?.(runId)
    return { run, changed: false }
  }
  if (getPrimarySessionStore(owner).findLiveByRun(runId)) {
    requireStopped(await control().stopPrimarySession(runId, reason))
  }
  await control().stopRunWorkers?.(runId)
  const ended = moveWorkflowRun(owner, runId, 'canceled', reason, new Date().toISOString()) ?? run
  return { run: ended, changed: ended.status === 'canceled' }
}
