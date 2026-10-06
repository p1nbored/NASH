import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Project, ProjectHostSetup } from '../../shared/project-types'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { GlobalWindowsRuntimeDefault } from '../../shared/project-execution-runtime'
import { LOCAL_EXECUTION_HOST_ID, normalizeExecutionHostId } from '../../shared/execution-host'
import {
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import { isWslUncPath } from '../../shared/wsl-paths'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../shared/workspace-scope'
import {
  getRepoMainWorktreeId,
  splitWorktreeId,
  splitWorktreeIdForFilesystem,
  worktreeIdsEqual
} from '../../shared/worktree/id'
import {
  findExactRepoOwner,
  resolveRepoOwnershipEvidence,
  type RepoOwnerFields
} from '../ipc/worktrees/listing/worktree-host-ownership'
import { OrchestrationError } from './orchestration/orchestration-error'

export type WorkbenchLocalWorkspaceStore = {
  getRepos(): readonly Repo[]
  getProjects?: () => readonly Project[]
  getProjectHostSetups?: () => readonly ProjectHostSetup[]
  getProjectGroups?: () => readonly ProjectGroup[]
  getFolderWorkspaces?: () => readonly FolderWorkspace[]
  getSettings?: () => { localWindowsRuntimeDefault?: GlobalWindowsRuntimeDefault }
  getAllWorktreeMetaForHost?: (
    hostId: typeof LOCAL_EXECUTION_HOST_ID
  ) => Record<string, WorktreeMeta>
}

export type WorkbenchLocalWorkspace = {
  workspaceId: string
  projectId: string
  projectKind: 'project' | 'folder-group'
  hostId: typeof LOCAL_EXECUTION_HOST_ID
  path: string
}

type OwnerKind = 'local' | 'unsupported' | 'invalid'

const isOptionalText = (value: unknown): boolean => value == null || typeof value === 'string'

// Why: Orca's resolver trims these fields, so a corrupt non-string value is refused before it runs.
function ownerKind(row: RepoOwnerFields): OwnerKind {
  if (!isOptionalText(row.executionHostId) || !isOptionalText(row.connectionId)) {
    return 'invalid'
  }
  const evidence = resolveRepoOwnershipEvidence(row)
  if (evidence.status !== 'owned') {
    return 'invalid'
  }
  return evidence.hostId === LOCAL_EXECUTION_HOST_ID ? 'local' : 'unsupported'
}

function unavailable(): never {
  throw new OrchestrationError(
    'workbench_workspace_unavailable',
    'The workspace has no unambiguous registered local owner.'
  )
}

function unsupported(): never {
  throw new OrchestrationError(
    'unsupported_host',
    'Workbench intake currently supports native local workspaces only.'
  )
}

function requireLocalOwner(row: RepoOwnerFields): void {
  const owner = ownerKind(row)
  if (owner === 'unsupported') {
    unsupported()
  }
  if (owner !== 'local') {
    unavailable()
  }
}

/** Orca's exact-owner rule over one snapshot of the same-ID rows; nonlocal-only rows are unsupported. */
function requireLocalRepoOwner(repos: readonly Repo[], repoId: string): Repo {
  const kinds = repos.map(ownerKind)
  if (kinds.includes('invalid')) {
    unavailable()
  }
  const owner = findExactRepoOwner({ getRepos: () => repos }, repoId, LOCAL_EXECUTION_HOST_ID)
  if (owner) {
    return owner
  }
  if (repos.length > 0 && kinds.every((kind) => kind === 'unsupported')) {
    unsupported()
  }
  unavailable()
}

function requireNativePath(path: string): void {
  if (isWslUncPath(path)) {
    unsupported()
  }
  if (!path || !isRuntimePathAbsolute(path)) {
    unavailable()
  }
}

function requireNativeProjectRuntime(store: WorkbenchLocalWorkspaceStore, project?: Project): void {
  if (process.platform !== 'win32') {
    return
  }
  const preference = project?.localWindowsRuntimePreference
  if (preference?.kind === 'wsl') {
    unsupported()
  }
  if (
    preference?.kind !== 'windows-host' &&
    store.getSettings?.().localWindowsRuntimeDefault?.kind === 'wsl'
  ) {
    unsupported()
  }
}

function requireFolderWorkspace(
  store: WorkbenchLocalWorkspaceStore,
  id: string
): WorkbenchLocalWorkspace {
  const folders = store.getFolderWorkspaces?.().filter((row) => row.id === id) ?? []
  if (folders.length !== 1) {
    unavailable()
  }
  const folder = folders[0]
  requireLocalOwner(folder)
  requireNativePath(folder.folderPath)
  const groups = store.getProjectGroups?.() ?? []
  const owners = groups.filter((row) => row.id === folder.projectGroupId)
  if (!folder.projectGroupId || owners.length !== 1) {
    unavailable()
  }
  const seen = new Set<string>()
  let group: ProjectGroup | undefined = owners[0]
  while (group) {
    if (seen.has(group.id)) {
      unavailable()
    }
    seen.add(group.id)
    requireLocalOwner(group)
    if (group.parentPath && isWslUncPath(group.parentPath)) {
      unsupported()
    }
    if (!group.parentGroupId) {
      break
    }
    const parentId = group.parentGroupId
    const parents = groups.filter((row) => row.id === parentId)
    if (parents.length !== 1) {
      unavailable()
    }
    group = parents[0]
  }
  requireNativeProjectRuntime(store)
  return {
    workspaceId: folderWorkspaceKey(folder.id),
    projectId: folder.projectGroupId,
    projectKind: 'folder-group',
    hostId: LOCAL_EXECUTION_HOST_ID,
    path: folder.folderPath
  }
}

function requireRepoProject(store: WorkbenchLocalWorkspaceStore, repo: Repo): Project {
  const projects = store.getProjects?.().filter((row) => row.sourceRepoIds.includes(repo.id)) ?? []
  if (projects.length !== 1) {
    unavailable()
  }
  const project = projects[0]
  if (!project.id) {
    unavailable()
  }
  if (store.getProjectHostSetups) {
    const setups = store
      .getProjectHostSetups()
      .filter(
        (row) =>
          row.repoId === repo.id && normalizeExecutionHostId(row.hostId) === LOCAL_EXECUTION_HOST_ID
      )
    if (setups.length !== 1) {
      unavailable()
    }
    const setup = setups[0]
    requireLocalOwner(setup)
    requireNativePath(setup.path)
    if (
      setup.projectId !== project.id ||
      setup.setupState !== 'ready' ||
      normalizeRuntimePathForComparison(setup.path) !== normalizeRuntimePathForComparison(repo.path)
    ) {
      unavailable()
    }
  }
  requireNativeProjectRuntime(store, project)
  return project
}

/** Admission reads persisted catalogs only; later dispatch must revalidate ownership and capability. */
export function requireLocalWorkbenchWorkspace(
  store: WorkbenchLocalWorkspaceStore,
  workspaceId: string
): WorkbenchLocalWorkspace {
  if (!workspaceId || workspaceId.trim() !== workspaceId) {
    unavailable()
  }
  const scope = parseWorkspaceKey(workspaceId)
  if (scope?.type === 'folder') {
    return requireFolderWorkspace(store, scope.folderWorkspaceId)
  }
  const requestedId = scope?.type === 'worktree' ? scope.worktreeId : workspaceId
  const parsed = splitWorktreeId(requestedId)
  if (!parsed?.repoId || !parsed.worktreePath) {
    unavailable()
  }
  const repos = store.getRepos().filter((row) => row.id === parsed.repoId)
  const repo = requireLocalRepoOwner(repos, parsed.repoId)
  requireNativePath(repo.path)
  const project = requireRepoProject(store, repo)
  const mainId = getRepoMainWorktreeId(repo)
  if (worktreeIdsEqual(mainId, requestedId)) {
    return {
      workspaceId: mainId,
      projectId: project.id,
      projectKind: 'project',
      hostId: LOCAL_EXECUTION_HOST_ID,
      path: repo.path
    }
  }
  const matches = Object.entries(
    store.getAllWorktreeMetaForHost?.(LOCAL_EXECUTION_HOST_ID) ?? {}
  ).filter(([id]) => worktreeIdsEqual(id, requestedId))
  if (matches.length !== 1) {
    unavailable()
  }
  const [canonicalId, meta] = matches[0]
  if (meta.hostId != null) {
    const hostId = normalizeExecutionHostId(meta.hostId)
    if (hostId && hostId !== LOCAL_EXECUTION_HOST_ID) {
      unsupported()
    }
    if (hostId !== LOCAL_EXECUTION_HOST_ID) {
      unavailable()
    }
  } else if (repos.some((row) => ownerKind(row) !== 'local')) {
    unavailable()
  }
  if (meta.projectId != null && meta.projectId !== project.id) {
    unavailable()
  }
  if (meta.projectHostSetupId != null) {
    const setups =
      store.getProjectHostSetups?.().filter((row) => row.id === meta.projectHostSetupId) ?? []
    if (
      setups.length !== 1 ||
      setups[0].projectId !== project.id ||
      setups[0].repoId !== repo.id ||
      normalizeExecutionHostId(setups[0].hostId) !== LOCAL_EXECUTION_HOST_ID
    ) {
      unavailable()
    }
  }
  const path = splitWorktreeIdForFilesystem(canonicalId)?.worktreePath
  if (!path) {
    unavailable()
  }
  requireNativePath(path)
  return {
    workspaceId: canonicalId,
    projectId: project.id,
    projectKind: 'project',
    hostId: LOCAL_EXECUTION_HOST_ID,
    path
  }
}
