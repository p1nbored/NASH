import type { MessageRow } from '../orchestration/types'
import type { AppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import type { OrchestrationDb } from '../orchestration/db'
import type { ExecutorRegistry } from './executor-registry'
import type { RouteRecheckPort } from './task-start-route'

/** A fixed event code plus ids; never error text, which can carry a path, a command line or a secret. */
export type TaskExecutionLogEvent = {
  readonly event:
    | 'executor_prepare_threw'
    | 'executor_run_threw'
    | 'attempt_settle_failed'
    | 'attempt_undo_failed'
    | 'route_latch_failed'
    | 'notice_announce_failed'
    | 'restart_reconcile_failed'
    | 'worktree_left_behind'
  readonly dispatchId?: string
  readonly code?: string
}

/** What every attempt step shares: Orca's database, the settlement, the clock and the mailbox. */
export type AttemptSettlementPorts = {
  readonly owner: OrchestrationDb
  readonly settlement: AppAttemptSettlement
  /** An ISO timestamp for the next write. */
  readonly timestamp: () => string
  readonly cliCommand: string
  /** Announces a filed mailbox message, as `runtime.notifyMessageArrived(to_handle, type)` does. */
  readonly announce: (message: MessageRow) => void
  readonly log: (event: TaskExecutionLogEvent) => void
}

export type ProcessAttemptPorts = AttemptSettlementPorts & {
  readonly registry: ExecutorRegistry
  readonly routes: Pick<RouteRecheckPort, 'latch'>
}

export function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code.slice(0, 64)
    : 'unknown'
}

/** Announces a notice if one was filed; a failed announce only delays the pointer, so it is logged. */
export function announceNotice(
  ports: Pick<AttemptSettlementPorts, 'announce' | 'log'>,
  notice: MessageRow | null,
  dispatchId: string
): void {
  if (!notice) {
    return
  }
  try {
    ports.announce(notice)
  } catch (error) {
    ports.log({ event: 'notice_announce_failed', dispatchId, code: errorCode(error) })
  }
}
