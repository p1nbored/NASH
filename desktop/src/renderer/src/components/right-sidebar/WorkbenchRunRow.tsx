import { CircleStop, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import { canMessageRun, isRunEnded, type WorkbenchRuns } from './use-workbench-runs'
import WorkbenchCopyDetails from './WorkbenchCopyDetails'
import WorkbenchRunActionError from './WorkbenchRunActionError'
import WorkbenchRunMessage from './WorkbenchRunMessage'
import WorkbenchRunTasks from './WorkbenchRunTasks'
import WorkbenchStateChip from './WorkbenchStateChip'
import {
  runAccessLabel,
  runEndReasonLabel,
  runOriginLabel,
  runSessionNote,
  runStateChip
} from './workbench-run-copy'
import { runDetails } from './workbench-run-details'
import { formatWorkbenchRequestTime } from './workbench-request-time'
import { findRunTerminalTabId, showRunTerminal } from './workbench-run-terminal'

function Separator(): React.JSX.Element {
  return <span aria-hidden="true">·</span>
}

/** Execution surface, then model and effort, then what the run may do. */
function RunIdentity({ run }: { run: WorkflowRunView }): React.JSX.Element {
  return (
    <p className="flex flex-wrap gap-x-1 text-meta text-muted-foreground">
      {/* Why not localized: the CLI's product name. */}
      <span>Claude Code</span>
      <Separator />
      <span className="break-words font-mono text-foreground">{run.coordinator.model}</span>
      <Separator />
      <span>
        {translate('workbench.runs.effort', '{{effort}} effort', {
          effort: run.coordinator.effort
        })}
      </span>
      <Separator />
      <span>{runAccessLabel(run.requestedAccess)}</span>
    </p>
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
      {!ended && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => void stop(run.runId)}
        >
          <CircleStop />
          {translate('workbench.runs.stop', 'Stop run')}
        </Button>
      )}
      {tabId && (
        <Button type="button" variant="ghost" size="xs" onClick={() => showRunTerminal(tabId)}>
          <SquareTerminal />
          {translate('workbench.runs.showTerminal', 'Show terminal')}
        </Button>
      )}
      {!tabId && paneKey && (
        <p className="text-meta text-muted-foreground">
          {translate(
            'workbench.runs.terminalNotOpen',
            'The terminal tab is not open in this window.'
          )}
        </p>
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
  const error = runs.actionErrors.get(run.runId) ?? null
  const liveUnread = runs.liveUnread.has(run.runId)
  const note = runSessionNote(run, liveUnread)
  const ended = run.endReason ? runEndReasonLabel(run.endReason) : null
  return (
    <li className="space-y-1.5 py-2 first:pt-0">
      <div className="flex min-w-0 items-center gap-2">
        <WorkbenchStateChip {...runStateChip(run, liveUnread)} />
        <p className="flex min-w-0 flex-1 flex-wrap gap-x-1 text-meta text-muted-foreground">
          <span>{runOriginLabel(run.origin)}</span>
          <Separator />
          <time className="tabular-nums" dateTime={run.createdAt}>
            {formatWorkbenchRequestTime(run.createdAt)}
          </time>
        </p>
        <WorkbenchCopyDetails
          subject="run"
          entries={runDetails(run, { liveUnread, stopError: error })}
        />
      </div>
      <p className="whitespace-pre-wrap break-words text-body">
        {run.objective ??
          translate('workbench.runs.objectiveUnavailable', 'The objective is no longer stored.')}
      </p>
      <RunIdentity run={run} />
      {note && <p className="text-meta text-muted-foreground">{note}</p>}
      {ended && (
        <dl className="flex flex-wrap gap-x-1 text-meta text-muted-foreground">
          <dt>{translate('workbench.runs.ended', 'Ended')}</dt>
          <dd className="text-foreground">{ended}</dd>
        </dl>
      )}
      <WorkbenchRunTasks run={run} />
      {error && <WorkbenchRunActionError error={error} />}
      <RunActions run={run} busy={runs.pending.has(run.runId)} stop={runs.stop} />
      {canMessageRun(run) && (
        <WorkbenchRunMessage runId={run.runId} sendMessage={runs.sendMessage} />
      )}
    </li>
  )
}
