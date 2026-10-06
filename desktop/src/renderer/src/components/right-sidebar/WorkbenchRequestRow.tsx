import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkbenchRequest } from '../../../../shared/workbench-request'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import IdentifierText from './IdentifierText'
import { isRunEnded, type WorkbenchRuns } from './use-workbench-runs'
import { isCancellableRequest } from './workbench-request-cancel'
import { runStatusChip } from './workbench-run-copy'
import WorkbenchRequestLaunchBlocker from './WorkbenchRequestLaunchBlocker'
import WorkbenchRequestStateChip from './WorkbenchRequestStateChip'
import WorkbenchRunActionError from './WorkbenchRunActionError'
import WorkbenchStateChip from './WorkbenchStateChip'
import { formatWorkbenchRequestTime } from './workbench-request-time'

/** What a request row needs from the runs list; optional so the queue also renders on its own. */
export type WorkbenchRequestRuns = Pick<
  WorkbenchRuns,
  'findRun' | 'stop' | 'refresh' | 'stopCount'
> &
  Partial<Pick<WorkbenchRuns, 'pending' | 'actionErrors'>>

function RequestSummary({ request }: { request: WorkbenchRequest }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <WorkbenchRequestStateChip status={request.status} />
      <dl className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <div>
          <dt className="sr-only">{translate('workbench.requests.sequence', 'Sequence')}</dt>
          <dd>
            {translate('workbench.requests.sequenceValue', '#{{sequence}}', {
              sequence: request.sequence
            })}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>{translate('workbench.requests.revision', 'Revision')}</dt>
          <dd className="text-foreground">{request.revision}</dd>
        </div>
        <div>
          <dt className="sr-only">{translate('workbench.requests.created', 'Created')}</dt>
          <dd>
            <time dateTime={request.createdAt}>
              {formatWorkbenchRequestTime(request.createdAt)}
            </time>
          </dd>
        </div>
      </dl>
    </div>
  )
}

function RequestDetails({
  request,
  run
}: {
  request: WorkbenchRequest
  run: WorkflowRunView | null
}): React.JSX.Element {
  return (
    <dl className="min-w-48 flex-1 space-y-0.5 text-xs text-muted-foreground">
      <div className="flex min-w-0 gap-1">
        <dt className="shrink-0">{translate('workbench.requests.id', 'Request ID')}</dt>
        <dd className="min-w-0 break-words font-mono text-foreground">
          <IdentifierText value={request.requestId} />
        </dd>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        <dt className="shrink-0">{translate('workbench.requests.run', 'Run')}</dt>
        {request.workflowRunId ? (
          <dd className="min-w-0 break-words font-mono text-foreground">
            <IdentifierText value={request.workflowRunId} />
          </dd>
        ) : (
          <dd className="text-foreground">{translate('workbench.requests.noRun', 'No run')}</dd>
        )}
        {run && (
          <dd>
            <WorkbenchStateChip status={run.status} {...runStatusChip(run.status)} />
          </dd>
        )}
      </div>
    </dl>
  )
}

// Why Stop run here: a blocked request can still hold an unverifiable run; cancel alone leaves it (D3).
function canStopRun(request: WorkbenchRequest, run: WorkflowRunView | null): boolean {
  return (
    request.status === 'ROUTING_BLOCKED' &&
    request.workflowRunId !== null &&
    !(run && isRunEnded(run))
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
  const runError = runId ? runs?.actionErrors?.get(runId) : undefined
  return (
    <li className="space-y-2 border-t border-border pt-3">
      <RequestSummary request={request} />
      <p className="whitespace-pre-wrap break-words text-[13px]">{request.objective}</p>
      <WorkbenchRequestLaunchBlocker request={request} />
      {runError && <WorkbenchRunActionError error={runError} />}
      {/* Why wrap: with two actions the ids keep their width and the buttons move below them. */}
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <RequestDetails request={request} run={run} />
        <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
          {runs && runId && canStopRun(request, run) && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={runs.pending?.has(runId) ?? false}
              aria-label={translate('workbench.runs.stopLabel', 'Stop run {{runId}}', { runId })}
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
              aria-label={translate(
                'workbench.requests.cancelLabel',
                'Cancel request {{requestId}}',
                { requestId: request.requestId }
              )}
              onClick={() => void cancel(request)}
            >
              {translate('workbench.requests.cancel', 'Cancel request')}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
