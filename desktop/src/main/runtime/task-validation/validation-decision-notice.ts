import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import type { ValidationDecisionChoice } from '../../../shared/rpc-contract/workbench-validation-decision-params'
import {
  ATTEMPT_NOTICE_BODY_MAX_CHARS,
  type AttemptNotice
} from '../orchestration/db/app-attempt-input'
import type { TASK_VALIDATION_WAIVERS } from '../orchestration/db/autopilot-task-schema-definition'
import type { AttemptPlacement } from '../task-execution/attempt-workspace'
import {
  PROCESS_MAY_STILL_RUN,
  attemptWorkspaceNotice,
  type WorktreeChangeFacts
} from '../task-execution/task-result-notice'

// The mailbox notice for a decision on an inconclusive validation. Fixed English templates only, so
// no worker or reviewer text reaches the primary; who decided changes the opening words, nothing else.

export type ValidationDecider = (typeof TASK_VALIDATION_WAIVERS)[number]

const DECIDER_WORDS: Readonly<Record<ValidationDecider, string>> = {
  desktop_user: 'by the user',
  dot: 'from dot'
}

const OUTCOMES = {
  waive: { past: 'waived', task: 'completed', workspace: 'waived' },
  reject: { past: 'rejected', task: 'failed', workspace: 'rejected' }
} as const

export type DecisionNoticeInput = {
  readonly taskId: string
  readonly dispatchId: string
  readonly decision: ValidationDecisionChoice
  readonly by: ValidationDecider
  /** From the attempt's launch evidence; null for an in-session attempt or one recorded before D-025. */
  readonly placement: AttemptPlacement | null
  /** What git showed in the attempt's own worktree for a waive; absent, no git fact is stated. */
  readonly changes?: WorktreeChangeFacts
  /** A process of the attempt may still run, so the notice says to wait instead of merging. */
  readonly processMayRun?: boolean
}

/** The task's one-line result, kept on the Orca task: "Validation waived by the user." */
export function decisionResultSummary(
  decision: ValidationDecisionChoice,
  by: ValidationDecider
): string {
  return `Validation ${OUTCOMES[decision].past} ${DECIDER_WORDS[by]}.`
}

function isNoticeBody(body: string): boolean {
  return body.length <= ATTEMPT_NOTICE_BODY_MAX_CHARS && !hasSecretLikeText(body)
}

/** The notice for the primary: the decision, then the D-025 workspace rule for a task that wrote. */
export function buildDecisionNotice(input: DecisionNoticeInput): AttemptNotice {
  const outcome = OUTCOMES[input.decision]
  const opening = `The inconclusive validation of task \`${input.taskId}\` was ${outcome.past} ${DECIDER_WORDS[input.by]}, so the task is ${outcome.task}.`
  const workspace = attemptWorkspaceNotice({
    placement: input.placement,
    verdict: outcome.workspace,
    dispatchId: input.dispatchId,
    changes: input.changes,
    processMayRun: input.processMayRun
  })
  const body = workspace === null ? opening : `${opening} ${workspace}`
  // Why the warning survives: it is fixed text, and the primary must not merge while a process may write.
  const fallback =
    input.processMayRun && workspace !== null ? `${opening} ${PROCESS_MAY_STILL_RUN}` : opening
  return {
    subject: `Validation ${outcome.past} for task ${input.taskId}`,
    // Why the fallback: the store refuses a notice with a secret shape, and the decision must still land.
    body: isNoticeBody(body) ? body : fallback
  }
}
