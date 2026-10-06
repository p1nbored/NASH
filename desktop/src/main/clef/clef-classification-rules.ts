import {
  NEEDS_CLARIFICATION_OPTION_ID,
  type ValidatedClefAnswers
} from '../../shared/clef/clef-answers'
import type { ClassificationResult } from '../../shared/clef/clef-classification-contract'
import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import {
  COORDINATOR_TASK_TYPE,
  ROUTING_TASK_TYPES,
  type RoutingTaskType
} from '../../shared/routing-table/routing-table-taxonomy'
import { CLEF_DECISION_THRESHOLDS, type ClefDecisionThresholds } from './clef-question-set'

/** The response validator's verdict; its blocker carries the specific failure detail. */
export type ClassificationValidation =
  | { readonly ok: true; readonly answers: ValidatedClefAnswers }
  | { readonly ok: false; readonly blocker: RouteBlocker }

export type ClassificationDecision =
  | { readonly outcome: 'classified'; readonly result: ClassificationResult }
  | { readonly outcome: 'blocked' | 'invalid_output'; readonly blocker: RouteBlocker }

const NEEDS_CLARIFICATION: RouteBlocker = {
  reason: 'missing_inputs',
  detail: 'needs_clarification'
}
const LOW_MARGIN: RouteBlocker = { reason: 'ambiguous', detail: 'low_margin' }
const INCONSISTENT_DELEGATION: RouteBlocker = {
  reason: 'ambiguous',
  detail: 'inconsistent_delegation'
}
const OUTSIDE_LEGAL_SET: RouteBlocker = {
  reason: 'invalid_output',
  detail: 'choice_outside_legal_set'
}

// Why: binary subtraction puts 0.6 - 0.5 just under 0.10, and the thresholds are decimal values.
const THRESHOLD_TOLERANCE = 1e-9

function blocked(blocker: RouteBlocker): ClassificationDecision {
  return { outcome: blocker.reason === 'invalid_output' ? 'invalid_output' : 'blocked', blocker }
}

function isRoutingTaskType(value: string): value is RoutingTaskType {
  return ROUTING_TASK_TYPES.some((taskType) => taskType === value)
}

function taskTypeMarginTooLow(
  probabilities: Readonly<Record<string, number>>,
  thresholds: ClefDecisionThresholds
): boolean {
  const [top = 0, second = 0] = Object.values(probabilities).toSorted((left, right) => right - left)
  return top === second || top - second < thresholds.taskTypeMarginMin - THRESHOLD_TOLERANCE
}

/** True, false, or null when the probability sits inside the ambiguous band. */
function readNeedsDelegation(value: number, thresholds: ClefDecisionThresholds): boolean | null {
  if (value >= thresholds.delegationTrueMin - THRESHOLD_TOLERANCE) {
    return true
  }
  return value <= thresholds.delegationFalseMax + THRESHOLD_TOLERANCE ? false : null
}

/**
 * Classification outcome rules (design 1.3): reject-only, in pinned order, never re-ranking.
 * Clef places a TaskSpec; with delegation false the primary session executes it with its own
 * configuration, and with true the Routing Table looks the type up. Provider confidence is never read.
 */
export function decideClassification(
  validation: ClassificationValidation,
  thresholds: ClefDecisionThresholds = CLEF_DECISION_THRESHOLDS
): ClassificationDecision {
  if (!validation.ok) {
    return blocked(validation.blocker)
  }
  const { taskType, needsDelegation } = validation.answers
  const { choice } = taskType
  if (choice === NEEDS_CLARIFICATION_OPTION_ID) {
    return blocked(NEEDS_CLARIFICATION)
  }
  if (!isRoutingTaskType(choice)) {
    return blocked(OUTSIDE_LEGAL_SET)
  }
  if (taskTypeMarginTooLow(taskType.probabilities, thresholds)) {
    return blocked(LOW_MARGIN)
  }
  const delegation = readNeedsDelegation(needsDelegation.value, thresholds)
  if (delegation === null) {
    return blocked(LOW_MARGIN)
  }
  if (delegation && choice === COORDINATOR_TASK_TYPE) {
    return blocked(INCONSISTENT_DELEGATION)
  }
  return { outcome: 'classified', result: { needsDelegation: delegation, taskType: choice } }
}
