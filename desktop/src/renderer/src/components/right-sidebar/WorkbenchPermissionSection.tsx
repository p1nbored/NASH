import { translate } from '@/i18n/i18n'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import { useWorkbenchPermissionPrompts } from './use-workbench-permission-prompts'
import WorkbenchCallout from './WorkbenchCallout'
import { errorDetails } from './workbench-details'
import WorkbenchPermissionRow from './WorkbenchPermissionRow'
import WorkbenchSectionHeader from './WorkbenchSectionHeader'

// Why not scoped to the workspace: a prompt blocks its session wherever the user is looking (D-016, D-017).
export default function WorkbenchPermissionSection({
  findRun
}: {
  findRun?: (runId: string) => WorkflowRunView | null
}): React.JSX.Element {
  const prompts = useWorkbenchPermissionPrompts()
  const waiting = prompts.rows.filter((row) => row.view.status === 'pending').length
  return (
    <section aria-labelledby="workbench-permissions" className="space-y-2">
      <WorkbenchSectionHeader
        id="workbench-permissions"
        title={translate('workbench.permissions.title', 'Permission prompts')}
      >
        {waiting > 0 && (
          <span className="text-meta tabular-nums text-muted-foreground">
            {translate('workbench.permissions.waiting', '{{waiting}} waiting', { waiting })}
          </span>
        )}
      </WorkbenchSectionHeader>
      {prompts.error && (
        <WorkbenchCallout
          role="alert"
          tone="error"
          label={translate('workbench.permissions.errorTitle', 'Permission prompts unavailable')}
          details={{ subject: 'permission prompts', entries: errorDetails(prompts.error) }}
        >
          <p className="break-words">{prompts.error.message}</p>
          {prompts.rows.length > 0 && (
            <p className="text-muted-foreground">
              {translate('workbench.permissions.stale', 'Displayed prompts may be out of date.')}
            </p>
          )}
        </WorkbenchCallout>
      )}
      {prompts.loaded && prompts.rows.length === 0 && (
        <p className="text-meta text-muted-foreground">
          {translate('workbench.permissions.empty', 'No permission prompts are waiting.')}
        </p>
      )}
      {prompts.rows.length > 0 && (
        <ul className="divide-y divide-border">
          {prompts.rows.map((row) => (
            <WorkbenchPermissionRow
              key={row.view.decisionId}
              row={row}
              run={findRun?.(row.view.runId) ?? null}
              answer={prompts.answer}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
