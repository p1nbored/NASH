import { translate } from '@/i18n/i18n'
import { useWorkbenchValidationDecisions } from './use-workbench-validation-decisions'
import WorkbenchCallout from './WorkbenchCallout'
import { errorDetails } from './workbench-details'
import WorkbenchSectionHeader from './WorkbenchSectionHeader'
import WorkbenchValidationDecisionRow from './WorkbenchValidationDecisionRow'

// Why not scoped to the workspace: an undecided result holds its run open wherever the user is
// looking, and only the user or dot may decide it, never the primary session (section 9).
export default function WorkbenchValidationDecisionSection(): React.JSX.Element {
  const decisions = useWorkbenchValidationDecisions()
  const waiting = decisions.rows.filter((row) => row.outcome === null).length
  return (
    <section aria-labelledby="workbench-decisions" className="space-y-2">
      <WorkbenchSectionHeader
        id="workbench-decisions"
        title={translate('workbench.decisions.title', 'Waiting for your decision')}
      >
        {waiting > 0 && (
          <span className="text-meta tabular-nums text-muted-foreground">
            {translate('workbench.decisions.waiting', '{{waiting}} waiting', { waiting })}
          </span>
        )}
      </WorkbenchSectionHeader>
      {decisions.error && (
        <WorkbenchCallout
          role="alert"
          tone="error"
          label={translate('workbench.decisions.errorTitle', 'Decisions unavailable')}
          details={{ subject: 'validation decisions', entries: errorDetails(decisions.error) }}
        >
          <p className="break-words">{decisions.error.message}</p>
          {decisions.rows.length > 0 && (
            <p className="text-muted-foreground">
              {translate('workbench.decisions.stale', 'Displayed results may be out of date.')}
            </p>
          )}
        </WorkbenchCallout>
      )}
      {decisions.loaded && decisions.rows.length === 0 && (
        <p className="text-meta text-muted-foreground">
          {translate('workbench.decisions.empty', 'No task results are waiting for your decision.')}
        </p>
      )}
      {decisions.rows.length > 0 && (
        <>
          <p className="text-meta text-muted-foreground">
            {translate(
              'workbench.decisions.helpShort',
              'Validation could not decide these results. Waive accepts one as done; Reject fails its task.'
            )}
          </p>
          <ul className="divide-y divide-border">
            {decisions.rows.map((row) => (
              <WorkbenchValidationDecisionRow
                key={row.view.validationId}
                row={row}
                decide={decisions.decide}
              />
            ))}
          </ul>
        </>
      )}
      {decisions.hasMore && (
        <p className="text-meta text-muted-foreground">
          {translate('workbench.decisions.hasMore', 'Showing the oldest results only.')}
        </p>
      )}
    </section>
  )
}
