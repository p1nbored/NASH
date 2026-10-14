import { isRemoteRuntimePtyId } from '../../../../shared/remote-runtime-pty-id'
import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import type { AppState } from '../types'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import { getWorktreeIdFromVisitKey, getWorktreeVisitKey } from '@/lib/worktree-visit-recency'
import { omitSparsePresetsForRepos } from '../slices/sparse-presets'
import { repoMatchesHostIdentity } from '../slices/repo-host-identity'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { hasRuntimeRpcErrorCode } from '../../runtime/runtime-rpc-result'
import { ipcOrRuntimeTargetForHostId } from '../../runtime/runtime-client-target'
import { translate } from '@/i18n/i18n'
import { readIpcErrorMessage } from '@/lib/ipc-error'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { destroyRecipeVmBeforeProjectRemoval } from './recipe-vm-project-removal'
import { stopRuntimeProjectTerminalsBeforeRemoval } from './runtime-project-terminal-stop'
import type { RepoSlice } from './repo-state'
import { ERROR_TOAST_DURATION } from './repo-state'
import { mergeProjectCompatibilityForHostRepoChange } from './repo-catalog-identity'
import {
  captureWorkspaceChatDraftKeys,
  deleteWorkspaceChatDrafts
} from '../slices/worktrees/teardown/removed-worktree-chat-drafts'

export function worktreeBelongsToHost(worktree: { hostId?: string }, hostId: string): boolean {
  return (worktree.hostId ?? LOCAL_EXECUTION_HOST_ID) === hostId
}

type HostScopedWorktreeRef = { id: string; hostId?: string }

type RepoWorktreeCatalog = {
  worktreesByRepo: Readonly<Record<string, readonly HostScopedWorktreeRef[] | undefined>>
  detectedWorktreesByRepo: Readonly<
    Record<string, { worktrees: readonly HostScopedWorktreeRef[] } | undefined>
  >
}

export function getKnownRepoWorktreeIds(
  state: RepoWorktreeCatalog,
  projectId: string,
  hostId?: string
): string[] {
  const ids = new Set<string>()
  for (const worktree of state.worktreesByRepo[projectId] ?? []) {
    if (!hostId || worktreeBelongsToHost(worktree, hostId)) {
      ids.add(worktree.id)
    }
  }
  for (const worktree of state.detectedWorktreesByRepo[projectId]?.worktrees ?? []) {
    if (!hostId || worktreeBelongsToHost(worktree, hostId)) {
      ids.add(worktree.id)
    }
  }
  return [...ids]
}

/** Terminal tabs that removing this project's host row will close. */
export function countOpenRepoTerminalTabs(
  state: RepoWorktreeCatalog & {
    tabsByWorktree: Readonly<Record<string, readonly { id: string }[] | undefined>>
    ptyIdsByTabId: Readonly<Record<string, readonly string[] | undefined>>
  },
  projectId: string,
  hostId: string
): number {
  let count = 0
  for (const worktreeId of getKnownRepoWorktreeIds(state, projectId, hostId)) {
    for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
      if ((state.ptyIdsByTabId[tab.id]?.length ?? 0) > 0) {
        count += 1
      }
    }
  }
  return count
}

export function createRepoRemovalActions(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1]
): Pick<RepoSlice, 'removeProject'> {
  return {
    removeProject: async (projectId, options) => {
      try {
        // Why: exact host match only; the unique-candidate/focused fallbacks could pick another host's row (#13071).
        const ownerRepo = get().repos.find((repo) =>
          repoMatchesHostIdentity(repo, projectId, options.hostId)
        )
        if (!ownerRepo) {
          return
        }
        const ownerHostId = getRepoExecutionHostId(ownerRepo)
        // Why only awaited for a VM: concurrent removals of one row must reach the host together.
        const vmDestroy = destroyRecipeVmBeforeProjectRemoval(
          get(),
          ownerRepo,
          ownerHostId,
          getKnownRepoWorktreeIds(get(), projectId, ownerHostId)
        )
        const vmServerDestroyed = vmDestroy !== false && (await vmDestroy)
        // Why: derive the target from the owner row's host so an SSH host removal never routes repo.rm to the focused runtime.
        const target = ipcOrRuntimeTargetForHostId(ownerHostId)
        if (!target) {
          throw new Error('The project host is unresolved. Refresh and retry.')
        }
        // Why before the host call: its announcement can start a listing refresh that drops these tabs.
        const chatDraftKeys = captureWorkspaceChatDraftKeys(
          get(),
          getKnownRepoWorktreeIds(get(), projectId, ownerHostId).map((workspaceId) => ({
            workspaceId,
            executionHostId: ownerHostId
          }))
        )
        if (target.kind === 'environment' && !vmServerDestroyed) {
          await stopRuntimeProjectTerminalsBeforeRemoval(
            target.environmentId,
            projectId,
            getKnownRepoWorktreeIds(get(), projectId, ownerHostId)
          )
        }
        try {
          // Why: destroying the VM took its server, and the catalog holding this row, with it.
          if (!vmServerDestroyed) {
            // Why: always host-scoped; this catalog may be stale and miss a same-id row on another host (#13071).
            await (target.kind === 'local'
              ? window.api.repos.removeForHost({ repoId: projectId, hostId: ownerHostId })
              : callRuntimeRpc(target, 'repo.rm', { repo: projectId }, { timeoutMs: 15_000 }))
          }
        } catch (err) {
          // Why: the owner already dropped this project, so purge the local ghost row instead of aborting (#11994).
          if (!hasRuntimeRpcErrorCode(err, 'repo_not_found')) {
            throw err
          }
        }

        get().clearOrcaHookTrustForRepo(projectId)
        const repoPath = get().repos.find((repo) =>
          repoMatchesHostIdentity(repo, projectId, ownerHostId)
        )?.path
        get().evictGitHubRepoCaches(projectId, repoPath)
        const { clearRepoSlugCacheEntry } = await import('../../lib/repo-slug-index')
        clearRepoSlugCacheEntry(projectId)

        // Kill PTYs for all worktrees belonging to this repo
        const worktreeIds = getKnownRepoWorktreeIds(get(), projectId, ownerHostId)
        // A raw id can be published by two hosts. Keep the purge host-scoped for
        // those twins so the sibling's qualified visit recency survives.
        const knownRepoWorktrees = [
          ...(get().worktreesByRepo[projectId] ?? []),
          ...(get().detectedWorktreesByRepo[projectId]?.worktrees ?? [])
        ]
        const exactSiblingIds = new Set(
          knownRepoWorktrees
            .filter((worktree) => !worktreeBelongsToHost(worktree, ownerHostId))
            .map((worktree) => worktree.id)
        )
        const purgeTargets = worktreeIds.map((id) =>
          exactSiblingIds.has(id) ? { id, hostId: ownerHostId } : id
        )
        const localAgentContextProjectIds =
          ownerHostId === LOCAL_EXECUTION_HOST_ID
            ? [
                projectId,
                ...(get().worktreesByRepo[projectId] ?? [])
                  .filter((worktree) => worktreeBelongsToHost(worktree, ownerHostId))
                  .flatMap((worktree) => (worktree.projectId ? [worktree.projectId] : []))
              ]
            : []
        const killedTabIds = new Set<string>()
        for (const wId of worktreeIds) {
          const tabs = get().tabsByWorktree[wId] ?? []
          for (const tab of tabs) {
            killedTabIds.add(tab.id)
            for (const ptyId of get().ptyIdsByTabId[tab.id] ?? []) {
              if (!isRemoteRuntimePtyId(ptyId)) {
                window.api.pty.kill(ptyId)
              }
            }
          }
        }

        // Why: use the canonical per-worktree purge to evict all worktree-scoped maps (hand-deletion leaked most); runs before the set() below so it still sees tabsByWorktree.
        get().purgeWorktreeTerminalState(purgeTargets)
        deleteWorkspaceChatDrafts(chatDraftKeys)
        get().clearLocalDetectedAgentContextsForProjects(localAgentContextProjectIds)

        set((s) => {
          const nextWorktrees = { ...s.worktreesByRepo }
          const remainingWorktrees = (nextWorktrees[projectId] ?? []).filter(
            (worktree) => !worktreeBelongsToHost(worktree, ownerHostId)
          )
          if (remainingWorktrees.length > 0) {
            nextWorktrees[projectId] = remainingWorktrees
          } else {
            delete nextWorktrees[projectId]
          }
          const nextDetectedWorktrees = { ...s.detectedWorktreesByRepo }
          const detected = nextDetectedWorktrees[projectId]
          if (detected) {
            const remainingDetected = detected.worktrees.filter(
              (worktree) => !worktreeBelongsToHost(worktree, ownerHostId)
            )
            if (remainingDetected.length > 0) {
              nextDetectedWorktrees[projectId] = { ...detected, worktrees: remainingDetected }
            } else {
              delete nextDetectedWorktrees[projectId]
            }
          }
          const nextTabs = { ...s.tabsByWorktree }
          const nextLayouts = { ...s.terminalLayoutsByTabId }
          const nextLocalOnlyScrollback = { ...s.localOnlyScrollbackByTabId }
          const nextPtyIdsByTabId = { ...s.ptyIdsByTabId }
          const nextRuntimePaneTitlesByTabId = { ...s.runtimePaneTitlesByTabId }
          for (const wId of worktreeIds) {
            delete nextTabs[wId]
          }
          for (const tabId of killedTabIds) {
            delete nextLayouts[tabId]
            delete nextLocalOnlyScrollback[tabId]
            delete nextPtyIdsByTabId[tabId]
            delete nextRuntimePaneTitlesByTabId[tabId]
          }
          // Why: editor state is worktree-scoped; clear the repo's open files + active-file tracking so orphans don't linger in the session save.
          const worktreeIdSet = new Set(worktreeIds)
          const removedVisitKeys = new Set(
            worktreeIds.map((worktreeId) => getWorktreeVisitKey(worktreeId, ownerHostId))
          )
          const nextOpenFiles = s.openFiles.filter((f) => !worktreeIdSet.has(f.worktreeId))
          const nextActiveFileIdByWorktree = { ...s.activeFileIdByWorktree }
          const nextActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
          for (const wId of worktreeIds) {
            delete nextActiveFileIdByWorktree[wId]
            delete nextActiveTabTypeByWorktree[wId]
          }
          const activeFileCleared = s.activeFileId
            ? s.openFiles.some((f) => f.id === s.activeFileId && worktreeIdSet.has(f.worktreeId))
            : false
          const nextRepos = s.repos.filter(
            (r) => !repoMatchesHostIdentity(r, projectId, ownerHostId)
          )
          // Why: when no sibling host owns this id, drop every worktree timestamp (unhydrated SSH ones would otherwise never prune); else stay host-scoped.
          const repoIdFullyRemoved = !nextRepos.some((r) => r.id === projectId)
          let nextLastVisitedAtByWorktreeId = s.lastVisitedAtByWorktreeId
          for (const id of Object.keys(s.lastVisitedAtByWorktreeId)) {
            const rawId = getWorktreeIdFromVisitKey(id)
            if (
              (ownerHostId && removedVisitKeys.has(id)) ||
              (!ownerHostId && worktreeIdSet.has(rawId)) ||
              (repoIdFullyRemoved && getRepoIdFromWorktreeId(rawId) === projectId)
            ) {
              if (nextLastVisitedAtByWorktreeId === s.lastVisitedAtByWorktreeId) {
                nextLastVisitedAtByWorktreeId = { ...s.lastVisitedAtByWorktreeId }
              }
              delete nextLastVisitedAtByWorktreeId[id]
            }
          }
          const survivingRepoIds = new Set(nextRepos.map((r) => r.id))
          const removedRepoIds = s.repos.filter((r) => !survivingRepoIds.has(r.id)).map((r) => r.id)
          return {
            repos: nextRepos,
            // Why: drop removed repos' sparse-preset maps so they don't outlive the repo for the whole session.
            ...omitSparsePresetsForRepos(s, removedRepoIds),
            ...mergeProjectCompatibilityForHostRepoChange({
              previous: { projects: s.projects, projectHostSetups: s.projectHostSetups },
              nextRepos,
              hostId: ownerHostId
            }),
            activeRepoId: s.activeRepoId === projectId ? null : s.activeRepoId,
            filterRepoIds: s.filterRepoIds.filter((id) => id !== projectId),
            worktreesByRepo: nextWorktrees,
            detectedWorktreesByRepo: nextDetectedWorktrees,
            tabsByWorktree: nextTabs,
            ptyIdsByTabId: nextPtyIdsByTabId,
            runtimePaneTitlesByTabId: nextRuntimePaneTitlesByTabId,
            terminalLayoutsByTabId: nextLayouts,
            localOnlyScrollbackByTabId: nextLocalOnlyScrollback,
            activeTabId: s.activeTabId && killedTabIds.has(s.activeTabId) ? null : s.activeTabId,
            openFiles: nextOpenFiles,
            activeFileIdByWorktree: nextActiveFileIdByWorktree,
            activeTabTypeByWorktree: nextActiveTabTypeByWorktree,
            activeFileId: activeFileCleared ? null : s.activeFileId,
            activeTabType: activeFileCleared ? 'terminal' : s.activeTabType,
            lastVisitedAtByWorktreeId: nextLastVisitedAtByWorktreeId,
            folderWorkspacePathStatuses: {},
            sortEpoch: s.sortEpoch + 1,
            // Why: removing the last repo must reset activeView + clear activeWorktreeId so App renders Landing, not an empty settings/terminal pane.
            ...(nextRepos.length === 0
              ? {
                  activeView: 'terminal' as const,
                  activeWorktreeId: null,
                  activeWorkspaceKey: null,
                  activeWorkspaceExecutionHostId: null,
                  activeRepoId: null
                }
              : {})
          }
        })
      } catch (err) {
        console.error('Failed to remove repo:', err)
        // Why: bulk and background callers aggregate their own failures, so only opted-in single-project entry points toast (#11994).
        if (options.errorFeedback === 'toast') {
          toast.error(
            translate('auto.store.slices.repos.removeProjectFailed', 'Failed to remove project'),
            {
              description: readIpcErrorMessage(err) ?? String(err),
              duration: ERROR_TOAST_DURATION
            }
          )
        }
      }
    }
  }
}
