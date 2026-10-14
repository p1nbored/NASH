import type {
  OrcadMigrationCatalogPayload,
  OrcadMigrationManifestSource
} from '../../../shared/orcad-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import type { OrcadMigrationTerminalScrollbackSnapshot } from '../../../shared/orcad-migration-scrollback'
import {
  extractSessionOwnersForTransfer,
  hasTransferredSessionState
} from '../../orca-profiles/profile-session-owner-transfer'
import type { TerminalScrollbackSnapshotStorage } from '../../terminal-scrollback-snapshots'
import {
  createOrcadMigrationSourceScope,
  orcadMigrationOwnerMatchesScope,
  orcadMigrationPartitionScope,
  unqualifyOrcadMigrationOwnerKey
} from './orcad-source-scope'
import {
  countUnrepresentableMarkdownState,
  countUnsupportedSessionState,
  projectDormantSessionFocus,
  projectSessionToDestination,
  transferableSleepingAgentSession
} from './orcad-source-workspace-session-eligibility'
import {
  collectOwnedTerminalTabIds,
  dropOrcadMigrationTerminalBindings
} from './orcad-source-workspace-session-layout'
import { mergeSessionFragments } from './orcad-source-workspace-session-fragments'
import { orcadMigrationSessionPartitions } from './orcad-source-session-partitions'
import {
  hasDuplicateOrcadMigrationScrollbackDescriptors,
  projectOrcadMigrationSessionScrollback
} from './orcad-source-scrollback-state'

export type OrcadMigrationSourceWorkspaceSessionInspection = {
  payload: WorkspaceSessionState | undefined
  snapshots: OrcadMigrationTerminalScrollbackSnapshot[]
  blockedCount: number
}

/** Fails closed: a session shape no collector expects blocks the move instead of failing connect. */
export function collectOrcadMigrationSourceWorkspaceSession(
  state: PersistedState,
  source: OrcadMigrationManifestSource,
  catalog: OrcadMigrationCatalogPayload,
  storage?: TerminalScrollbackSnapshotStorage
): OrcadMigrationSourceWorkspaceSessionInspection {
  try {
    return collectWorkspaceSession(state, source, catalog, storage)
  } catch (error) {
    console.warn('[migration] Unreadable workspace session blocks the move:', error)
    return { payload: undefined, snapshots: [], blockedCount: 1 }
  }
}

function collectWorkspaceSession(
  state: PersistedState,
  source: OrcadMigrationManifestSource,
  catalog: OrcadMigrationCatalogPayload,
  storage?: TerminalScrollbackSnapshotStorage
): OrcadMigrationSourceWorkspaceSessionInspection {
  const sourceScope = createOrcadMigrationSourceScope({ source, catalog, repos: state.repos })
  const fragments: WorkspaceSessionState[] = []
  const snapshots: OrcadMigrationTerminalScrollbackSnapshot[] = []
  let blockedCount = 0
  const partitions = orcadMigrationSessionPartitions(state, sourceScope).map(
    ([partitionId, session]) => {
      const scope = orcadMigrationPartitionScope(sourceScope, partitionId)
      return { session, scope, terminalTabIds: collectOwnedTerminalTabIds(session, scope) }
    }
  )
  const sourceTerminalTabIds = new Set(
    partitions.flatMap(({ terminalTabIds }) => [...terminalTabIds])
  )
  for (const { session, scope, terminalTabIds } of partitions) {
    const sourceHostPartition = scope.partitionHostId === scope.hostId
    blockedCount += countUnsupportedSessionState(
      session,
      scope,
      sourceHostPartition,
      terminalTabIds,
      sourceTerminalTabIds
    )
    blockedCount += countUnrepresentableMarkdownState(session, scope, sourceHostPartition)
    const fragment = extractSessionOwnersForTransfer(session, {
      mapOwnerKey: (ownerKey) =>
        orcadMigrationOwnerMatchesScope(ownerKey, scope)
          ? unqualifyOrcadMigrationOwnerKey(ownerKey)
          : null,
      mapWorktreeId: unqualifyOrcadMigrationOwnerKey,
      projectSessionFocus: sourceHostPartition
        ? ({ source, transferred, terminalTabIds }) =>
            projectDormantSessionFocus(source, transferred, scope, terminalTabIds)
        : undefined,
      projectSleepingAgentSession: (record) =>
        transferableSleepingAgentSession(record, session, scope, terminalTabIds)
          ? {
              ...structuredClone(record),
              worktreeId: unqualifyOrcadMigrationOwnerKey(record.worktreeId),
              connectionId: null
            }
          : null
    })
    if (!sourceHostPartition) {
      // Client focus is not host state, so the destination never carries it.
      fragment.activeWorktreeId = null
      delete fragment.activeWorkspaceKey
    }
    dropOrcadMigrationTerminalBindings(fragment)
    if (hasTransferredSessionState(fragment)) {
      const projected = projectOrcadMigrationSessionScrollback(
        projectSessionToDestination(fragment, scope),
        storage
      )
      blockedCount += projected.blockedCount
      snapshots.push(...projected.snapshots)
      fragments.push(projected.session)
    }
  }
  if (hasDuplicateOrcadMigrationScrollbackDescriptors(snapshots)) {
    blockedCount += 1
  }
  if (blockedCount > 0 || fragments.length === 0) {
    return { payload: undefined, snapshots: [], blockedCount }
  }
  const merged = mergeSessionFragments(fragments)
  return merged
    ? { payload: merged, snapshots, blockedCount: 0 }
    : { payload: undefined, snapshots: [], blockedCount: 1 }
}
