import {
  AUTOPILOT_RUN_SUMMARY_MAX_CHARS,
  RunCompleteParams
} from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import type { RunCompleteResult } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import type { OrchestrationDb } from '../../../../orchestration/db'
import { runAutopilotWrite } from '../../../../orchestration/db/autopilot-store-input'
import {
  getTaskValidationStore,
  type TaskValidationStore
} from '../../../../orchestration/db/task-validation-store'
import {
  getWorkflowRunStore,
  type WorkflowRunStore
} from '../../../../orchestration/db/workflow-run-store'
import { isNativeTaskAttempt } from '../../../../workflow-run/app-run-policy'
import type { TaskRow } from '../../../../orchestration/types'
import { defineMethod } from '../../../core'
import {
  resolveAutopilotPrimaryCaller,
  type AutopilotPrimaryCaller
} from './autopilot-primary-caller'
import {
  AUTOPILOT_TASK_API_ERROR_CODES,
  autopilotRefusal,
  requireAutopilotTaskApi,
  runAfterCommit
} from './autopilot-task-api'
import { checkAutopilotText } from './autopilot-text-checks'

const UNSETTLED_LIST_LIMIT = 20

type Stores = { runs: WorkflowRunStore; validations: TaskValidationStore }
type Unsettled = { taskId: string; status: string }
type Settled = 'completed' | 'failed' | Unsettled

function isUnsettled(entry: Settled): entry is Unsettled {
  return typeof entry !== 'string'
}

// Why the validation is re-read: completed counts only with a pass or a user/dot waiver on record.
function settlementOf(
  owner: OrchestrationDb,
  validations: TaskValidationStore,
  task: TaskRow
): Settled {
  if (task.status === 'failed') {
    return 'failed'
  }
  if (task.status !== 'completed') {
    return { taskId: task.id, status: task.status }
  }
  const dispatch = owner.getDispatchContext(task.id)
  if (
    dispatch &&
    isNativeTaskAttempt(owner, dispatch.id) &&
    owner.getWorkerDispatch(dispatch.id)?.state === 'succeeded'
  ) {
    return 'completed'
  }
  const validated =
    validations.hasPassing(task.id) ||
    validations.listForTask(task.id).some((record) => record.waiver !== null)
  return validated ? 'completed' : { taskId: task.id, status: 'completed_unvalidated' }
}

function unsettledRefusal(unsettled: Unsettled[]): Error {
  const count = unsettled.length
  return autopilotRefusal(
    AUTOPILOT_TASK_API_ERROR_CODES.tasksUnsettled,
    `The run cannot complete: ${count} ${count === 1 ? 'task is' : 'tasks are'} not settled. Each task must have a native worker completion, a passing validation, or a failure. Start or report each open task, or ask the user to fail the ones no longer needed.`,
    { unsettledCount: count, unsettledTasks: unsettled.slice(0, UNSETTLED_LIST_LIMIT) }
  )
}

/** One transaction: active to completing (no new task or attempt can start), the check, then completed. */
function completeRun(
  owner: OrchestrationDb,
  stores: Stores,
  input: { caller: AutopilotPrimaryCaller; summary: string; timestamp: string }
): RunCompleteResult {
  const { caller, timestamp } = input
  const runId = caller.runId
  return runAutopilotWrite(owner.db, 'autopilot_run_complete', () => {
    const run = stores.runs.get(runId)
    if (run?.status !== 'active') {
      throw autopilotRefusal('autopilot_run_not_live', `Run ${runId} is not active.`)
    }
    const step = { runId, reason: null, timestamp }
    const completing = stores.runs.transition({
      ...step,
      from: 'active',
      to: 'completing',
      expectedRevision: run.revision
    })
    const settled = owner
      .listTasks({ runId })
      .map((task) => settlementOf(owner, stores.validations, task))
    const unsettled = settled.filter(isUnsettled)
    if (unsettled.length > 0) {
      throw unsettledRefusal(unsettled)
    }
    stores.runs.transition({
      ...step,
      from: 'completing',
      to: 'completed',
      expectedRevision: completing.revision
    })
    const message = owner.insertMessage({
      runId,
      from: caller.terminalHandle,
      to: `run:${runId}`,
      subject: 'Run completed',
      body: input.summary,
      type: 'status',
      payload: JSON.stringify({ kind: 'run_completed', runId })
    })
    return {
      runId,
      status: 'completed',
      completedTasks: settled.filter((entry) => entry === 'completed').length,
      failedTasks: settled.filter((entry) => entry === 'failed').length,
      summaryMessageId: message.id
    }
  })
}

/**
 * `run-complete` (U30): the attested primary declares its run complete. Refused while any task is not
 * completed with a passing (or waived) validation, or failed; the English summary is kept in the run
 * mailbox, unannounced, for the desktop and later for dot.
 */
export const RUN_COMPLETE_METHOD = defineMethod({
  name: 'orchestration.runComplete',
  params: RunCompleteParams,
  handler: (params, context): RunCompleteResult => {
    const api = requireAutopilotTaskApi(context.runtime)
    const caller = resolveAutopilotPrimaryCaller(context.runtime, context, {
      requireActiveRun: true
    })
    const check = checkAutopilotText(params.summary, AUTOPILOT_RUN_SUMMARY_MAX_CHARS)
    if (!check.ok) {
      throw autopilotRefusal(
        AUTOPILOT_TASK_API_ERROR_CODES.summaryRefused,
        `The run summary is refused: ${check.reason}. Write English and put names and paths in backticks.`,
        { reason: check.reason }
      )
    }
    const owner = context.runtime.getOrchestrationDb()
    // Why before the transaction: opening a store may need an idle connection.
    const stores = { runs: getWorkflowRunStore(owner), validations: getTaskValidationStore(owner) }
    const result = completeRun(owner, stores, {
      caller,
      summary: params.summary,
      timestamp: new Date(api.now()).toISOString()
    })
    const hook = api.afterRunCompleted
    if (hook) {
      runAfterCommit(api, () => hook(caller.runId), {
        event: 'after_run_completed_failed',
        runId: caller.runId
      })
    }
    return result
  }
})
