import type { TreeProof, TreeVerdict } from '../../agent-exec-shared/tree-termination'
import type { LatchKind } from '../../routing-table/availability/route-availability-types'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import type { ExecutorSandboxCheck } from './executor-sandbox-policy'

// One runner-neutral record of a finished Codex or agy run, and the single rule that turns it into a
// settlement. Only evidence crosses here: never the answer, stderr, a failure detail or a path.

export type ExecutorRunVerdict =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly failureKinds: readonly [string, ...string[]] }
  | {
      readonly status: 'blocked'
      readonly reason: LatchKind
      readonly failureKinds: readonly string[]
    }

export type ExecutorRunCancellation =
  | { readonly requested: false }
  | {
      readonly requested: true
      readonly trigger: 'abort_signal' | 'timeout'
      readonly proof: TreeProof
    }

export type ExecutorLastMessage = {
  readonly sha256: string
  readonly bytes: number
  readonly secretLike: boolean
}

/** Small fixed-vocabulary facts kept beside the verdict (version, probe state, hash, duration). */
export type ExecutorFacts = Readonly<Record<string, string | number | boolean | null>>

export type ExecutorRunReport = {
  readonly verdict: ExecutorRunVerdict
  readonly spawned: boolean
  readonly exitCode: number | null
  readonly cancellation: ExecutorRunCancellation
  readonly treeProof: TreeProof
  readonly lastMessage: ExecutorLastMessage | null
  readonly usage: JsonObject | null
  readonly threadId: string | null
  readonly facts: ExecutorFacts
  /** D-025: the sandbox the access level asked for and the one the runner applied. */
  readonly sandbox: ExecutorSandboxCheck
}

/** Why this app process aborted a run: a stop request (worker-stop) or the app quitting. */
export type ExecutorStopReason = 'stop_requested' | 'app_quit'

export type ProcessEvidence = {
  readonly exitCode: number | null
  readonly tree: TreeProof
  readonly lastMessage: ExecutorLastMessage | null
  readonly usage: JsonObject | null
  readonly threadId: string | null
  readonly verdict: JsonObject
}

export type SettlementDecision =
  | { readonly kind: 'claim'; readonly evidence: ProcessEvidence }
  | {
      readonly kind: 'failure'
      readonly outcome: 'failed' | 'blocked'
      readonly reason: string
      readonly latch: LatchKind | null
      readonly evidence: ProcessEvidence
    }
  | {
      readonly kind: 'stop'
      readonly stopVerdict: TreeVerdict
      readonly reason: string
      readonly tree: TreeProof | null
      readonly verdict: JsonObject
      readonly threadId: string | null
    }

const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/

function reasonCode(kind: string): string {
  return REASON_CODE.test(kind) ? kind : 'executor_failed'
}

function verdictJson(report: ExecutorRunReport): JsonObject {
  const { verdict } = report
  return {
    ...report.facts,
    status: verdict.status,
    spawned: report.spawned,
    sandbox: { ...report.sandbox },
    ...(verdict.status === 'completed' ? {} : { failures: verdict.failureKinds.map(reasonCode) }),
    ...(verdict.status === 'blocked' ? { blockedBy: verdict.reason } : {})
  }
}

function evidenceOf(report: ExecutorRunReport): ProcessEvidence {
  return {
    exitCode: report.exitCode,
    tree: report.treeProof,
    lastMessage: report.lastMessage,
    usage: report.usage,
    threadId: report.threadId,
    verdict: verdictJson(report)
  }
}

function stop(report: ExecutorRunReport, tree: TreeProof, reason: string): SettlementDecision {
  return {
    kind: 'stop',
    stopVerdict: tree.verdict,
    reason,
    tree,
    verdict: verdictJson(report),
    threadId: report.threadId
  }
}

function failure(
  report: ExecutorRunReport,
  outcome: 'failed' | 'blocked',
  reason: string,
  latch: LatchKind | null
): SettlementDecision {
  return { kind: 'failure', outcome, reason, latch, evidence: evidenceOf(report) }
}

// Why: an executor's claim is accepted only with the evidence a validator needs, and only from a
// run that went out in the sandbox its access level asks for; anything less fails, never a quiet claim.
function claimOrRefusal(report: ExecutorRunReport): SettlementDecision {
  if (report.sandbox.applied !== report.sandbox.requested) {
    return failure(report, 'failed', 'sandbox_mismatch', null)
  }
  if (report.exitCode !== 0 || report.lastMessage === null) {
    return failure(report, 'failed', 'claim_evidence_incomplete', null)
  }
  return { kind: 'claim', evidence: evidenceOf(report) }
}

function settleFinishedRun(report: ExecutorRunReport): SettlementDecision {
  const { verdict } = report
  switch (verdict.status) {
    case 'completed':
      return claimOrRefusal(report)
    case 'blocked':
      return failure(report, 'blocked', `executor_blocked_${verdict.reason}`, verdict.reason)
    case 'failed':
      return failure(report, 'failed', reasonCode(verdict.failureKinds[0]), null)
  }
}

/**
 * A stop is stopped only on proof that the tree exited; a live or unverifiable tree stays unknown,
 * so nothing is retried while a process may still run. A runner that threw is read the same way.
 */
export function decideSettlement(
  report: ExecutorRunReport | null,
  stopReason: ExecutorStopReason | null
): SettlementDecision {
  if (report === null) {
    return {
      kind: 'stop',
      stopVerdict: 'unverifiable',
      reason: 'executor_error',
      tree: null,
      verdict: { status: 'executor_error' },
      threadId: null
    }
  }
  const { cancellation } = report
  if (stopReason !== null || (cancellation.requested && cancellation.trigger === 'abort_signal')) {
    const tree = cancellation.requested ? cancellation.proof : report.treeProof
    return stop(report, tree, stopReason ?? 'stop_requested')
  }
  if (cancellation.requested) {
    return cancellation.proof.verdict === 'exited'
      ? failure(report, 'failed', 'timed_out', null)
      : stop(report, cancellation.proof, 'timed_out')
  }
  if (report.treeProof.verdict === 'live') {
    return stop(report, report.treeProof, 'process_tree_live')
  }
  return settleFinishedRun(report)
}
