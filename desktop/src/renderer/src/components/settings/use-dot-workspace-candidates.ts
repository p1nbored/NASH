import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import {
  listDotWorkspaceCandidates,
  type DotListedWorkspace,
  type DotWorkspaceCandidate
} from './dot-workspace-candidates'

/** Workspaces the user may still enable for dot, re-derived whenever their ownership can change. */
export function useDotWorkspaceCandidates(
  listed: readonly DotListedWorkspace[]
): DotWorkspaceCandidate[] {
  // Why every field: the local-host check reads them all, and a stale one lists a remote workspace.
  const state = useAppStore(
    useShallow((store) => ({
      repos: store.repos,
      worktreesByRepo: store.worktreesByRepo,
      folderWorkspaces: store.folderWorkspaces,
      detectedWorktreesByRepo: store.detectedWorktreesByRepo,
      projectGroups: store.projectGroups,
      settings: store.settings,
      activeWorktreeId: store.activeWorktreeId,
      activeWorkspaceExecutionHostId: store.activeWorkspaceExecutionHostId,
      restoredRuntimeHostIdByWorkspaceSessionKey: store.restoredRuntimeHostIdByWorkspaceSessionKey,
      runtimeEnvironments: store.runtimeEnvironments,
      runtimeEnvironmentCatalogHydrated: store.runtimeEnvironmentCatalogHydrated,
      removedRuntimeEnvironmentIds: store.removedRuntimeEnvironmentIds
    }))
  )
  return useMemo(() => listDotWorkspaceCandidates(state, listed), [state, listed])
}
