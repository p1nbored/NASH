import { translate } from '@/i18n/i18n'
import type { WorkbenchRuns } from './use-workbench-runs'
import WorkbenchCallout from './WorkbenchCallout'
import { errorDetails } from './workbench-details'
import WorkbenchRunRow from './WorkbenchRunRow'
import WorkbenchSectionHeader from './WorkbenchSectionHeader'
import WorkbenchValidationCheck from './WorkbenchValidationCheck'

function RunsUnavailable({ runs }: { runs: WorkbenchRuns }): React.JSX.Element {
  const remote =
    runs.scope.workspaceId && runs.scope.executionHostId && runs.scope.executionHostId !== 'local'
  return (
    <p className="text-meta text-muted-foreground">
      {remote
        ? translate(
            'workbench.runs.remoteUnavailable',
            'Runs are unavailable for remote workspaces.'
          )
        : translate(
            'workbench.runs.scopeUnavailable',
            'Select a known local workspace to see its runs.'
          )}
    </p>
  )
}

function RunsList({ runs }: { runs: WorkbenchRuns }): React.JSX.Element {
  const listed = runs.runs ?? []
  return (
    <>
      {runs.error && (
        <WorkbenchCallout
          role="alert"
          tone="error"
          label={translate('workbench.runs.unavailableTitle', 'Runs unavailable')}
          details={{
            subject: 'runs',
            entries: [['workspace_id', runs.scope.workspaceId], ...errorDetails(runs.error)]
          }}
        >
          <p className="break-words">{runs.error.message}</p>
          {runs.runs && (
            <p className="text-muted-foreground">
              {translate('workbench.runs.stale', 'Displayed runs may be out of date.')}
            </p>
          )}
        </WorkbenchCallout>
      )}
      {runs.runs && listed.length === 0 && (
        <p className="text-meta text-muted-foreground">
          {translate('workbench.runs.empty', 'No runs in this workspace yet.')}
        </p>
      )}
      {listed.length > 0 && (
        <ul className="divide-y divide-border">
          {listed.map((run) => (
            <WorkbenchRunRow key={run.runId} run={run} runs={runs} />
          ))}
        </ul>
      )}
      {runs.hasMore && (
        <p className="text-meta text-muted-foreground">
          {translate('workbench.runs.hasMore', 'Showing the most recent runs only.')}
        </p>
      )}
    </>
  )
}

// Why its own section: dot runs have no desktop request row, so this is where the desktop sees them.
export default function WorkbenchRunsSection({ runs }: { runs: WorkbenchRuns }): React.JSX.Element {
  return (
    <section aria-labelledby="workbench-runs" className="space-y-2">
      <WorkbenchSectionHeader
        id="workbench-runs"
        title={translate('workbench.runs.title', 'Runs')}
      />
      {runs.scope.available ? (
        <>
          <RunsList runs={runs} />
          <WorkbenchValidationCheck />
        </>
      ) : (
        <RunsUnavailable runs={runs} />
      )}
    </section>
  )
}
