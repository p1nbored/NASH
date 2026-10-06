import type { TreeProof } from '../../agent-exec-shared/tree-termination'
import type { RouteSubject } from '../../routing-table/availability/route-availability-types'
import type { AppAttemptView } from '../orchestration/db/app-attempt-settlement'
import type { SettlementDecision } from './executor-run-report'
import { attemptNotice, type AttemptNoticeContext } from './task-result-notice'
import { announceNotice, errorCode, type ProcessAttemptPorts } from './task-execution-ports'

// Applies the one decision a finished run gets, through the app's attempt settlement only: Orca's
// Dispatch, worker and task move with the executor row, and the English notice is filed with them.

/** What the stop port answers when a run settled without a tree of its own (the runner threw). */
const NO_TREE: TreeProof = { verdict: 'unverifiable', method: 'root_exit_only' }

type Decision<K extends SettlementDecision['kind']> = Extract<SettlementDecision, { kind: K }>

function settleStop(
  ports: ProcessAttemptPorts,
  context: AttemptNoticeContext,
  decision: Pick<Decision<'stop'>, 'stopVerdict' | 'reason' | 'tree' | 'verdict' | 'threadId'>
): AppAttemptView {
  const notice =
    decision.stopVerdict === 'exited'
      ? attemptNotice(context, { kind: 'stopped', reason: decision.reason })
      : attemptNotice(context, { kind: 'stop_unknown', reason: decision.reason })
  return ports.settlement.settleStop({
    dispatchId: context.dispatchId,
    stopVerdict: decision.stopVerdict,
    reason: decision.reason,
    tree: decision.tree,
    verdict: decision.verdict,
    threadId: decision.threadId,
    timestamp: ports.timestamp(),
    notice
  })
}

function settleFinished(
  ports: ProcessAttemptPorts,
  context: AttemptNoticeContext,
  decision: Decision<'claim'> | Decision<'failure'>
): AppAttemptView {
  const { evidence } = decision
  const shared = {
    dispatchId: context.dispatchId,
    exitCode: evidence.exitCode,
    tree: evidence.tree,
    lastMessage: evidence.lastMessage,
    verdict: evidence.verdict,
    usage: evidence.usage,
    threadId: evidence.threadId,
    timestamp: ports.timestamp()
  }
  if (decision.kind === 'claim') {
    const secretLike = evidence.lastMessage?.secretLike ?? false
    return ports.settlement.settleClaim({
      ...shared,
      notice: attemptNotice(context, { kind: 'claimed', secretLike })
    })
  }
  const notice =
    decision.latch === null
      ? attemptNotice(context, { kind: 'failed', reason: decision.reason })
      : attemptNotice(context, { kind: 'blocked', latch: decision.latch })
  return ports.settlement.settleFailure({
    ...shared,
    outcome: decision.outcome,
    reason: decision.reason,
    notice
  })
}

function latchRoute(
  ports: ProcessAttemptPorts,
  subject: RouteSubject,
  decision: SettlementDecision,
  dispatchId: string
): void {
  if (decision.kind !== 'failure' || decision.latch === null) {
    return
  }
  try {
    ports.routes.latch(subject, decision.latch)
  } catch (error) {
    ports.log({ event: 'route_latch_failed', dispatchId, code: errorCode(error) })
  }
}

// Why: worker-stop marks the worker stopping before it asks the port, so a run that ends meanwhile
// is settled as that stop, with the tree its own exit proved.
function settleAsStop(
  ports: ProcessAttemptPorts,
  context: AttemptNoticeContext,
  decision: Decision<'claim'> | Decision<'failure'>
): AppAttemptView | null {
  if (ports.owner.getWorkerDispatch(context.dispatchId)?.state !== 'stopping') {
    return null
  }
  const { tree, verdict, threadId } = decision.evidence
  return settleStop(ports, context, {
    stopVerdict: tree.verdict,
    reason: 'stop_requested',
    tree,
    verdict,
    threadId
  })
}

function settle(
  ports: ProcessAttemptPorts,
  context: AttemptNoticeContext,
  decision: SettlementDecision
): AppAttemptView | null {
  if (decision.kind === 'stop') {
    return settleStop(ports, context, decision)
  }
  try {
    return settleFinished(ports, context, decision)
  } catch (error) {
    ports.log({
      event: 'attempt_settle_failed',
      dispatchId: context.dispatchId,
      code: errorCode(error)
    })
    return settleAsStop(ports, context, decision)
  }
}

/** Settles the attempt, latches a blocked route and announces the notice; returns the tree for the stop port. */
export function applySettlement(
  ports: ProcessAttemptPorts,
  context: AttemptNoticeContext,
  decision: SettlementDecision,
  subject: RouteSubject
): TreeProof {
  latchRoute(ports, subject, decision, context.dispatchId)
  try {
    const view = settle(ports, context, decision)
    announceNotice(ports, view?.notice ?? null, context.dispatchId)
  } catch (error) {
    ports.log({
      event: 'attempt_settle_failed',
      dispatchId: context.dispatchId,
      code: errorCode(error)
    })
  }
  return decision.kind === 'stop' ? (decision.tree ?? NO_TREE) : decision.evidence.tree
}
