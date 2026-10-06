import {
  WorkbenchRunListParams,
  WorkbenchRunMessageParams,
  WorkbenchRunShowParams,
  WorkbenchRunStopParams
} from '../../../../shared/rpc-contract/workbench-run-params'
import {
  RunMessageSendResultSchema,
  WorkflowRunListResultSchema,
  type RunMessageSendResult,
  type WorkflowRunListResult,
  type WorkflowRunShowResult,
  type WorkflowRunStopResult
} from '../../../../shared/workflow-run/workflow-run-view'
import type { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import { requireWorkbenchCaller } from '../../workbench-caller'
import { stopWorkflowRunFromDesktop } from '../../workbench-run/workbench-run-desktop-stop'
import {
  listWorkflowRunViews,
  requireWorkflowRun,
  workflowRunView
} from '../../workbench-run/workbench-run-view-read'
import {
  getPrimarySessionRuntime,
  requirePrimarySessionRuntime
} from '../../workflow-run/primary-session-runtime'
import { defineMethod, type RpcContext } from '../core'

/** The trusted desktop caller only; passive, so no old federation or coordinator pump starts. */
function desktopOwner(context: RpcContext): OrchestrationDb {
  requireWorkbenchCaller(context.workbenchCaller)
  return context.runtime.getOrchestrationDb({ passive: true })
}

export const WORKBENCH_RUN_LIST_METHOD = defineMethod({
  name: 'workbench.runs.list',
  params: WorkbenchRunListParams,
  handler: (params, context): WorkflowRunListResult =>
    WorkflowRunListResultSchema.parse(listWorkflowRunViews(desktopOwner(context), params))
})

/** One run with what its primary is doing now; without the workflow runtime, stored records only. */
export const WORKBENCH_RUN_SHOW_METHOD = defineMethod({
  name: 'workbench.runs.show',
  params: WorkbenchRunShowParams,
  handler: async (params, context): Promise<WorkflowRunShowResult> => {
    const owner = desktopOwner(context)
    const run = requireWorkflowRun(owner, params.runId)
    const read = (await getPrimarySessionRuntime()?.readPrimarySessionStatus(run.runId)) ?? null
    return { run: workflowRunView(owner, run, read) }
  }
})

/** Stops the primary, ends the run as canceled and cancels its intake receipt (D-016 section 1.3). */
export const WORKBENCH_RUN_STOP_METHOD = defineMethod({
  name: 'workbench.runs.stop',
  params: WorkbenchRunStopParams,
  handler: async (params, context): Promise<WorkflowRunStopResult> => {
    const owner = desktopOwner(context)
    const run = requireWorkflowRun(owner, params.runId)
    const stopped = await stopWorkflowRunFromDesktop(owner, run.runId, {
      require: (workspaceId) => context.runtime.requireWorkbenchWorkspace(workspaceId)
    })
    return { run: workflowRunView(owner, stopped.run), changed: stopped.changed }
  }
})

/**
 * D-019: a follow-up message from the desktop, through the same checks and delivery path as dot's.
 * The idempotency key is the source request id, so a retried call returns the first outcome.
 */
export const WORKBENCH_RUN_MESSAGE_METHOD = defineMethod({
  name: 'workbench.runs.message',
  params: WorkbenchRunMessageParams,
  handler: async (params, context): Promise<RunMessageSendResult> => {
    requireWorkbenchCaller(context.workbenchCaller)
    const delivered = await requirePrimarySessionRuntime().deliverRunMessage({
      runId: params.runId,
      source: 'desktop',
      sourceRequestId: params.idempotencyKey,
      text: params.text
    })
    return RunMessageSendResultSchema.parse(delivered)
  }
})

/** Not registered here: package E1 adds them to the registry and the caller-boundary test. */
export const WORKBENCH_RUN_METHODS = [
  WORKBENCH_RUN_LIST_METHOD,
  WORKBENCH_RUN_SHOW_METHOD,
  WORKBENCH_RUN_STOP_METHOD,
  WORKBENCH_RUN_MESSAGE_METHOD
]
