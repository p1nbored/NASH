import type { AppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'

/** A fixed event code plus ids; never error text, which can carry a path, command or secret. */
export type TaskExecutionLogEvent = {
  readonly event: 'attempt_undo_failed'
  readonly dispatchId?: string
  readonly code?: string
}

export type AttemptSettlementPorts = {
  readonly settlement: AppAttemptSettlement
  readonly timestamp: () => string
  readonly cliCommand: string
  readonly log: (event: TaskExecutionLogEvent) => void
}

export function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code.slice(0, 64)
    : 'unknown'
}
