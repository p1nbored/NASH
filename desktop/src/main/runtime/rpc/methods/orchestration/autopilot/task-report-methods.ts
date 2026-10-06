import {
  AUTOPILOT_REPORT_SUMMARY_MAX_CHARS,
  TaskReportParams,
  type TaskReportInput
} from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import type { TaskReportResult } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { AttemptNotice } from '../../../../orchestration/db/app-attempt-input'
import {
  getAppAttemptSettlement,
  type AppAttemptView
} from '../../../../orchestration/db/app-attempt-settlement'
import { getExecutorProcessStore } from '../../../../orchestration/db/executor-process-store'
import { defineMethod, type RpcContext } from '../../../core'
import { recordReceiptBeforeNudge } from '../messaging/mutation-replay-nudge'
import { resolveAutopilotPrimaryCaller } from './autopilot-primary-caller'
import {
  AUTOPILOT_TASK_API_ERROR_CODES,
  autopilotRefusal,
  requireAutopilotTaskApi,
  runAfterCommit,
  type AutopilotTaskApi
} from './autopilot-task-api'
import {
  readAutopilotTaskView,
  requireTaskOfRun,
  taskViewReaderFor
} from './autopilot-task-snapshot'
import { checkAutopilotText } from './autopilot-text-checks'

const FAILED_REPORT_REASON = 'reported_failed'

function assertSummary(summary: string): void {
  const check = checkAutopilotText(summary, AUTOPILOT_REPORT_SUMMARY_MAX_CHARS)
  if (!check.ok) {
    throw autopilotRefusal(
      AUTOPILOT_TASK_API_ERROR_CODES.summaryRefused,
      `The report summary is refused: ${check.reason}. Write English and put names and paths in backticks.`,
      { reason: check.reason }
    )
  }
}

/** Only the task's current attempt, and only one that runs in this session, takes a report. */
function assertCurrentInSessionAttempt(owner: OrchestrationDb, params: TaskReportInput): void {
  const current = owner.getDispatchContext(params.taskId)
  if (current?.id !== params.attemptId) {
    throw autopilotRefusal(
      AUTOPILOT_TASK_API_ERROR_CODES.attemptMismatch,
      `Attempt ${params.attemptId} is not the current attempt of task ${params.taskId}.`,
      { currentAttemptId: current?.id ?? null }
    )
  }
  if (getExecutorProcessStore(owner).get(params.attemptId)) {
    throw autopilotRefusal(
      AUTOPILOT_TASK_API_ERROR_CODES.reportNotInSession,
      `Attempt ${params.attemptId} runs as an app process; the app records its result. Read it with task-show.`
    )
  }
}

// Why the report is the notice body: it is the attempt's only record, kept in Orca's run mailbox.
function noticeOf(params: TaskReportInput): AttemptNotice {
  const outcome =
    params.outcome === 'succeeded' ? 'reported finished, validation pending' : 'reported failed'
  return { subject: `Task ${params.taskId}: attempt ${outcome}`, body: params.summary }
}

function settle(
  owner: OrchestrationDb,
  params: TaskReportInput,
  timestamp: string
): AppAttemptView {
  const settlement = getAppAttemptSettlement(owner)
  const notice = noticeOf(params)
  return params.outcome === 'succeeded'
    ? settlement.settleClaim({ dispatchId: params.attemptId, timestamp, notice })
    : settlement.settleFailure({
        dispatchId: params.attemptId,
        outcome: 'failed',
        reason: FAILED_REPORT_REASON,
        timestamp,
        notice
      })
}

function announce(api: AutopilotTaskApi, context: RpcContext, settled: AppAttemptView): void {
  const { notice } = settled
  if (notice) {
    runAfterCommit(api, () => context.runtime.notifyMessageArrived(notice.to_handle, notice.type), {
      event: 'notice_announce_failed',
      taskId: settled.taskId,
      dispatchId: settled.dispatchId
    })
  }
}

/**
 * `task-report`: the attested primary reports an attempt it or its subagent or workflow ran. A
 * succeeded report is only a claim: the task waits, blocked, for its validators, which the wiring
 * starts once the claim committed. A failed report fails the attempt and the task.
 */
export const TASK_REPORT_METHOD = defineMethod({
  name: 'orchestration.taskReport',
  params: TaskReportParams,
  handler: (params, context): TaskReportResult => {
    const api = requireAutopilotTaskApi(context.runtime)
    const caller = resolveAutopilotPrimaryCaller(context.runtime, context, {
      requireActiveRun: true
    })
    const owner = context.runtime.getOrchestrationDb()
    requireTaskOfRun(owner, params.taskId, caller.runId)
    assertSummary(params.summary)
    assertCurrentInSessionAttempt(owner, params)
    const settled = settle(owner, params, new Date(api.now()).toISOString())
    const task = requireTaskOfRun(owner, params.taskId, caller.runId)
    const result: TaskReportResult = {
      attemptId: params.attemptId,
      outcome: params.outcome === 'succeeded' ? 'claimed' : 'failed',
      task: readAutopilotTaskView(taskViewReaderFor(api, owner), task)
    }
    recordReceiptBeforeNudge(context.recordMutationReceipt, result, () =>
      announce(api, context, settled)
    )
    if (params.outcome === 'succeeded') {
      const claim = { runId: caller.runId, taskId: params.taskId, dispatchId: params.attemptId }
      runAfterCommit(api, () => api.afterClaim(claim), {
        event: 'after_claim_failed',
        taskId: claim.taskId,
        dispatchId: claim.dispatchId
      })
    }
    return result
  }
})
