import { RUN_COMPLETE_METHOD } from './run-complete-methods'
import { TASK_PROPOSE_METHOD } from './task-propose-methods'
import { TASK_REPORT_METHOD } from './task-report-methods'
import { TASK_SHOW_METHOD } from './task-show-methods'
import { TASK_START_METHOD } from './task-start-methods'

/**
 * The primary session's task API (D-016). Every method accepts only the attested primary of an app
 * run. Not registered here: package E1 adds them to the shared registry and adds the four mutations
 * (all but taskShow) to ORCHESTRATION_MUTATION_METHODS.
 */
export const ORCHESTRATION_AUTOPILOT_TASK_METHODS = [
  TASK_PROPOSE_METHOD,
  TASK_START_METHOD,
  TASK_SHOW_METHOD,
  TASK_REPORT_METHOD,
  RUN_COMPLETE_METHOD
]

/** The methods that change state; each needs a durable mutation receipt. */
export const ORCHESTRATION_AUTOPILOT_MUTATION_METHOD_NAMES = [
  TASK_PROPOSE_METHOD.name,
  TASK_START_METHOD.name,
  TASK_REPORT_METHOD.name,
  RUN_COMPLETE_METHOD.name
] as const

export {
  AUTOPILOT_TASK_API_ERROR_CODES,
  registerAutopilotTaskApi,
  type AutopilotTaskApiPorts
} from './autopilot-task-api'
