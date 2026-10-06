import { translate } from '@/i18n/i18n'
import type {
  PrimarySessionLiveView,
  PrimarySessionView,
  WorkflowRunView
} from '../../../../shared/workflow-run/workflow-run-view'
import type { WorkbenchChipTone } from './WorkbenchStateChip'

export type WorkbenchChipCopy = { label: string; tone: WorkbenchChipTone }

export function runStatusChip(status: WorkflowRunView['status']): WorkbenchChipCopy {
  switch (status) {
    case 'launching':
      return { label: translate('workbench.runs.status.launching', 'Launching'), tone: 'neutral' }
    case 'active':
      return { label: translate('workbench.runs.status.active', 'Active'), tone: 'neutral' }
    case 'completing':
      return { label: translate('workbench.runs.status.completing', 'Completing'), tone: 'neutral' }
    case 'completed':
      return { label: translate('workbench.runs.status.completed', 'Completed'), tone: 'muted' }
    case 'failed':
      return { label: translate('workbench.runs.status.failed', 'Failed'), tone: 'warning' }
    case 'canceled':
      return { label: translate('workbench.runs.status.canceled', 'Canceled'), tone: 'muted' }
    case 'unverifiable':
      return {
        label: translate('workbench.runs.status.unverifiable', 'Cannot be verified'),
        tone: 'warning'
      }
  }
}

export function primarySessionLabel(primary: PrimarySessionView | null): string {
  switch (primary?.state) {
    case undefined:
      return translate('workbench.runs.session.none', 'Not started')
    case 'starting':
      return translate('workbench.runs.session.starting', 'Starting')
    case 'running':
      return translate('workbench.runs.session.running', 'Running')
    case 'stopping':
      return translate('workbench.runs.session.stopping', 'Stopping')
    case 'stopped':
      return translate('workbench.runs.session.stopped', 'Stopped')
    case 'exited':
      return translate('workbench.runs.session.exited', 'Exited')
    case 'unverifiable':
      return translate('workbench.runs.session.unverifiable', 'Cannot be verified')
  }
}

const LIVE_ACTIVITY = {
  working: () => translate('workbench.runs.live.working', 'Claude is working'),
  dialog_open: () =>
    translate('workbench.runs.live.dialogOpen', 'A permission or question dialog is open'),
  idle: () => translate('workbench.runs.live.idle', 'Waiting for input'),
  unknown: () => translate('workbench.runs.live.unknown', 'Activity unknown')
} as const

const LIVE_UNVERIFIABLE = {
  handle_unresolved: () =>
    translate('workbench.runs.live.handleUnresolved', 'The terminal cannot be found'),
  incarnation_mismatch: () =>
    translate(
      'workbench.runs.live.incarnationMismatch',
      'The terminal process changed, so its activity cannot be verified'
    ),
  status_unreadable: () =>
    translate('workbench.runs.live.statusUnreadable', 'The terminal status cannot be read')
} as const

/** What the primary pane shows now; null when only stored records were read. */
export function liveActivityLabel(live: PrimarySessionLiveView | null): string | null {
  switch (live?.kind) {
    case undefined:
      return null
    case 'live':
      return LIVE_ACTIVITY[live.activity]()
    case 'agent_absent':
      return translate(
        'workbench.runs.live.agentAbsent',
        'Claude Code is not running in the terminal'
      )
    case 'unverifiable':
      return LIVE_UNVERIFIABLE[live.reason]()
    case 'starting':
      return translate('workbench.runs.session.starting', 'Starting')
    case 'ended':
      return live.state === 'stopped'
        ? translate('workbench.runs.session.stopped', 'Stopped')
        : translate('workbench.runs.session.exited', 'Exited')
  }
}

const END_REASONS = new Map<string, () => string>([
  ['user_canceled', () => translate('workbench.runs.end.userCanceled', 'Stopped in the app')],
  ['dot_canceled', () => translate('workbench.runs.end.dotCanceled', 'Canceled by dot')],
  [
    'primary_exited',
    () => translate('workbench.runs.end.primaryExited', 'The Claude Code session exited')
  ],
  ['launch_refused', () => translate('workbench.runs.end.launchRefused', 'The launch was refused')],
  [
    'launch_failed_no_effects',
    () => translate('workbench.runs.end.launchFailed', 'The launch failed before anything started')
  ],
  [
    'launch_outcome_unknown',
    () => translate('workbench.runs.end.launchUnknown', 'The launch could not be confirmed')
  ],
  [
    'reconciled_after_restart',
    () =>
      translate('workbench.runs.end.reconciled', 'Settled from its records after the app restarted')
  ],
  [
    'stop_unconfirmed',
    () => translate('workbench.runs.end.stopUnconfirmed', 'The stop could not be confirmed')
  ]
])

/** Known end reasons in words; an unknown code stays literal rather than guessed at. */
export function runEndReasonLabel(code: string): string {
  return END_REASONS.get(code)?.() ?? code
}

export function runOriginLabel(origin: WorkflowRunView['origin']): string {
  switch (origin) {
    case 'dot':
      return translate('workbench.runs.origin.dot', 'Started by dot')
    case 'desktop':
      return translate('workbench.runs.origin.desktop', 'Started here')
    case 'unknown':
      return translate('workbench.runs.origin.unknown', 'Origin unknown')
  }
}

export function runAccessLabel(access: WorkflowRunView['requestedAccess']): string {
  return access === 'read_only'
    ? translate('workbench.runs.access.readOnly', 'Read only')
    : translate('workbench.runs.access.workspaceWrite', 'May write to the workspace')
}
