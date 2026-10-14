import { useMemo } from 'react'
import {
  isAutomationGeneratedWorkspace,
  isCliCreatedWorkspace,
  isDetachedHeadWorkspace,
  isSleepingSweepExemptWorkspace
} from '@/components/sidebar/visible-worktrees'
import { getStructuredChatWorktreeIds } from '@/components/sidebar/visible-worktree-activity-inputs'
import { isDefaultBranchWorkspace } from '@/components/sidebar/default-branch-workspace'
import { sortWorktreesSmart } from '@/components/sidebar/smart-sort'
import { buildWorktreeChecksReviewIndex } from '@/components/cmd-j/worktree-checks-review-index'
import { getLiveAgentStatusByWorktreeId, isInactiveWorkspace } from '@/lib/worktree-activity-state'
import { orderEmptyQueryWorktrees } from '@/lib/order-empty-query-worktrees'
import {
  getWorktreePaletteSearchScope,
  searchWorktreeDocuments
} from '@/lib/worktree-palette-search'
import { buildPaletteWorktreeIndex, resolvePaletteWorktree } from '@/lib/palette-repo-resolution'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  getPairedDeviceIdsByEnvironment,
  isWorkspaceFromOtherDevice
} from '@/components/sidebar/workspace-creator-visibility'
import type { Worktree } from '../../../shared/worktree/types'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { EMPTY_SORTED_WORKTREES } from './worktree-jump-palette-model'
import { buildWorktreeJumpPaletteDocumentIndex } from './worktree-jump-palette-document-index'
import { buildWorktreeJumpPaletteWorktreeMaps } from './worktree-jump-palette-worktree-maps'
import type { WorktreeJumpPaletteWorktreesInput } from './worktree-jump-palette-worktrees-input'

export function useWorktreeJumpPaletteWorktrees({
  paletteSearchQuery,
  paletteSearchContext,
  repos,
  worktreesByRepo,
  agentStatusByPaneKey,
  tabsByWorktree,
  workspaces,
  filterPredicate,
  hideDefaultBranchWorkspace,
  hideAutomationGeneratedWorkspaces,
  hideCliCreatedWorkspaces,
  hideDetachedHeadWorkspaces,
  hideWorkspacesFromOtherDevices,
  showSleepingWorkspaces,
  alwaysShowDefaultBranchWorkspace,
  ptyIdsByTabId,
  browserTabsByWorktree,
  unifiedTabsByWorktree,
  activeWorktreeId,
  activeWorkspaceExecutionHostId,
  runtimeEnvironments,
  runtimeStatusByEnvironmentId,
  lastVisitedAtByWorktreeId,
  paletteStatusInputsActive,
  repoMap,
  runtimePaneTitlesByTabId,
  migrationUnsupportedByPtyId,
  terminalLayoutsByTabId,
  repoByHostIdentity,
  hostOptions,
  hostFilterActive,
  prCache,
  hostedReviewCache,
  settings,
  issueCache,
  workspacePortScan
}: WorktreeJumpPaletteWorktreesInput) {
  const hasQuery = paletteSearchQuery.length > 0
  const isLoading = repos.length > 0 && Object.keys(worktreesByRepo).length === 0
  const worktreeIdsWithLiveAgent = useMemo(
    () =>
      new Set(
        // The palette recomputes this snapshot when status inputs change; the
        // clock intentionally reflects the render that performs that snapshot.
        // oxlint-disable-next-line react/purity
        getLiveAgentStatusByWorktreeId(agentStatusByPaneKey, tabsByWorktree, Date.now()).keys()
      ),
    [agentStatusByPaneKey, tabsByWorktree]
  )
  const pairedDeviceIdsByEnvironment = useMemo(
    () =>
      hideWorkspacesFromOtherDevices
        ? getPairedDeviceIdsByEnvironment(runtimeEnvironments, runtimeStatusByEnvironmentId)
        : EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
    [hideWorkspacesFromOtherDevices, runtimeEnvironments, runtimeStatusByEnvironmentId]
  )
  const worktreeIdsWithStructuredChat = getStructuredChatWorktreeIds(
    showSleepingWorkspaces,
    unifiedTabsByWorktree
  )
  const emptyQueryVisibleWorktrees = useMemo(
    () =>
      workspaces.filter((worktree) => {
        if (worktree.isArchived) {
          return false
        }
        if (filterPredicate && !filterPredicate.matchesWorktree(worktree)) {
          return false
        }
        if (
          hideWorkspacesFromOtherDevices &&
          isWorkspaceFromOtherDevice(worktree, pairedDeviceIdsByEnvironment)
        ) {
          return false
        }
        // Folder rows follow the sidebar's host/device scope, without git or sleeping filters.
        if (parseWorkspaceKey(worktree.id)?.type === 'folder') {
          return true
        }
        if (
          hideDefaultBranchWorkspace &&
          isDefaultBranchWorkspace(worktree, repoMap.get(worktree.repoId))
        ) {
          return false
        }
        if (hideAutomationGeneratedWorkspaces && isAutomationGeneratedWorkspace(worktree)) {
          return false
        }
        if (hideCliCreatedWorkspaces && isCliCreatedWorkspace(worktree)) {
          return false
        }
        if (hideDetachedHeadWorkspaces && isDetachedHeadWorkspace(worktree)) {
          return false
        }
        if (
          !showSleepingWorkspaces &&
          !isSleepingSweepExemptWorkspace(worktree, alwaysShowDefaultBranchWorkspace) &&
          isInactiveWorkspace(
            worktree.id,
            tabsByWorktree,
            ptyIdsByTabId,
            browserTabsByWorktree,
            worktreeIdsWithLiveAgent,
            worktreeIdsWithStructuredChat
          )
        ) {
          return false
        }
        return true
      }),
    [
      workspaces,
      alwaysShowDefaultBranchWorkspace,
      browserTabsByWorktree,
      filterPredicate,
      hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces,
      hideDefaultBranchWorkspace,
      hideDetachedHeadWorkspaces,
      hideWorkspacesFromOtherDevices,
      pairedDeviceIdsByEnvironment,
      ptyIdsByTabId,
      repoMap,
      showSleepingWorkspaces,
      tabsByWorktree,
      worktreeIdsWithLiveAgent,
      worktreeIdsWithStructuredChat
    ]
  )
  const { visibleWorktreesForState, switchableWorktreesForRows } = useMemo(
    () =>
      orderEmptyQueryWorktrees({
        visibleWorktrees: emptyQueryVisibleWorktrees,
        activeWorktreeId,
        activeWorkspaceExecutionHostId,
        lastVisitedAtByWorktreeId
      }),
    [
      emptyQueryVisibleWorktrees,
      activeWorktreeId,
      activeWorkspaceExecutionHostId,
      lastVisitedAtByWorktreeId
    ]
  )
  const searchScopeWorktrees = useMemo(() => {
    const scope = getWorktreePaletteSearchScope({
      hasQuery,
      allWorktrees: workspaces,
      emptyQueryWorktrees: switchableWorktreesForRows
    })
    return hasQuery && filterPredicate ? scope.filter(filterPredicate.matchesWorktree) : scope
  }, [workspaces, filterPredicate, hasQuery, switchableWorktreesForRows])
  const browserSortedWorktrees = useMemo(() => {
    if (!paletteStatusInputsActive) {
      return EMPTY_SORTED_WORKTREES
    }
    const scope = filterPredicate ? workspaces.filter(filterPredicate.matchesWorktree) : workspaces
    return sortWorktreesSmart(
      scope,
      tabsByWorktree,
      repoMap,
      agentStatusByPaneKey,
      runtimePaneTitlesByTabId,
      ptyIdsByTabId,
      migrationUnsupportedByPtyId,
      terminalLayoutsByTabId
    )
  }, [
    paletteStatusInputsActive,
    workspaces,
    filterPredicate,
    tabsByWorktree,
    repoMap,
    agentStatusByPaneKey,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    migrationUnsupportedByPtyId,
    terminalLayoutsByTabId
  ])
  const sortedWorktrees = useMemo(
    () =>
      hasQuery
        ? browserSortedWorktrees.filter((worktree) => !worktree.isArchived)
        : searchScopeWorktrees,
    [hasQuery, browserSortedWorktrees, searchScopeWorktrees]
  )
  const paletteWorktreeIndex = useMemo(
    () => buildPaletteWorktreeIndex(browserSortedWorktrees),
    [browserSortedWorktrees]
  )
  const resolveWorktree = useMemo(
    () =>
      (worktreeId: string, hostId: Worktree['hostId'] | undefined): Worktree | undefined =>
        resolvePaletteWorktree(paletteWorktreeIndex, worktreeId, hostId),
    [paletteWorktreeIndex]
  )
  const { worktreeMap, worktreeOrder } = useMemo(
    () => buildWorktreeJumpPaletteWorktreeMaps(browserSortedWorktrees),
    [browserSortedWorktrees]
  )
  const checksReviewByWorktree = useMemo(
    () =>
      buildWorktreeChecksReviewIndex({
        worktrees: workspaces,
        repoByHostIdentity,
        prCache,
        hostedReviewCache,
        settings
      }),
    [workspaces, hostedReviewCache, prCache, repoByHostIdentity, settings]
  )
  const worktreeDocuments = useMemo(
    () =>
      buildWorktreeJumpPaletteDocumentIndex({
        worktrees: workspaces,
        repoMap,
        repoByHostIdentity,
        hostOptions,
        hostFilterActive,
        prCache,
        issueCache,
        workspacePortScan,
        checksReviewByWorktree
      }),
    [
      workspaces,
      checksReviewByWorktree,
      hostFilterActive,
      hostOptions,
      issueCache,
      prCache,
      repoByHostIdentity,
      repoMap,
      workspacePortScan
    ]
  )
  const worktreeMatches = useMemo(
    () =>
      searchWorktreeDocuments({
        worktrees: sortedWorktrees,
        query: paletteSearchQuery,
        documents: worktreeDocuments,
        repoMap,
        repoMapByHostIdentity: repoByHostIdentity,
        checksReviewByWorktree,
        context: paletteSearchContext
      }),
    [
      checksReviewByWorktree,
      paletteSearchQuery,
      paletteSearchContext,
      repoByHostIdentity,
      repoMap,
      sortedWorktrees,
      worktreeDocuments
    ]
  )
  return {
    hasQuery,
    isLoading,
    visibleWorktreesForState,
    switchableWorktreesForRows,
    searchScopeWorktrees,
    browserSortedWorktrees,
    worktreeMap,
    resolveWorktree,
    paletteWorktreeIndex,
    worktreeOrder,
    worktreeMatches
  }
}

export type WorktreeJumpPaletteWorktrees = ReturnType<typeof useWorktreeJumpPaletteWorktrees>
