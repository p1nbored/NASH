import { getAppEnvironment } from '../../../../shared/app-environment'
import {
  WorkbenchAttemptTranscriptReadParams,
  WorkbenchRunTasksParams,
  type WorkbenchAttemptTranscriptReadResult,
  type WorkbenchRunTasksResult
} from '../../../../shared/rpc-contract/workbench-task-window-params'
import { requireWorkbenchCaller } from '../../workbench-caller'
import { readAttemptTranscript } from '../../workbench-task-window/attempt-transcript-read'
import { readRunTasks } from '../../workbench-task-window/run-tasks-read'
import { defineMethod, type RpcContext } from '../core'

/** The trusted desktop caller only; the data folder is read after that check, never from the wire. */
function desktopReader(context: RpcContext) {
  requireWorkbenchCaller(context.workbenchCaller)
  return {
    owner: context.runtime.getOrchestrationDb({ passive: true }),
    userDataPath: getAppEnvironment().getPath('userData')
  }
}

/** D-024: a run's tasks and each attempt's state, for the Workbench task list. */
export const WORKBENCH_RUN_TASKS_METHOD = defineMethod({
  name: 'workbench.runs.tasks',
  params: WorkbenchRunTasksParams,
  handler: (params, context): Promise<WorkbenchRunTasksResult> =>
    readRunTasks(desktopReader(context), params.runId)
})

/** D-024: one chunk of a Codex or agy attempt's transcript; the window polls it while live. */
export const WORKBENCH_ATTEMPT_TRANSCRIPT_READ_METHOD = defineMethod({
  name: 'workbench.attempts.transcript.read',
  params: WorkbenchAttemptTranscriptReadParams,
  handler: (params, context): Promise<WorkbenchAttemptTranscriptReadResult> =>
    readAttemptTranscript(desktopReader(context), params)
})

export const WORKBENCH_TASK_WINDOW_METHODS = [
  WORKBENCH_RUN_TASKS_METHOD,
  WORKBENCH_ATTEMPT_TRANSCRIPT_READ_METHOD
]
