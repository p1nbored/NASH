import type { ValidationDecisionChoice } from '../../../shared/rpc-contract/workbench-validation-decision-params'
import type { AttemptNotice } from '../orchestration/db/app-attempt-input'
import type { TASK_VALIDATION_WAIVERS } from '../orchestration/db/autopilot-task-schema-definition'

// Fixed English templates keep worker and reviewer text out of the primary's decision notice.
export type ValidationDecider = (typeof TASK_VALIDATION_WAIVERS)[number]

const DECIDER_WORDS: Readonly<Record<ValidationDecider, string>> = {
  desktop_user: 'by the user',
  dot: 'from dot'
}

const OUTCOMES = {
  waive: { past: 'waived', task: 'completed' },
  reject: { past: 'rejected', task: 'failed' }
} as const

export type DecisionNoticeInput = {
  readonly taskId: string
  readonly decision: ValidationDecisionChoice
  readonly by: ValidationDecider
}

/** The task's one-line result, kept on the Orca task: "Validation waived by the user." */
export function decisionResultSummary(
  decision: ValidationDecisionChoice,
  by: ValidationDecider
): string {
  return `Validation ${OUTCOMES[decision].past} ${DECIDER_WORDS[by]}.`
}

export function buildDecisionNotice(input: DecisionNoticeInput): AttemptNotice {
  const outcome = OUTCOMES[input.decision]
  return {
    subject: `Validation ${outcome.past} for task ${input.taskId}`,
    body: `The inconclusive validation of task \`${input.taskId}\` was ${outcome.past} ${DECIDER_WORDS[input.by]}, so the task is ${outcome.task}.`
  }
}
