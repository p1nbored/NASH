import { TaskProposeParams } from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import type { TaskProposeResult } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { getTaskSpecStore } from '../../../../orchestration/db/task-spec-store'
import { defineMethod } from '../../../core'
import { resolveAutopilotPrimaryCaller } from './autopilot-primary-caller'
import {
  AUTOPILOT_TASK_API_ERROR_CODES,
  autopilotRefusal,
  errorCodeOf,
  requireAutopilotTaskApi,
  type AutopilotTaskApi
} from './autopilot-task-api'
import {
  readAutopilotTaskView,
  requireTaskOfRun,
  taskViewReaderFor
} from './autopilot-task-snapshot'
import { toTaskProposal } from './autopilot-task-spec-checks'

function requireClassifier(api: AutopilotTaskApi) {
  const classifier = api.classifier()
  if (!classifier) {
    throw autopilotRefusal(
      AUTOPILOT_TASK_API_ERROR_CODES.unavailable,
      'Clef classification is not running, so no task can be proposed.'
    )
  }
  return classifier
}

/**
 * `task-propose`: the attested primary proposes one TaskSpec. Orca's task and the TaskSpec are written
 * together, then Clef classifies it off this call; the reply says what the task waits for.
 */
export const TASK_PROPOSE_METHOD = defineMethod({
  name: 'orchestration.taskPropose',
  params: TaskProposeParams,
  handler: (params, context): TaskProposeResult => {
    const api = requireAutopilotTaskApi(context.runtime)
    const caller = resolveAutopilotPrimaryCaller(context.runtime, context, {
      requireActiveRun: true
    })
    const classifier = requireClassifier(api)
    const owner = context.runtime.getOrchestrationDb()
    const proposal = toTaskProposal(params.spec, caller, new Date(api.now()).toISOString())
    const { taskId } = getTaskSpecStore(owner).propose(proposal)
    try {
      classifier.classify(taskId)
    } catch (error) {
      api.log({ event: 'classify_failed', runId: caller.runId, taskId, code: errorCodeOf(error) })
    }
    const task = requireTaskOfRun(owner, taskId, caller.runId)
    return { task: readAutopilotTaskView(taskViewReaderFor(api, owner), task) }
  }
})
