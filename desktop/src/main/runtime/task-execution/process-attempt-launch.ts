import type { TreeProof } from '../../agent-exec-shared/tree-termination'
import type { RouteSubject } from '../../routing-table/availability/route-availability-types'
import type { AppAttemptView } from '../orchestration/db/app-attempt-settlement'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { AttemptPlacement } from './attempt-workspace'
import type { AttemptWorktree } from './attempt-worktree'
import { decideSettlement, type ExecutorRunReport } from './executor-run-report'
import { applySettlement } from './process-attempt-settle'
import type {
  PrepareOutcome,
  PreparedProcessRun,
  ProcessAttemptPlan,
  ProcessTaskExecutor
} from './process-executor-contract'
import { attemptNotice, isQuotable, type AttemptNoticeContext } from './task-result-notice'
import { announceNotice, errorCode, type ProcessAttemptPorts } from './task-execution-ports'

// One Codex or agy attempt after Orca opened its Dispatch: prepare, mark running, run in the
// background, settle. Every path ends in exactly one settlement, and the stop port is always answered.

export type ProcessAttemptLaunch = {
  readonly view: AppAttemptView
  /** Where the attempt runs; null when it never started. */
  readonly placement: AttemptPlacement | null
  /** Resolves once the run has settled; it never rejects. */
  readonly settled: Promise<void>
}

const NOTHING_RAN: TreeProof = { verdict: 'exited', method: 'not_started' }
const UNKNOWN_TREE: TreeProof = { verdict: 'unverifiable', method: 'root_exit_only' }
const SETTLED: Promise<void> = Promise.resolve()

function failStart(
  ports: ProcessAttemptPorts,
  context: AttemptNoticeContext,
  reason: string,
  verdict?: JsonObject
): AppAttemptView {
  const view = ports.settlement.markStartFailed({
    dispatchId: context.dispatchId,
    reason,
    verdict,
    timestamp: ports.timestamp(),
    notice: attemptNotice(context, { kind: 'start_failed', reason })
  })
  announceNotice(ports, view.notice, context.dispatchId)
  return view
}

/** The worktree a start abandoned after prepare created it; NASH never removes one (D-025). */
function worktreeLeftBehind(placement: AttemptPlacement): AttemptWorktree | null {
  return placement.mode === 'own_worktree' ? placement.worktree : null
}

/** Branch and path for the settlement record, when they fit it; the log line names the attempt anyway. */
function leftBehindEvidence(worktree: AttemptWorktree | null): JsonObject | undefined {
  if (!worktree || !isQuotable(worktree.branch) || !isQuotable(worktree.path)) {
    return undefined
  }
  return { worktreeLeftBehind: { branch: worktree.branch, path: worktree.path } }
}

async function prepareSafely(
  ports: ProcessAttemptPorts,
  executor: ProcessTaskExecutor,
  plan: ProcessAttemptPlan
): Promise<PrepareOutcome> {
  try {
    return await executor.prepare(plan)
  } catch (error) {
    ports.log({
      event: 'executor_prepare_threw',
      dispatchId: plan.dispatchId,
      code: errorCode(error)
    })
    return { ok: false, reason: 'executor_prepare_failed' }
  }
}

/**
 * Nothing ran. A stop or quit that arrived meanwhile settles as stopped (proven: nothing started);
 * anything else fails the start. Either way the stop port is answered.
 */
function settleNeverRan(
  ports: ProcessAttemptPorts,
  context: AttemptNoticeContext,
  failure: string,
  leftBehind: AttemptWorktree | null = null
): AppAttemptView | null {
  const { dispatchId } = context
  if (leftBehind) {
    ports.log({ event: 'worktree_left_behind', dispatchId })
  }
  const verdict = leftBehindEvidence(leftBehind)
  const stopReason =
    ports.registry.stopReason(dispatchId) ??
    (ports.owner.getWorkerDispatch(dispatchId)?.state === 'stopping' ? 'stop_requested' : null)
  try {
    if (stopReason === null) {
      return failStart(ports, context, failure, verdict)
    }
    const view = ports.settlement.settleStop({
      dispatchId,
      stopVerdict: 'exited',
      reason: stopReason,
      tree: NOTHING_RAN,
      verdict,
      timestamp: ports.timestamp(),
      notice: attemptNotice(context, { kind: 'stopped', reason: stopReason })
    })
    announceNotice(ports, view.notice, dispatchId)
    return view
  } catch (error) {
    ports.log({ event: 'attempt_undo_failed', dispatchId, code: errorCode(error) })
    return null
  } finally {
    ports.registry.finish(dispatchId, NOTHING_RAN)
  }
}

async function runAndSettle(
  ports: ProcessAttemptPorts,
  context: AttemptNoticeContext,
  prepared: PreparedProcessRun,
  signal: AbortSignal,
  subject: RouteSubject
): Promise<void> {
  let tree = UNKNOWN_TREE
  try {
    let report: ExecutorRunReport | null = null
    try {
      report = await prepared.run(signal)
    } catch (error) {
      ports.log({
        event: 'executor_run_threw',
        dispatchId: context.dispatchId,
        code: errorCode(error)
      })
    }
    const decision = decideSettlement(report, ports.registry.stopReason(context.dispatchId))
    tree = applySettlement(ports, context, decision, subject)
  } finally {
    // Why: a stop request waits on this, so it is answered even if settling failed.
    ports.registry.finish(context.dispatchId, tree)
  }
}

/** Prepares and marks the attempt running, then leaves the run going; a refusal fails the start. */
export async function launchProcessAttempt(
  ports: ProcessAttemptPorts,
  executor: ProcessTaskExecutor,
  plan: ProcessAttemptPlan,
  subject: RouteSubject
): Promise<ProcessAttemptLaunch> {
  const context: AttemptNoticeContext = {
    taskId: plan.taskId,
    dispatchId: plan.dispatchId,
    executor: executor.kind,
    cliCommand: ports.cliCommand
  }
  // Why: held before prepare, so a stop or a quit during it is seen and nothing starts afterwards.
  const signal = ports.registry.track(plan.dispatchId, executor.kind)
  if (signal === null) {
    return { view: failStart(ports, context, 'app_quitting'), placement: null, settled: SETTLED }
  }
  const outcome = await prepareSafely(ports, executor, plan)
  if (signal.aborted || !outcome.ok) {
    const view = outcome.ok
      ? settleNeverRan(
          ports,
          context,
          'stop_requested',
          worktreeLeftBehind(outcome.prepared.placement)
        )
      : settleNeverRan(ports, context, outcome.reason)
    if (!view) {
      throw new OrchestrationError(
        'autopilot_recovery_required',
        'The attempt could not be settled after its start was refused.'
      )
    }
    return { view, placement: null, settled: SETTLED }
  }
  let view: AppAttemptView
  try {
    view = ports.settlement.markRunning({
      dispatchId: plan.dispatchId,
      executableEvidence: outcome.prepared.evidence,
      timestamp: ports.timestamp()
    })
  } catch (error) {
    settleNeverRan(
      ports,
      context,
      'executor_mark_running_failed',
      worktreeLeftBehind(outcome.prepared.placement)
    )
    throw error
  }
  const settled = runAndSettle(ports, context, outcome.prepared, signal, subject).catch((error) => {
    ports.log({
      event: 'attempt_settle_failed',
      dispatchId: plan.dispatchId,
      code: errorCode(error)
    })
  })
  return { view, placement: outcome.prepared.placement, settled }
}
