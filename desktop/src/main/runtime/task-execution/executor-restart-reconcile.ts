import type { OrchestrationDb } from '../orchestration/db'
import type { MessageRow } from '../orchestration/types'
import {
  getAppAttemptSettlement,
  type AppAttemptView
} from '../orchestration/db/app-attempt-settlement'
import { getExecutorProcessStore } from '../orchestration/db/executor-process-store'
import type { ExecutorRegistry } from './executor-registry'
import { attemptNotice, type AttemptNoticeContext } from './task-result-notice'
import { announceNotice, errorCode, type TaskExecutionLogEvent } from './task-execution-ports'

// After a restart no child of the earlier app process is held any more. A start that never reached
// running may or may not have spawned; a running one cannot be observed. Both become unknown, and
// nothing is retried: the user decides (D-016).

const RESTART_REASON = 'app_restarted'
const READ_LIMIT = 1000

export type ExecutorRestartSummary = {
  readonly startUnknown: readonly string[]
  readonly stopUnknown: readonly string[]
  readonly startFailed: readonly string[]
  /** Held by this app process, so not left over from an earlier one. */
  readonly skipped: readonly string[]
  readonly failed: readonly string[]
}

type ReconcileDeps = {
  readonly owner: OrchestrationDb
  readonly registry: Pick<ExecutorRegistry, 'holds'>
  readonly now: () => number
  readonly cliCommand: string
  readonly announce: (message: MessageRow) => void
  readonly log: (event: TaskExecutionLogEvent) => void
}

type Outcome = keyof ExecutorRestartSummary

type Tally = {
  readonly record: (outcome: Outcome, dispatchId: string) => void
  /** One settlement; a failure is logged with its code only and the next attempt still runs. */
  readonly settle: (outcome: Outcome, dispatchId: string, write: () => AppAttemptView) => void
  readonly summary: () => ExecutorRestartSummary
}

function createTally(deps: ReconcileDeps): Tally {
  const results = new Map<Outcome, readonly string[]>()
  const record = (outcome: Outcome, dispatchId: string): void => {
    results.set(outcome, [...(results.get(outcome) ?? []), dispatchId])
  }
  const list = (outcome: Outcome): readonly string[] => results.get(outcome) ?? []
  return {
    record,
    settle: (outcome, dispatchId, write) => {
      try {
        announceNotice(deps, write().notice, dispatchId)
        record(outcome, dispatchId)
      } catch (error) {
        deps.log({ event: 'restart_reconcile_failed', dispatchId, code: errorCode(error) })
        record('failed', dispatchId)
      }
    },
    summary: () => ({
      startUnknown: list('startUnknown'),
      stopUnknown: list('stopUnknown'),
      startFailed: list('startFailed'),
      skipped: list('skipped'),
      failed: list('failed')
    })
  }
}

function reconcileOpenExecutors(deps: ReconcileDeps, tally: Tally, timestamp: () => string): void {
  const settlement = getAppAttemptSettlement(deps.owner)
  for (const executor of getExecutorProcessStore(deps.owner).listOpen(READ_LIMIT)) {
    const { dispatchId } = executor
    if (deps.registry.holds(dispatchId)) {
      tally.record('skipped', dispatchId)
      continue
    }
    const context: AttemptNoticeContext = {
      taskId: executor.taskId,
      dispatchId,
      executor: executor.executorKind,
      cliCommand: deps.cliCommand
    }
    if (executor.state === 'starting') {
      tally.settle('startUnknown', dispatchId, () =>
        settlement.markStartUnknown({
          dispatchId,
          reason: RESTART_REASON,
          timestamp: timestamp(),
          notice: attemptNotice(context, { kind: 'start_unknown', reason: RESTART_REASON })
        })
      )
      continue
    }
    tally.settle('stopUnknown', dispatchId, () =>
      settlement.settleStop({
        dispatchId,
        stopVerdict: 'unverifiable',
        reason: RESTART_REASON,
        timestamp: timestamp(),
        notice: attemptNotice(context, { kind: 'stop_unknown', reason: RESTART_REASON })
      })
    )
  }
}

/** Runs once at startup, before any start; an attempt this process already holds is left alone. */
export function reconcileExecutorsAfterRestart(deps: ReconcileDeps): ExecutorRestartSummary {
  const settlement = getAppAttemptSettlement(deps.owner)
  const timestamp = (): string => new Date(deps.now()).toISOString()
  const tally = createTally(deps)
  reconcileOpenExecutors(deps, tally, timestamp)
  for (const start of settlement.listUnrecordedStarts(READ_LIMIT)) {
    // Why: Orca's Dispatch was opened but the executor row never written, so no process can exist.
    tally.settle('startFailed', start.dispatchId, () =>
      settlement.markStartFailed({
        dispatchId: start.dispatchId,
        reason: 'executor_record_missing',
        timestamp: timestamp()
      })
    )
  }
  return tally.summary()
}
