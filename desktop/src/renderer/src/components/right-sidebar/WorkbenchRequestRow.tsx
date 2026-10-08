import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkbenchRequest } from '../../../../shared/workbench-request'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import type { WorkbenchRuns } from './use-workbench-runs'
import WorkbenchCopyDetails from './WorkbenchCopyDetails'
import { errorDetails, type WorkbenchDetail } from './workbench-details'
import { launchBlockerMessage } from './workbench-error-copy'
import { isCancellableRequest } from './workbench-request-cancel'
import { formatWorkbenchRequestTime } from './workbench-request-time'
import { runStatusChip } from './workbench-run-copy'
import type { WorkbenchError } from './workbench-rpc-error'
import WorkbenchRequestStateChip from './WorkbenchRequestStateChip'
import WorkbenchRunActionError from './WorkbenchRunActionError'
import WorkbenchStateChip from './WorkbenchStateChip'

/** What a request row needs from the runs list; optional so the queue also renders on its own. */
export type WorkbenchRequestRuns = Pick<
  WorkbenchRuns,
  'findRun' | 'stop' | 'refresh' | 'stopCount'
> &
  Partial<Pick<WorkbenchRuns, 'pending' | 'actionErrors'>>

// Why: the sequence, revision, IDs and blocker codes are store internals; they go to details only.
export function requestDetails(
  request: WorkbenchRequest,
  runError?: WorkbenchError | null
): WorkbenchDetail[] {
  const blocker = request.status === 'ROUTING_BLOCKED' ? request.routingBlocker : null
  return [
    ['request_id', request.requestId],
    ['sequence', request.sequence],
    ['revision', request.revision],
    ['workspace_id', request.workspaceId],
    ['status', request.status],
    ['run_id', request.workflowRunId],
    ['task_id', request.taskId],
    ['blocker_reason', blocker?.reason],
    ['blocker_detail', blocker?.detail],
    ['created_at', request.createdAt],
    ['updated_at', request.updatedAt],
    ...errorDetails(runError, 'stop')
  ]
}

// Why Stop run here: a blocked request can still hold an unverifiable run; cancel alone leaves it (D3).
function canStopRun(request: WorkbenchRequest, run: WorkflowRunView | null): boolean {
  return (
    (request.status === 'ROUTING_BLOCKED' ||
      run?.status === 'failed' ||
      run?.status === 'canceled') &&
    request.workflowRunId !== null &&
    run?.status !== 'completed'
  )
}

export default function WorkbenchRequestRow({
  request,
  busy,
  cancel,
  runs
}: {
  request: WorkbenchRequest
  busy: boolean
  cancel: (request: WorkbenchRequest) => Promise<void>
  runs?: WorkbenchRequestRuns
}): React.JSX.Element {
  const runId = request.workflowRunId
  const run = runs?.findRun(runId) ?? null
  const runError = runId ? (runs?.actionErrors?.get(runId) ?? null) : null
  const stoppable = runs && runId && canStopRun(request, run)
  return (
    <li className="space-y-1.5 py-2 first:pt-0">
      <div className="flex min-w-0 items-center gap-2">
        <WorkbenchRequestStateChip status={request.status} />
        <time
          className="min-w-0 flex-1 text-meta tabular-nums text-muted-foreground"
          dateTime={request.createdAt}
        >
          {formatWorkbenchRequestTime(request.createdAt)}
        </time>
        <WorkbenchCopyDetails subject="request" entries={requestDetails(request, runError)} />
      </div>
      <p className="whitespace-pre-wrap break-words text-body">{request.objective}</p>
      {request.status === 'ROUTING_BLOCKED' && (
        <p className="break-words text-meta text-foreground">
          {launchBlockerMessage(request.routingBlocker)}
        </p>
      )}
      {run && (
        <dl className="flex flex-wrap items-center gap-x-1.5 text-meta text-muted-foreground">
          <dt>{translate('workbench.requests.run', 'Run')}</dt>
          <dd>
            <WorkbenchStateChip {...runStatusChip(run.status)} />
          </dd>
        </dl>
      )}
      {runError && <WorkbenchRunActionError error={runError} />}
      {(stoppable || isCancellableRequest(request)) && (
        <div className="flex flex-wrap items-center gap-2">
          {stoppable && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={runs.pending?.has(runId) ?? false}
              onClick={() => void runs.stop(runId)}
            >
              {translate('workbench.runs.stop', 'Stop run')}
            </Button>
          )}
          {isCancellableRequest(request) && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => void cancel(request)}
            >
              {translate('workbench.requests.cancel', 'Cancel request')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
