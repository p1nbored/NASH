import {
  WorkbenchRunTasksParams,
  type WorkbenchRunTasksResult
} from '../../../../shared/rpc-contract/workbench-task-window-params'
import { requireWorkbenchCaller } from '../../workbench-caller'
import { readRunTasks } from '../../workbench-task-window/run-tasks-read'
import { defineMethod, type RpcContext } from '../core'

/** Native session references are available only to the trusted desktop caller. */
function desktopReader(context: RpcContext) {
  requireWorkbenchCaller(context.workbenchCaller)
  return {
    owner: context.runtime.getOrchestrationDb({ passive: true })
  }
}

/** D-024: a run's tasks and each attempt's state, for the Workbench task list. */
export const WORKBENCH_RUN_TASKS_METHOD = defineMethod({
  name: 'workbench.runs.tasks',
  params: WorkbenchRunTasksParams,
  handler: (params, context): Promise<WorkbenchRunTasksResult> =>
    readRunTasks(desktopReader(context), params.runId)
})

export const WORKBENCH_TASK_WINDOW_METHODS = [WORKBENCH_RUN_TASKS_METHOD]
