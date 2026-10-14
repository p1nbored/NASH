import { tryRuntimeTargetForWorktreeOwner } from './worktree-owner-target'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeMeta } from '../../../../../../shared/worktree/meta-types'
import { getRepoIdFromWorktreeId } from '../../worktree-helpers'
import { isRuntimeSelectorNotFoundError } from './runtime-worktree-rpc-errors'
import { persistWorktreeMeta } from '../metadata/worktree-meta-persist'
import type { WorktreeSliceGet } from './worktree-slice-types'

export function replaceWorktreeInRepoLists(
  worktreesByRepo: Record<string, Worktree[]>,
  updatedWorktree: Worktree
): Record<string, Worktree[]> {
  const repoId = getRepoIdFromWorktreeId(updatedWorktree.id)
  const current = worktreesByRepo[repoId]
  if (!current) {
    return worktreesByRepo
  }
  return {
    ...worktreesByRepo,
    [repoId]: current.map((worktree) =>
      worktree.id === updatedWorktree.id ? updatedWorktree : worktree
    )
  }
}

// Why: activity bumps fire on every PTY event, so an ambiguous workspace would warn continuously.
// One line per workspace is enough to diagnose it (#10634).
export const ambiguousOwnerWarnedWorktreeIds = new Set<string>()

/** Re-arms the once-per-workspace warning; called from every worktree teardown path. */
export function forgetAmbiguousOwnerWarnings(worktreeIds: Iterable<string>): void {
  for (const worktreeId of worktreeIds) {
    ambiguousOwnerWarnedWorktreeIds.delete(worktreeId)
  }
}

export function warnAmbiguousOwnerOnce(worktreeId: string, errorLabel: string): void {
  if (ambiguousOwnerWarnedWorktreeIds.has(worktreeId)) {
    return
  }
  ambiguousOwnerWarnedWorktreeIds.add(worktreeId)
  console.warn(`Skipped ${errorLabel}: workspace identity is ambiguous across hosts`, worktreeId)
}

export function persistPassiveWorktreeMetaForOwner(
  get: WorktreeSliceGet,
  worktreeId: string,
  updates: Partial<WorktreeMeta>,
  errorLabel: string
): void {
  const ownerTarget = tryRuntimeTargetForWorktreeOwner(get(), worktreeId)
  if (!ownerTarget) {
    warnAmbiguousOwnerOnce(worktreeId, errorLabel)
    return
  }
  void persistWorktreeMeta(ownerTarget, worktreeId, updates).catch((err) => {
    if (isRuntimeSelectorNotFoundError(err)) {
      void get().fetchWorktrees(getRepoIdFromWorktreeId(worktreeId))
      return
    }
    console.error(`Failed to ${errorLabel}:`, err)
    void get().fetchWorktrees(getRepoIdFromWorktreeId(worktreeId))
  })
}
