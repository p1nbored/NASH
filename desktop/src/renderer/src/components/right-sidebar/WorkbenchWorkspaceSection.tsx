import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'
import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import IdentifierText from './IdentifierText'
import WorkbenchCopyDetails from './WorkbenchCopyDetails'
import WorkbenchSectionHeader from './WorkbenchSectionHeader'

// Why only the name and path: the workspace ID and execution host are internal, so they reach
// only "Copy details"; a missing host is left out there rather than guessed as local.
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

  return (
    <section aria-labelledby="workbench-workspace" className="space-y-1">
      <WorkbenchSectionHeader
        id="workbench-workspace"
        title={translate('workbench.workspace.title', 'Selected workspace')}
      >
        {workspaceId && (
          <WorkbenchCopyDetails
            subject="workspace"
            entries={[
              ['workspace_id', workspaceId],
              ['path', workspace?.path],
              ['execution_host', selectedHostId ?? workspace?.hostId]
            ]}
          />
        )}
      </WorkbenchSectionHeader>
      {!workspaceId && (
        <p className="text-meta text-muted-foreground">
          {translate('workbench.workspace.empty', 'Select a workspace from the workspace list.')}
        </p>
      )}
      {workspaceId && !workspace && (
        <p className="text-meta text-muted-foreground">
          {translate(
            'workbench.workspace.detailsUnavailable',
            'Workspace details are unavailable.'
          )}
        </p>
      )}
      {workspace && (
        <div className="min-w-0">
          <p className="break-words text-body">{workspace.displayName}</p>
          {workspace.path && (
            <p className="break-words font-mono text-meta text-muted-foreground">
              <IdentifierText value={workspace.path} />
            </p>
          )}
        </div>
      )}
    </section>
  )
}
