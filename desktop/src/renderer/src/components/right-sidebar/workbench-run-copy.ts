import { translate } from '@/i18n/i18n'
import type {
  PrimarySessionLiveView,
  PrimarySessionView,
  WorkflowRunView
} from '../../../../shared/workflow-run/workflow-run-view'
import type { WorkbenchChipCopy } from './WorkbenchStateChip'

const unverifiable = (): string =>
  translate('workbench.runs.status.unverifiable', 'Cannot be verified')

export function runStatusChip(status: WorkflowRunView['status']): WorkbenchChipCopy {
  switch (status) {
    case 'launching':
      return { kind: 'progress', label: translate('workbench.runs.status.launching', 'Launching') }
    case 'active':
      return { kind: 'running', label: translate('workbench.runs.status.active', 'Active') }
    case 'completing':
      return {
        kind: 'progress',
        label: translate('workbench.runs.status.completing', 'Completing')
      }
    case 'completed':
      return { kind: 'done', label: translate('workbench.runs.status.completed', 'Completed') }
    case 'failed':
      return { kind: 'failed', label: translate('workbench.runs.status.failed', 'Failed') }
    case 'canceled':
      return { kind: 'ended', label: translate('workbench.runs.status.canceled', 'Canceled') }
    case 'unverifiable':
      return { kind: 'disconnected', label: unverifiable() }
  }
}

type LiveActivity = Extract<PrimarySessionLiveView, { kind: 'live' }>['activity']

function activityChip(activity: LiveActivity): WorkbenchChipCopy {
  switch (activity) {
    case 'working':
      return { kind: 'running', label: translate('workbench.runs.state.working', 'Working') }
    case 'dialog_open':
      return {
        kind: 'permission',
        label: translate('workbench.runs.state.dialogOpen', 'Needs an answer')
      }
    case 'idle':
      return { kind: 'waiting', label: translate('workbench.runs.live.idle', 'Waiting for input') }
    case 'unknown':
      return {
        kind: 'unknown',
        label: translate('workbench.runs.live.unknown', 'Activity unknown')
      }
  }
}

function liveChip(live: PrimarySessionLiveView): WorkbenchChipCopy {
  switch (live.kind) {
    case 'live':
      return activityChip(live.activity)
    case 'agent_absent':
      return {
        kind: 'disconnected',
        label: translate('workbench.runs.state.agentAbsent', 'Not running')
      }
    case 'unverifiable':
      return { kind: 'disconnected', label: unverifiable() }
    case 'starting':
      return { kind: 'progress', label: translate('workbench.runs.session.starting', 'Starting') }
    case 'ended':
      return {
        kind: 'ended',
        label:
          live.state === 'stopped'
            ? translate('workbench.runs.session.stopped', 'Stopped')
            : translate('workbench.runs.session.exited', 'Exited')
      }
  }
}

/** An active run shows what its session is doing now; any other run shows its own status. */
export function runStateChip(run: WorkflowRunView, liveUnread: boolean): WorkbenchChipCopy {
  if (run.status !== 'active') {
    return runStatusChip(run.status)
  }
  if (liveUnread) {
    return { kind: 'disconnected', label: unverifiable() }
  }
  const live = run.primary?.live ?? null
  return live ? liveChip(live) : runStatusChip(run.status)
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
      return unverifiable()
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

const QUIET_SESSION_STATES: ReadonlySet<string> = new Set(['starting', 'running'])

/**
 * The one line that explains a run's chip when it needs explaining: a dialog, a lost or absent
 * terminal, or a session that is not running while the run is still open. Null otherwise.
 */
export function runSessionNote(run: WorkflowRunView, liveUnread: boolean): string | null {
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'canceled') {
    return null
  }
  if (liveUnread) {
    return translate('workbench.runs.live.unread', 'Activity could not be read')
  }
  const live = run.primary?.live ?? null
  if (live && live.kind !== 'live' && live.kind !== 'starting') {
    return liveActivityLabel(live)
  }
  if (live?.kind === 'live' && live.activity === 'dialog_open') {
    return liveActivityLabel(live)
  }
  if (run.primary && QUIET_SESSION_STATES.has(run.primary.state)) {
    return null
  }
  return translate('workbench.runs.sessionNote', 'Session: {{state}}', {
    state: primarySessionLabel(run.primary)
  })
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

/** Known end reasons in words; an unknown code is left to "Copy details" rather than shown. */
export function runEndReasonLabel(code: string): string | null {
  return END_REASONS.get(code)?.() ?? null
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
