import { CircleStop, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import IdentifierText from './IdentifierText'
import { canMessageRun, isRunEnded, type WorkbenchRuns } from './use-workbench-runs'
import WorkbenchRunActionError from './WorkbenchRunActionError'
import WorkbenchRunMessage from './WorkbenchRunMessage'
import WorkbenchRunTasks from './WorkbenchRunTasks'
import WorkbenchStateChip from './WorkbenchStateChip'
import {
  liveActivityLabel,
  primarySessionLabel,
  runAccessLabel,
  runEndReasonLabel,
  runOriginLabel,
  runStatusChip
} from './workbench-run-copy'
import { formatWorkbenchRequestTime } from './workbench-request-time'
import { findRunTerminalTabId, showRunTerminal } from './workbench-run-terminal'

function RunSummary({ run }: { run: WorkflowRunView }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <WorkbenchStateChip status={run.status} {...runStatusChip(run.status)} />
      <span>{runOriginLabel(run.origin)}</span>
      <time className="tabular-nums" dateTime={run.createdAt}>
        {formatWorkbenchRequestTime(run.createdAt)}
      </time>
    </div>
  )
}

function SessionField({
  run,
  liveUnread
}: {
  run: WorkflowRunView
  liveUnread: boolean
}): React.JSX.Element {
  const state = primarySessionLabel(run.primary)
  const live = liveUnread
    ? translate('workbench.runs.live.unread', 'Activity could not be read')
    : liveActivityLabel(run.primary?.live ?? null)
  return (
    <div className="flex flex-wrap gap-x-1">
      <dt>{translate('workbench.runs.sessionLabel', 'Session')}</dt>
      <dd className="flex flex-wrap gap-x-1">
        <span className="text-foreground">{state}</span>
        {live && live !== state && (
          <>
            <span aria-hidden="true">·</span>
            <span>{live}</span>
          </>
        )}
      </dd>
    </div>
  )
}

function RunDetails({
  run,
  liveUnread
}: {
  run: WorkflowRunView
  liveUnread: boolean
}): React.JSX.Element {
  return (
    <dl className="space-y-0.5 text-xs text-muted-foreground">
      <div className="flex min-w-0 gap-1">
        <dt className="shrink-0">{translate('workbench.runs.id', 'Run ID')}</dt>
        <dd className="min-w-0 break-words font-mono text-foreground">
          <IdentifierText value={run.runId} />
        </dd>
      </div>
      <SessionField run={run} liveUnread={liveUnread} />
      <div className="flex flex-wrap gap-x-1">
        <dt>{translate('workbench.runs.model', 'Model')}</dt>
        <dd className="break-words font-mono text-foreground">{run.coordinator.model}</dd>
        <dd>
          {translate('workbench.runs.effort', '{{effort}} effort', {
            effort: run.coordinator.effort
          })}
        </dd>
      </div>
      <div className="flex flex-wrap gap-x-1">
        <dt>{translate('workbench.runs.accessLabel', 'Access')}</dt>
        <dd className="text-foreground">{runAccessLabel(run.requestedAccess)}</dd>
      </div>
      {run.endReason && (
        <div className="flex flex-wrap gap-x-1">
          <dt>{translate('workbench.runs.ended', 'Ended')}</dt>
          <dd className="text-foreground">{runEndReasonLabel(run.endReason)}</dd>
        </div>
      )}
    </dl>
  )
}

function RunActions({
  run,
  busy,
  stop
}: {
  run: WorkflowRunView
  busy: boolean
  stop: WorkbenchRuns['stop']
}): React.JSX.Element | null {
  const paneKey = run.primary?.paneKey ?? null
  const tabId = useAppStore((state) =>
    findRunTerminalTabId(state.tabsByWorktree, run.workspaceId, paneKey)
  )
  const ended = isRunEnded(run)
  if (ended && !tabId) {
    return null
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabId && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label={translate('workbench.runs.showTerminalLabel', 'Show terminal for {{runId}}', {
            runId: run.runId
          })}
          onClick={() => showRunTerminal(tabId)}
        >
          <SquareTerminal />
          {translate('workbench.runs.showTerminal', 'Show terminal')}
        </Button>
      )}
      {!tabId && paneKey && (
        <p className="text-xs text-muted-foreground">
          {translate(
            'workbench.runs.terminalNotOpen',
            'The terminal tab is not open in this window.'
          )}
        </p>
      )}
      {!ended && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          aria-label={translate('workbench.runs.stopLabel', 'Stop run {{runId}}', {
            runId: run.runId
          })}
          onClick={() => void stop(run.runId)}
        >
          <CircleStop />
          {translate('workbench.runs.stop', 'Stop run')}
        </Button>
      )}
    </div>
  )
}

export default function WorkbenchRunRow({
  run,
  runs
}: {
  run: WorkflowRunView
  runs: Pick<WorkbenchRuns, 'pending' | 'actionErrors' | 'liveUnread' | 'stop' | 'sendMessage'>
}): React.JSX.Element {
  const error = runs.actionErrors.get(run.runId)
  return (
    <li className="space-y-2 border-t border-border pt-3">
      <RunSummary run={run} />
      <p className="whitespace-pre-wrap break-words text-[13px]">
        {run.objective ??
          translate('workbench.runs.objectiveUnavailable', 'The objective is no longer stored.')}
      </p>
      <RunDetails run={run} liveUnread={runs.liveUnread.has(run.runId)} />
      <WorkbenchRunTasks run={run} />
      {error && <WorkbenchRunActionError error={error} />}
      <RunActions run={run} busy={runs.pending.has(run.runId)} stop={runs.stop} />
      {canMessageRun(run) && (
        <WorkbenchRunMessage runId={run.runId} sendMessage={runs.sendMessage} />
      )}
    </li>
  )
}
