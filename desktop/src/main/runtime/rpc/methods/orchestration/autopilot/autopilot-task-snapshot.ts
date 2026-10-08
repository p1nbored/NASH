import type { AutopilotTaskView } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import type { OrchestrationDb } from '../../../../orchestration/db'
import { getTaskClassificationStore } from '../../../../orchestration/db/task-classification-store'
import { getTaskRouteStore } from '../../../../orchestration/db/task-route-store'
import { getTaskValidationStore } from '../../../../orchestration/db/task-validation-store'
import { isNativeTaskAttempt } from '../../../../workflow-run/app-run-policy'
import type { TaskRow } from '../../../../orchestration/types'
import {
  AUTOPILOT_TASK_API_ERROR_CODES,
  autopilotRefusal,
  type AutopilotTaskApi
} from './autopilot-task-api'
import { describeAutopilotTask, type AutopilotTaskSnapshot } from './autopilot-task-phase'

/** Orca's task of the caller's run; any other id is refused the same way, so no run is probed. */
export function requireTaskOfRun(owner: OrchestrationDb, taskId: string, runId: string): TaskRow {
  const task = owner.getTask(taskId)
  if (!task || task.run_id !== runId) {
    throw autopilotRefusal(
      AUTOPILOT_TASK_API_ERROR_CODES.taskNotInRun,
      `Task ${taskId} is not a task of this run.`
    )
  }
  return task
}

function classificationOf(
  owner: OrchestrationDb,
  taskId: string
): AutopilotTaskSnapshot['classification'] {
  const record = getTaskClassificationStore(owner).latestForTask(taskId)
  return record
    ? {
        outcome: record.outcome,
        needsDelegation: record.needsDelegation,
        taskType: record.taskType,
        detail: record.detail
      }
    : null
}

// Why no model, effort or CLI setting: the primary never chooses them, and its subagent definitions carry them.
function routeOf(owner: OrchestrationDb, taskId: string): AutopilotTaskSnapshot['route'] {
  const record = getTaskRouteStore(owner).latestForTask(taskId)
  return record ? { status: record.status, target: record.target, reasons: record.reasons } : null
}

function attemptOf(owner: OrchestrationDb, taskId: string): AutopilotTaskView['attempt'] {
  const dispatch = owner.getDispatchContext(taskId)
  const worker = dispatch ? owner.getWorkerDispatch(dispatch.id) : undefined
  if (!dispatch || !worker) {
    return null
  }
  return {
    attemptId: dispatch.id,
    runsIn: isNativeTaskAttempt(owner, dispatch.id) ? 'process' : 'session',
    ...(isNativeTaskAttempt(owner, dispatch.id) ? { nativeWorker: true as const } : {}),
    dispatchStatus: dispatch.status,
    workerState: worker.state,
    stage: worker.stage.slice(0, 64)
  }
}

function validationOf(
  owner: OrchestrationDb,
  attemptId: string | null
): AutopilotTaskView['validation'] {
  const record = attemptId ? getTaskValidationStore(owner).getForDispatch(attemptId) : null
  return record
    ? {
        verdict: record.verdict,
        policy: record.policy,
        waived: record.waiver !== null,
        checks: record.checks.map((check) => ({
          kind: check.kind,
          status: check.status,
          note: check.note ?? null
        }))
      }
    : null
}

export type TaskViewReader = {
  readonly owner: OrchestrationDb
  readonly cliCommand: string
  readonly classifying: (taskId: string) => boolean
}

export function taskViewReaderFor(api: AutopilotTaskApi, owner: OrchestrationDb): TaskViewReader {
  return {
    owner,
    cliCommand: api.cliCommand,
    classifying: (taskId) => (api.classifier()?.pending(taskId) ?? null) !== null
  }
}

/** Reads the task's Orca rows and the app's side rows into the primary's view. */
export function readAutopilotTaskView(reader: TaskViewReader, task: TaskRow): AutopilotTaskView {
  const { owner } = reader
  const attempt = attemptOf(owner, task.id)
  const snapshot: AutopilotTaskSnapshot = {
    taskId: task.id,
    runId: task.run_id,
    title: task.task_title,
    status: task.status,
    classifying: reader.classifying(task.id),
    classification: classificationOf(owner, task.id),
    route: routeOf(owner, task.id),
    attempt,
    validation: validationOf(owner, attempt?.attemptId ?? null)
  }
  return describeAutopilotTask(snapshot, reader.cliCommand)
}
