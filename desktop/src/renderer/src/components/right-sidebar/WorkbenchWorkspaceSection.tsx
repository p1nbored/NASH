import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'
import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import IdentifierText from './IdentifierText'
import WorkbenchSectionHeader from './WorkbenchSectionHeader'

function WorkspaceField({
  label,
  value,
  fallback
}: {
  label: string
  value: string | null
  fallback: string
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      {value ? (
        <dd className="break-words font-mono">
          <IdentifierText value={value} />
        </dd>
      ) : (
        <dd className="text-muted-foreground">{fallback}</dd>
      )}
    </div>
  )
}

export default function WorkbenchWorkspaceSection(): React.JSX.Element {
  const workspaceId = useAppStore((state) =>
    getActiveSidebarWorkspaceId(state.activeWorkspaceKey, state.activeWorktreeId)
  )
  const selectedHostId = useAppStore((state) =>
    workspaceId ? getKnownExecutionHostIdForWorktree(state, workspaceId) : null
  )
  const workspace = useAppStore((state) =>
    workspaceId
      ? (state.getKnownWorktreeById(workspaceId, selectedHostId ?? undefined) ?? null)
      : null
  )
  const notResolved = translate('workbench.workspace.notResolved', 'Not resolved')

  return (
    <section aria-labelledby="workbench-workspace" className="space-y-2">
      <WorkbenchSectionHeader
        id="workbench-workspace"
        title={translate('workbench.workspace.title', 'Selected workspace')}
      />
      {workspaceId ? (
        <>
          {workspace ? (
            <p className="break-words text-[13px]">{workspace.displayName}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate(
                'workbench.workspace.unavailable',
                'Workspace details are unavailable in the current catalog.'
              )}
            </p>
          )}
          <dl className="space-y-1.5 text-xs">
            <WorkspaceField
              label={translate('workbench.workspace.identity', 'Workspace ID')}
              value={workspaceId}
              fallback={notResolved}
            />
            <WorkspaceField
              label={translate('workbench.workspace.path', 'Path')}
              value={workspace?.path || null}
              fallback={notResolved}
            />
            <WorkspaceField
              label={translate('workbench.workspace.host', 'Execution host')}
              value={selectedHostId ?? workspace?.hostId ?? null}
              fallback={notResolved}
            />
          </dl>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate('workbench.workspace.empty', 'Select a workspace from the workspace list.')}
        </p>
      )}
    </section>
  )
}
