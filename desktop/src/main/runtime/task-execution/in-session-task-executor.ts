import type { AppAttemptView } from '../orchestration/db/app-attempt-settlement'
import { inSessionInstruction, type InSessionTarget } from './task-start-instruction'
import { errorCode, type AttemptSettlementPorts } from './task-execution-ports'

// A Claude subagent, workflow or the primary's own turn runs inside the primary session (D-016 11):
// the app starts nothing, declares the attempt's worker ready and tells the primary what to run.

export type InSessionStart = {
  readonly view: AppAttemptView
  readonly instruction: string
}

export function startInSessionAttempt(
  ports: AttemptSettlementPorts,
  input: {
    readonly taskId: string
    readonly dispatchId: string
    readonly target: InSessionTarget
    readonly taskType: string | null
    readonly workflowName: string | null
  }
): InSessionStart {
  try {
    const instruction = inSessionInstruction({ ...input, cliCommand: ports.cliCommand })
    const view = ports.settlement.markRunning({
      dispatchId: input.dispatchId,
      timestamp: ports.timestamp()
    })
    return { view, instruction }
  } catch (error) {
    // Why: a starting Dispatch that nobody will run would block the task; it fails and can be retried.
    try {
      ports.settlement.markStartFailed({
        dispatchId: input.dispatchId,
        reason: 'in_session_start_failed',
        timestamp: ports.timestamp()
      })
    } catch (undoError) {
      ports.log({
        event: 'attempt_undo_failed',
        dispatchId: input.dispatchId,
        code: errorCode(undoError)
      })
    }
    throw error
  }
}
