import { translate } from '@/i18n/i18n'
import type {
  ValidationDecisionChoice,
  WorkbenchValidationDecideResult,
  WorkbenchValidationDecisionView
} from '../../../../shared/rpc-contract/workbench-validation-decision-params'
import { taskExecutorLabel } from '../task-window/task-window-copy'

// Why string inputs: the host may name a placement or executor this build does not know yet.

/** `Codex · gpt-6.1-sol`, or the executor alone when the route names no model. */
export function decisionExecutorText(view: WorkbenchValidationDecisionView): string {
  const executor = taskExecutorLabel(view.executorKind)
  return view.model ? `${executor} · ${view.model}` : executor
}

export function decisionPlacementLabel(placement: string): string {
  switch (placement) {
    case 'own_worktree':
      return translate('workbench.decisions.placement.ownWorktree', 'Its own worktree')
    case 'folder':
      return translate('workbench.decisions.placement.folder', 'The workspace folder')
    case 'run_workspace':
      return translate('workbench.decisions.placement.runWorkspace', 'The run workspace, read only')
    case 'in_session':
      return translate('workbench.decisions.placement.inSession', 'The main Claude session')
    default:
      return translate('workbench.decisions.placement.unrecorded', 'Not recorded')
  }
}

function waiveConfirmText(view: WorkbenchValidationDecisionView): string {
  // Why first: while a process may still write, the primary is told to wait, never to merge.
  if (view.processMayRun) {
    return translate(
      'workbench.decisions.confirm.waiveProcessMayRun',
      'Accept this result as done? The task completes, but a process of this attempt may still be running. The main Claude session is told to wait until it has ended before merging or keeping its changes.'
    )
  }
  if (view.worktree) {
    return translate(
      'workbench.decisions.confirm.waiveWorktree',
      'Accept this result as done? The task completes, and the main Claude session is told to merge branch {{branch}}.',
      { branch: view.worktree.branch }
    )
  }
  return view.placement === 'folder'
    ? translate(
        'workbench.decisions.confirm.waiveFolder',
        'Accept this result as done? The task completes; its changes are already in the workspace folder.'
      )
    : translate(
        'workbench.decisions.confirm.waive',
        'Accept this result as done? The task completes.'
      )
}

function rejectConfirmText(view: WorkbenchValidationDecisionView): string {
  if (view.worktree) {
    return translate(
      'workbench.decisions.confirm.rejectWorktree',
      'Reject this result? The task fails, and its branch is left for inspection.'
    )
  }
  return view.placement === 'folder'
    ? translate(
        'workbench.decisions.confirm.rejectFolder',
        'Reject this result? The task fails; its changes stay in the workspace folder until you decide what to keep.'
      )
    : translate('workbench.decisions.confirm.reject', 'Reject this result? The task fails.')
}

/** The short confirmation: what happens to the task and, for a writing task, to its changes. */
export function decisionConfirmText(
  view: WorkbenchValidationDecisionView,
  decision: ValidationDecisionChoice
): string {
  return decision === 'waive' ? waiveConfirmText(view) : rejectConfirmText(view)
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
