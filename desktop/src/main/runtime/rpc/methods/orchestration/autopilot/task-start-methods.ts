import { TaskStartParams } from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import type { TaskStartResult } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { defineMethod } from '../../../core'
import { resolveDispatchCreator } from '../runs/dispatch-creator'
import { resolveAutopilotPrimaryCaller } from './autopilot-primary-caller'
import { errorCodeOf, requireAutopilotTaskApi } from './autopilot-task-api'
import { requireTaskOfRun } from './autopilot-task-snapshot'

/**
 * `task-start` (U19): the attested primary starts the next attempt of one of its tasks. The execution
 * service re-checks the route, opens Orca's attempt with this caller as creator (and the request's
 * durable receipt), and derives any retry itself. Only its plain view is returned.
 */
export const TASK_START_METHOD = defineMethod({
  name: 'orchestration.taskStart',
  params: TaskStartParams,
  handler: async (params, context): Promise<TaskStartResult> => {
    const api = requireAutopilotTaskApi(context.runtime)
    const caller = resolveAutopilotPrimaryCaller(context.runtime, context, {
      requireActiveRun: true
    })
    requireTaskOfRun(context.runtime.getOrchestrationDb(), params.taskId, caller.runId)
    const start = await api.startTask({
      taskId: params.taskId,
      creator: resolveDispatchCreator(context.runtime, caller.terminalHandle, undefined),
      maxDepth: context.runtime.getNestedWorkerMaxDepth(),
      runtimeEpoch: context.runtime.getRuntimeId(),
      mutationReceipt: context.orchestrationMutation
    })
    const { view } = start
    // Why: a process attempt settles long after this reply; its outcome reaches the run mailbox.
    void start.settled.catch((error: unknown) => {
      api.log({
        event: 'attempt_settle_rejected',
        taskId: view.taskId,
        dispatchId: view.dispatchId,
        code: errorCodeOf(error)
      })
    })
    return { attempt: { ...view } }
  }
})
