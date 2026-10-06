import { translate } from '@/i18n/i18n'
import { useWorkbenchValidationDecisions } from './use-workbench-validation-decisions'
import WorkbenchCallout from './WorkbenchCallout'
import WorkbenchSectionHeader from './WorkbenchSectionHeader'
import WorkbenchValidationDecisionRow from './WorkbenchValidationDecisionRow'

// Why not scoped to the workspace: an undecided result holds its run open wherever the user is
// looking, and only the user or dot may decide it, never the primary session (section 9).
export default function WorkbenchValidationDecisionSection(): React.JSX.Element {
  const decisions = useWorkbenchValidationDecisions()
  const waiting = decisions.rows.filter((row) => row.outcome === null).length
  return (
    <section aria-labelledby="workbench-decisions" className="space-y-3">
      <WorkbenchSectionHeader
        id="workbench-decisions"
        title={translate('workbench.decisions.title', 'Waiting for your decision')}
      >
        {waiting > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {translate('workbench.decisions.waiting', '{{waiting}} waiting', { waiting })}
          </span>
        )}
      </WorkbenchSectionHeader>
      {decisions.error && (
        <WorkbenchCallout
          role="alert"
          label={translate('workbench.decisions.errorTitle', 'Decisions unavailable')}
        >
          <p className="break-words">{decisions.error.message}</p>
          <p className="break-words font-mono">{decisions.error.code}</p>
          {decisions.rows.length > 0 && (
            <p>{translate('workbench.decisions.stale', 'Displayed results may be out of date.')}</p>
          )}
        </WorkbenchCallout>
      )}
      {decisions.loaded && decisions.rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {translate('workbench.decisions.empty', 'No task results are waiting for your decision.')}
        </p>
      )}
      {decisions.rows.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {translate(
              'workbench.decisions.help',
              'Validation could not decide these task results. Waive accepts a result as done; Reject fails its task. The main Claude session cannot decide them.'
            )}
          </p>
          <ul className="space-y-3">
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
        <p className="text-xs text-muted-foreground">
          {translate('workbench.decisions.hasMore', 'Showing the oldest results only.')}
        </p>
      )}
    </section>
  )
}
