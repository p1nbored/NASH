/**
 * The owner of a workspace as a {@link HostAuthority}, decided from the rows alone. It never reads
 * the "Active Server" focus setting.
 */
import {
  getRepoSshConnectionId,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '@/store/slices/worktree-helpers'
import { findIndexedRepoOwnerForHost } from './worktree-runtime-owner-index'
import {
  hostAuthorityFromOperationRoute,
  SELF_LOCAL_AUTHORITY,
  type HostAuthority
} from '../../../shared/host-authority'
import type { ExecutionHostOwnerMatch } from '../../../shared/worktree-execution-host-resolution'
import {
  getFloatingWorkspaceOperationRoute,
  resolveStrictWorktreeOperationRouteResultForHost,
  resolveWorktreeOperationRouteResult,
  type WorktreeOperationRouteResolution,
  type WorktreeOperationRouteState
} from './worktree-operation-route'
import { getNestedSshTargetIdForFolderWorkspace } from './folder-workspace-runtime-owner'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { hostRouteForAuthority } from '@/runtime/runtime-client-target'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'

/** A worktree id, a `folder:` workspace key, or the floating workspace; `hostId` when the row names one. */
export type WorkspaceOwnerRef = { workspaceId: string; hostId?: ExecutionHostId }

function toOwnerMatch(
  resolution: WorktreeOperationRouteResolution
): ExecutionHostOwnerMatch<HostAuthority> {
  if (resolution.kind !== 'resolved') {
    return resolution
  }
  const authority = hostAuthorityFromOperationRoute(resolution.route)
  if (authority === 'contradictory') {
    return { kind: 'ambiguous' }
  }
  return authority ? { kind: 'resolved', owner: authority } : { kind: 'missing' }
}

function resolveRoute(
  state: WorktreeOperationRouteState,
  ref: WorkspaceOwnerRef
): ExecutionHostOwnerMatch<HostAuthority> {
  if (getFloatingWorkspaceOperationRoute(ref.workspaceId)) {
    return { kind: 'resolved', owner: SELF_LOCAL_AUTHORITY }
  }
  const hostId =
    ref.hostId ??
    (state.activeWorktreeId === ref.workspaceId ? state.activeWorkspaceExecutionHostId : null)
  // Why strict: rival servers proxying the same `ssh:t` must not read as a directly dialed target.
  const match = toOwnerMatch(
    hostId
      ? resolveStrictWorktreeOperationRouteResultForHost(state, ref.workspaceId, hostId)
      : resolveWorktreeOperationRouteResult(state, ref.workspaceId)
  )
  return match.kind === 'resolved'
    ? { kind: 'resolved', owner: withNestedPlace(state, ref, match.owner) }
    : match
}

/**
 * A route names only the server; the owning folder or repo row's `connectionId` is the SSH target
 * behind it, the same reading `resolveWorktreeExecutionHost` applies.
 */
function withNestedPlace(
  state: WorktreeOperationRouteState,
  ref: WorkspaceOwnerRef,
  authority: HostAuthority
): HostAuthority {
  if (authority.endpoint.kind !== 'environment' || authority.at !== 'local') {
    return authority
  }
  const scope = parseWorkspaceKey(ref.workspaceId)
  const targetId =
    scope?.type === 'folder'
      ? getNestedSshTargetIdForFolderWorkspace(state, scope.folderWorkspaceId, ref.hostId)
      : nestedRepoTargetId(state, ref.workspaceId, authority.endpoint.environmentId)
  return targetId ? { ...authority, at: toSshExecutionHostId(targetId) } : authority
}

function nestedRepoTargetId(
  state: WorktreeOperationRouteState,
  worktreeId: string,
  environmentId: string
): string | null {
  const repo = findIndexedRepoOwnerForHost(
    state.repos,
    getRepoIdFromWorktreeId(worktreeId),
    toRuntimeExecutionHostId(environmentId)
  )
  return repo ? getRepoSshConnectionId(repo) : null
}

export function resolveOwner(
  state: WorktreeOperationRouteState,
  ref: WorkspaceOwnerRef
): ExecutionHostOwnerMatch<HostAuthority> {
  // Why: focus is the only settings field the route resolvers read; blanking it makes this focus-free.
  return resolveRoute({ ...state, settings: null }, ref)
}

/** Transport to the workspace's owner, or `null` when the rows name none or disagree. */
export function runtimeTargetForWorkspaceOwner(
  state: WorktreeOperationRouteState,
  ref: WorkspaceOwnerRef
): RuntimeClientTarget | null {
  const match = resolveOwner(state, ref)
  return match.kind === 'resolved' ? hostRouteForAuthority(match.owner).target : null
}
