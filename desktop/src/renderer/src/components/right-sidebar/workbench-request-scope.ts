import type { AppState } from '@/store'
import {
  getKnownExecutionHostIdForWorktree,
  type WorktreeRuntimeOwnerState
} from '@/lib/worktree-runtime-owner'
import { getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'

type WorkbenchScopeState = WorktreeRuntimeOwnerState &
  Pick<
    AppState,
    | 'activeWorkspaceKey'
    | 'activeWorktreeId'
    | 'activeWorkspaceExecutionHostId'
    | 'getKnownWorktreeById'
  >

export function getWorkbenchRequestScope(state: WorkbenchScopeState) {
  const workspaceId = getActiveSidebarWorkspaceId(state.activeWorkspaceKey, state.activeWorktreeId)
  const executionHostId = workspaceId
    ? getKnownExecutionHostIdForWorktree(state, workspaceId)
    : null
  const workspace = workspaceId
    ? state.getKnownWorktreeById(workspaceId, executionHostId ?? undefined)
    : undefined
  return {
    workspaceId,
    executionHostId,
    workspaceKnown: workspace !== undefined && workspace !== null,
    available: Boolean(workspaceId && workspace && executionHostId === 'local'),
    catalogIdentity: workspace
      ? {
          id: workspace.id,
          path: workspace.path,
          repoId: workspace.repoId,
          projectId: workspace.projectId,
          hostId: workspace.hostId,
          projectHostSetupId: workspace.projectHostSetupId,
          instanceId: workspace.instanceId,
          identity: workspace.identity
        }
      : null
  }
}

export function getWorkbenchRequestScopeKey(state: WorkbenchScopeState): string {
  const scope = getWorkbenchRequestScope(state)
  return JSON.stringify([
    scope.workspaceId,
    scope.executionHostId,
    scope.workspaceKnown,
    scope.catalogIdentity
  ])
}
