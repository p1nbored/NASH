import { translate } from '@/i18n/i18n'
import type { WorkbenchChipKind } from '../right-sidebar/WorkbenchStateChip'

// Why string inputs: the host may name an executor or state this build does not know yet.

export function taskExecutorLabel(kind: string): string {
  switch (kind) {
    case 'codex':
      return 'Codex'
    case 'agy':
      return 'agy'
    case 'claude_subagent':
      return translate('workbench.tasks.executor.claudeSubagent', 'Claude subagent')
    case 'claude_workflow':
      return translate('workbench.tasks.executor.claudeWorkflow', 'Claude workflow')
    case 'claude_primary':
      return translate('workbench.tasks.executor.claudePrimary', 'Primary session')
    default:
      return translate('workbench.tasks.executor.other', 'Other executor')
  }
}

export function attemptStateLabel(state: string | null): string {
  switch (state) {
    case null:
      return translate('workbench.tasks.state.notStarted', 'Not started')
    case 'starting':
      return translate('workbench.tasks.state.starting', 'Starting')
    case 'running':
      return translate('workbench.tasks.state.running', 'Running')
    case 'completed':
      return translate('workbench.tasks.state.completed', 'Completed')
    case 'failed':
      return translate('workbench.tasks.state.failed', 'Failed')
    case 'blocked':
      return translate('workbench.tasks.state.blocked', 'Blocked')
    case 'stopped':
      return translate('workbench.tasks.state.stopped', 'Stopped')
    case 'stop_unknown':
      return translate('workbench.tasks.state.stopUnknown', 'Stop not confirmed')
    case 'start_unknown':
      return translate('workbench.tasks.state.startUnknown', 'Start not confirmed')
    default:
      return translate('workbench.tasks.state.unknown', 'State unknown')
  }
}

const ATTEMPT_KINDS = new Map<string, WorkbenchChipKind>([
  ['starting', 'progress'],
  ['running', 'running'],
  ['completed', 'done'],
  ['failed', 'failed'],
  ['blocked', 'blocked'],
  ['stopped', 'ended'],
  // Why disconnected: NASH lost track of the process, which is not evidence that it ended.
  ['stop_unknown', 'disconnected'],
  ['start_unknown', 'disconnected']
])

/** The chip kind of an attempt state; no attempt yet is pending, and an unknown state is unknown. */
export function attemptStateKind(state: string | null): WorkbenchChipKind {
  return state === null ? 'progress' : (ATTEMPT_KINDS.get(state) ?? 'unknown')
}

/** `45s`, `2m 10s`, `1h 05m`; floored, so it never overstates the time. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return translate('workbench.tasks.elapsed.hours', '{{hours}}h {{minutes}}m', {
      hours,
      minutes: String(minutes).padStart(2, '0')
    })
  }
  if (minutes > 0) {
    return translate('workbench.tasks.elapsed.minutes', '{{minutes}}m {{seconds}}s', {
      minutes,
      seconds: String(seconds).padStart(2, '0')
    })
  }
  return translate('workbench.tasks.elapsed.seconds', '{{seconds}}s', { seconds })
}

/** Elapsed from start to settle, or to now while unsettled; null when a time is unreadable. */
export function elapsedBetween(
  startedAt: string,
  settledAt: string | null,
  now: number
): string | null {
  const start = Date.parse(startedAt)
  const end = settledAt === null ? now : Date.parse(settledAt)
  return Number.isNaN(start) || Number.isNaN(end) ? null : formatElapsed(end - start)
}
