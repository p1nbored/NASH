import { translate } from '@/i18n/i18n'
import type {
  ValidationDecisionChoice,
  WorkbenchValidationDecideResult,
  WorkbenchValidationDecisionView
} from '../../../../shared/rpc-contract/workbench-validation-decision-params'
import { taskExecutorLabel } from '../task-window/task-window-copy'

/** `Codex · gpt-6.1-sol`, or the executor alone when the route names no model. */
export function decisionExecutorText(view: WorkbenchValidationDecisionView): string {
  const executor = taskExecutorLabel(view.executorKind)
  return view.model ? `${executor} · ${view.model}` : executor
}

/** The short confirmation describes the task outcome. */
export function decisionConfirmText(decision: ValidationDecisionChoice): string {
  return decision === 'waive'
    ? translate(
        'workbench.decisions.confirm.waive',
        'Accept this result as done? The task completes.'
      )
    : translate('workbench.decisions.confirm.reject', 'Reject this result? The task fails.')
}

/** Only what the reply confirms: the decision, and whether a notice was filed for the primary. */
export function decisionOutcomeText(result: WorkbenchValidationDecideResult): string {
  if (result.decision === 'waived') {
    return result.noticeFiled
      ? translate(
          'workbench.decisions.outcome.waivedNotified',
          'Waived. The task is completed, and a notice was filed for the main Claude session.'
        )
      : translate('workbench.decisions.outcome.waived', 'Waived. The task is completed.')
  }
  return result.noticeFiled
    ? translate(
        'workbench.decisions.outcome.rejectedNotified',
        'Rejected. The task is marked failed, and a notice was filed for the main Claude session.'
      )
    : translate('workbench.decisions.outcome.rejected', 'Rejected. The task is marked failed.')
}
