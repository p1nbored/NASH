import { translate } from '@/i18n/i18n'
import type {
  WorkbenchPermissionAnswerResult,
  WorkbenchPermissionDecisionView
} from '../../../../shared/rpc-contract/permission-relay-params'
import type { WorkbenchChipCopy } from './workbench-run-copy'

type Decider = NonNullable<WorkbenchPermissionDecisionView['decidedBy']>

function byDecider(decidedBy: Decider | null): string {
  switch (decidedBy) {
    case 'dot':
      return translate('workbench.permissions.decider.dot', 'by dot')
    case 'desktop':
      return translate('workbench.permissions.decider.desktop', 'in the app')
    case 'terminal':
    case null:
      return translate('workbench.permissions.decider.terminal', 'in the terminal')
  }
}

export function permissionStatusChip(view: WorkbenchPermissionDecisionView): WorkbenchChipCopy {
  switch (view.status) {
    case 'pending':
      return view.answerable
        ? {
            label: translate('workbench.permissions.status.waiting', 'Waiting for an answer'),
            tone: 'warning'
          }
        : {
            label: translate('workbench.permissions.status.terminalOnly', 'Answer in the terminal'),
            tone: 'warning'
          }
    case 'allowed':
      return { label: translate('workbench.permissions.status.allowed', 'Allowed'), tone: 'muted' }
    case 'denied':
      return { label: translate('workbench.permissions.status.denied', 'Denied'), tone: 'muted' }
    case 'expired':
      return { label: translate('workbench.permissions.status.expired', 'Expired'), tone: 'muted' }
    case 'answered_in_terminal':
      return {
        label: translate(
          'workbench.permissions.status.answeredInTerminal',
          'Answered in the terminal'
        ),
        tone: 'muted'
      }
  }
}

function settledText(view: WorkbenchPermissionDecisionView): string {
  switch (view.status) {
    case 'allowed':
      return translate('workbench.permissions.settled.allowed', 'allowed {{decider}}', {
        decider: byDecider(view.decidedBy)
      })
    case 'denied':
      return translate('workbench.permissions.settled.denied', 'denied {{decider}}', {
        decider: byDecider(view.decidedBy)
      })
    case 'expired':
      return translate('workbench.permissions.settled.expired', 'the prompt expired')
    case 'answered_in_terminal':
    case 'pending':
      return translate('workbench.permissions.settled.terminal', 'answered in the terminal')
  }
}

/** The result of the user's own Allow or Deny, in words (D-016 permission relay outcomes). */
export function describeAnswerResult(result: WorkbenchPermissionAnswerResult): string {
  switch (result.outcome) {
    case 'decided':
      return result.decision?.status === 'denied'
        ? translate('workbench.permissions.answer.denied', 'Denied in the app.')
        : translate('workbench.permissions.answer.allowed', 'Allowed in the app.')
    case 'already_decided':
      return result.decision
        ? translate(
            'workbench.permissions.answer.alreadyDecided',
            'Already answered: {{settled}}.',
            {
              settled: settledText(result.decision)
            }
          )
        : translate('workbench.permissions.answer.alreadyAnswered', 'Already answered.')
    case 'closed':
      return `${terminalOnlyText()} ${translate(
        'workbench.permissions.answer.closed',
        'The app can no longer answer this prompt.'
      )}`
    case 'not_found':
      return translate(
        'workbench.permissions.answer.notFound',
        'This prompt is no longer available.'
      )
  }
}

export function terminalOnlyText(): string {
  return translate('workbench.permissions.terminalOnly', 'Answer it in the terminal.')
}
