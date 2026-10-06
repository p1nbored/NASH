import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { refuseProcessEvidenceForInSession, type SettleStopParams } from './app-attempt-input'
import { expectAttempt, requireExecutorRecord, type LoadedAttempt } from './app-attempt-load'
import { stopInOrca } from './app-attempt-orca-writes'
import { APP_ATTEMPT_STAGES } from './app-attempt-stages'
import { applyExecutorTransition } from './executor-process-store'

/**
 * A stop is stopped only with proof of exit; otherwise it stays unknown and the Dispatch stays open.
 * Runs inside the transaction its caller opened, beside the executor row's own move.
 */
export function applyStop(
  owner: OrchestrationDb,
  attempt: LoadedAttempt,
  params: SettleStopParams
): void {
  requireExecutorRecord(attempt)
  expectAttempt(attempt, {
    dispatch: ['pending', 'dispatched'],
    worker: ['starting', 'ready', 'stopping', 'stop_unknown'],
    task: ['dispatched', 'blocked'],
    executor: ['starting', 'running', 'stop_unknown']
  })
  const exited = params.stopVerdict === 'exited'
  // Why: a claimed attempt has no process left to stop, and an unproven stop cannot be unproven again.
  const claimed =
    attempt.worker.state === 'ready' && attempt.worker.stage !== APP_ATTEMPT_STAGES.executorRunning
  if (claimed || (attempt.worker.state === 'stop_unknown' && !exited)) {
    throw new OrchestrationError(
      'autopilot_attempt_conflict',
      'The attempt has nothing left to stop.'
    )
  }
  if (attempt.executor) {
    applyExecutorTransition(owner.db, {
      dispatchId: params.dispatchId,
      from: attempt.executor.state,
      to: exited ? 'stopped' : 'stop_unknown',
      stopVerdict: params.stopVerdict,
      tree: params.tree,
      verdict: { ...params.verdict, reason: params.reason },
      threadId: params.threadId,
      timestamp: params.timestamp
    })
  } else {
    refuseProcessEvidenceForInSession(params, ['tree', 'verdict', 'threadId'])
  }
  stopInOrca(owner, attempt, { exited, reason: params.reason, timestamp: params.timestamp })
}
