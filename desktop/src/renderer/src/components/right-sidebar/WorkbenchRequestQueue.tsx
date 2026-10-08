import { useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkbenchRequest } from '../../../../shared/workbench-request'
import { useWorkbenchRequestQueue } from './use-workbench-request-queue'
import WorkbenchCallout from './WorkbenchCallout'
import { errorDetails } from './workbench-details'
import WorkbenchRequestIntake from './WorkbenchRequestIntake'
import WorkbenchRequestRow, { type WorkbenchRequestRuns } from './WorkbenchRequestRow'
import WorkbenchSectionHeader from './WorkbenchSectionHeader'

type Queue = ReturnType<typeof useWorkbenchRequestQueue>

// Why: a stop also cancels the run's request (D3), so the queue re-reads after each stop.
function useRefreshAfterRunStops(stopCount: number, refresh: () => Promise<void>): void {
  const handled = useRef(stopCount)
  useEffect(() => {
    if (stopCount === handled.current) {
      return
    }
    handled.current = stopCount
    void refresh()
  }, [stopCount, refresh])
}

function QueueError({ queue }: { queue: Queue }): React.JSX.Element | null {
  if (!queue.error) {
    return null
  }
  return (
    <WorkbenchCallout
      role="alert"
      tone="error"
      label={translate('workbench.requests.updateFailedTitle', 'Requests could not be updated')}
      details={{
        subject: 'requests',
        entries: [['workspace_id', queue.scope.workspaceId], ...errorDetails(queue.error)]
      }}
    >
      <p className="break-words">{queue.error.message}</p>
      {queue.list && (
        <p className="text-muted-foreground">
          {translate('workbench.requests.stale', 'Displayed requests may be out of date.')}
        </p>
      )}
    </WorkbenchCallout>
  )
}

function QueueRequests({
  queue,
  runs,
  cancel
}: {
  queue: Queue
  runs?: WorkbenchRequestRuns
  cancel: (request: WorkbenchRequest) => Promise<void>
}): React.JSX.Element {
  const pageRequests = queue.list?.requests ?? []
  const receiptOutsidePage =
    queue.receipt && !pageRequests.some((request) => request.requestId === queue.receipt?.requestId)
      ? queue.receipt
      : null
  const rows = receiptOutsidePage ? [receiptOutsidePage, ...pageRequests] : pageRequests
  return (
    <>
      {queue.olderPage && (
        <p className="text-meta text-muted-foreground">
          {translate(
            'workbench.requests.olderPage',
            'Showing an older page. Refresh returns to the latest requests.'
          )}
        </p>
      )}
      {queue.receipt && (
        <p role="status" className="text-meta text-muted-foreground">
          {translate('workbench.requests.registered', 'Request registered.')}
        </p>
      )}
      {queue.list && pageRequests.length === 0 && (
        <p className="text-meta text-muted-foreground">
          {translate('workbench.requests.noneYet', 'No requests yet.')}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((request) => (
            <WorkbenchRequestRow
              key={request.requestId}
              request={request}
              busy={queue.busy}
              cancel={cancel}
              runs={runs}
            />
          ))}
        </ul>
      )}
      {queue.list?.nextBeforeSequence != null && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={queue.busy}
          onClick={() => void queue.loadOlder()}
        >
          {translate('workbench.requests.loadOlder', 'Load older')}
        </Button>
      )}
    </>
  )
}

function ScopeUnavailable({ queue }: { queue: Queue }): React.JSX.Element {
  const remote =
    queue.scope.workspaceId &&
    queue.scope.executionHostId &&
    queue.scope.executionHostId !== 'local'
  return (
    <p className="text-meta text-muted-foreground">
      {remote
        ? translate(
            'workbench.requests.remoteUnavailable',
            'Request intake is unavailable for remote workspaces.'
          )
        : translate(
            'workbench.requests.scopeUnavailable',
            'Select a known local workspace to register or list requests.'
          )}
    </p>
  )
}

export default function WorkbenchRequestQueue({
  runs
}: {
  runs?: WorkbenchRequestRuns
}): React.JSX.Element {
  const queue = useWorkbenchRequestQueue()
  useRefreshAfterRunStops(runs?.stopCount ?? 0, queue.refresh)
  // Why refresh runs after: a submit launches a run and a cancel stops one (D3).
  const submit = async (): Promise<void> => {
    await queue.submit()
    void runs?.refresh()
  }
  const cancel = async (request: WorkbenchRequest): Promise<void> => {
    await queue.cancel(request)
    void runs?.refresh()
  }
  return (
    <section aria-labelledby="workbench-requests" className="space-y-2">
      <WorkbenchSectionHeader
        id="workbench-requests"
        title={translate('workbench.requests.title', 'Local requests')}
      >
        {queue.scope.available && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={queue.busy}
            onClick={() => void queue.refresh()}
          >
            <RefreshCw />
            {translate('workbench.requests.refresh', 'Refresh')}
          </Button>
        )}
      </WorkbenchSectionHeader>
      {queue.scope.available ? (
        <>
          <QueueError queue={queue} />
          <QueueRequests queue={queue} runs={runs} cancel={cancel} />
          <WorkbenchRequestIntake
            objective={queue.objective}
            verified={queue.list !== null}
            busy={queue.busy}
            editObjective={queue.editObjective}
            submit={submit}
          />
        </>
      ) : (
        <ScopeUnavailable queue={queue} />
      )}
    </section>
  )
}
