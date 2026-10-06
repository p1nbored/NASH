import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { Project, ProjectHostSetup } from '../../shared/project-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { getRepoMainWorktreeId } from '../../shared/worktree/id'
import {
  requireLocalWorkbenchWorkspace,
  type WorkbenchLocalWorkspaceStore
} from './workbench-local-workspace'

const repo: Repo = {
  id: 'repo',
  path: 'C:\\work\\repo',
  displayName: 'Repo',
  badgeColor: '',
  addedAt: 1
}
const project: Project = {
  id: 'project',
  displayName: 'Project',
  badgeColor: '',
  sourceRepoIds: ['repo'],
  createdAt: 1,
  updatedAt: 1
}
const group: ProjectGroup = {
  id: 'group',
  name: 'Group',
  parentPath: 'C:\\work',
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}
const folder: FolderWorkspace = {
  id: 'folder',
  projectGroupId: 'group',
  name: 'Folder',
  folderPath: 'C:\\work\\folder',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}
const metadata: WorktreeMeta = {
  displayName: 'Secondary',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1
}

function store(
  overrides: Partial<WorkbenchLocalWorkspaceStore> = {}
): WorkbenchLocalWorkspaceStore {
  return {
    getRepos: () => [repo],
    getProjects: () => [project],
    getProjectGroups: () => [group],
    getFolderWorkspaces: () => [folder],
    getSettings: () => ({}),
    ...overrides
  }
}

function expectCode(callback: () => unknown, code = 'workbench_workspace_unavailable'): void {
  expect(callback).toThrow(expect.objectContaining({ name: 'OrchestrationError', code }))
}

describe('requireLocalWorkbenchWorkspace', () => {
  it('admits the registered main worktree and canonicalizes Windows path spelling', () => {
    expect(requireLocalWorkbenchWorkspace(store(), 'worktree:repo::c:/WORK/REPO/')).toEqual({
      workspaceId: getRepoMainWorktreeId(repo),
      projectId: project.id,
      projectKind: 'project',
      hostId: 'local',
      path: repo.path
    })
  })

  it('keeps repository and POSIX path case exact', () => {
    expectCode(() => requireLocalWorkbenchWorkspace(store(), 'Repo::C:\\work\\repo'))
    const posix = { ...repo, path: '/work/Repo' }
    expectCode(() =>
      requireLocalWorkbenchWorkspace(store({ getRepos: () => [posix] }), 'repo::/work/repo')
    )
    expect(
      requireLocalWorkbenchWorkspace(store({ getRepos: () => [posix] }), 'repo::/work/Repo').path
    ).toBe('/work/Repo')
  })

  it('accepts exact folder keys and returns their persisted group identity', () => {
    expect(requireLocalWorkbenchWorkspace(store(), 'folder:folder')).toEqual({
      workspaceId: 'folder:folder',
      projectId: group.id,
      projectKind: 'folder-group',
      hostId: 'local',
      path: folder.folderPath
    })
    expectCode(() => requireLocalWorkbenchWorkspace(store(), 'folder:Folder'))
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store(),
        'folder:folder::workspace:11111111-1111-1111-1111-111111111111'
      )
    )
  })

  it('keeps separately registered folder instances distinct even at the same path', () => {
    const instance = { ...folder, id: 'folder::workspace:11111111-1111-1111-1111-111111111111' }
    const catalog = store({ getFolderWorkspaces: () => [folder, instance] })
    expect(requireLocalWorkbenchWorkspace(catalog, `folder:${instance.id}`).workspaceId).toBe(
      `folder:${instance.id}`
    )
    expect(requireLocalWorkbenchWorkspace(catalog, 'folder:folder').workspaceId).toBe(
      'folder:folder'
    )
  })

  it('never promotes an arbitrary path or selector to a registered workspace', () => {
    for (const id of [
      'repo::C:\\unregistered',
      'path:C:\\work\\repo',
      'active',
      'repo',
      ' C:\\work\\repo ',
      'folder:missing'
    ]) {
      expectCode(() => requireLocalWorkbenchWorkspace(store(), id))
    }
  })

  it('separates same-ID local and SSH repo owners', () => {
    const remote = { ...repo, path: '/remote/repo', connectionId: 'server' }
    const catalog = store({ getRepos: () => [remote, repo] })
    expect(requireLocalWorkbenchWorkspace(catalog, getRepoMainWorktreeId(repo)).hostId).toBe(
      'local'
    )
    expectCode(() => requireLocalWorkbenchWorkspace(catalog, getRepoMainWorktreeId(remote)))
    expectCode(
      () =>
        requireLocalWorkbenchWorkspace(
          store({ getRepos: () => [remote] }),
          getRepoMainWorktreeId(remote)
        ),
      'unsupported_host'
    )
  })

  it('uses only the optional local metadata snapshot and retains instance identity', () => {
    const id = 'repo::C:\\work\\shared::workspace:11111111-1111-1111-1111-111111111111'
    const snapshot = vi.fn(() => ({
      [id]: { ...metadata, hostId: 'local' as const, projectId: project.id }
    }))
    const catalog = store({ getAllWorktreeMetaForHost: snapshot })
    expect(requireLocalWorkbenchWorkspace(catalog, id)).toEqual({
      workspaceId: id,
      projectId: project.id,
      projectKind: 'project',
      hostId: 'local',
      path: 'C:\\work\\shared'
    })
    expect(snapshot).toHaveBeenCalledWith('local')
    expectCode(() => requireLocalWorkbenchWorkspace(catalog, 'repo::C:\\work\\shared'))
    expectCode(() => requireLocalWorkbenchWorkspace(catalog, id.replace('11111111', '22222222')))
  })

  it('rejects ambiguous hostless legacy metadata while accepting explicit local ownership', () => {
    const id = 'repo::C:\\work\\secondary'
    const remote = { ...repo, path: '/remote/repo', executionHostId: 'runtime:other' as const }
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({
          getRepos: () => [repo, remote],
          getAllWorktreeMetaForHost: () => ({ [id]: metadata })
        }),
        id
      )
    )
    expect(
      requireLocalWorkbenchWorkspace(
        store({
          getRepos: () => [repo, remote],
          getAllWorktreeMetaForHost: () => ({ [id]: { ...metadata, hostId: 'local' } })
        }),
        id
      ).workspaceId
    ).toBe(id)
  })

  it('rejects colliding native rows and metadata aliases', () => {
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({ getRepos: () => [repo, { ...repo }] }),
        getRepoMainWorktreeId(repo)
      )
    )
    const id = 'repo::C:\\work\\secondary'
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({
          getAllWorktreeMetaForHost: () => ({ [id]: metadata, 'repo::c:/work/SECONDARY': metadata })
        }),
        id
      )
    )
  })

  it.each(['runtime:host', 'ssh:server', 'not-a-host', ''])(
    'rejects nonlocal or malformed explicit owners %s',
    (executionHostId) => {
      const nonlocal: Repo = { ...repo, executionHostId: 'local' }
      Object.assign(nonlocal, { executionHostId })
      expectCode(
        () =>
          requireLocalWorkbenchWorkspace(
            store({ getRepos: () => [nonlocal] }),
            getRepoMainWorktreeId(repo)
          ),
        executionHostId.startsWith('runtime:') || executionHostId.startsWith('ssh:')
          ? 'unsupported_host'
          : 'workbench_workspace_unavailable'
      )
    }
  )

  it('rejects contradictory explicit local and SSH evidence', () => {
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({ getRepos: () => [{ ...repo, executionHostId: 'local', connectionId: 'remote' }] }),
        getRepoMainWorktreeId(repo)
      )
    )
  })

  it('refuses a local repo whose same-ID sibling has malformed ownership evidence', () => {
    const mainId = getRepoMainWorktreeId(repo)
    for (const sibling of [
      { ...repo, executionHostId: 'not-a-host' },
      { ...repo, executionHostId: '' },
      { ...repo, connectionId: '  ' },
      { ...repo, executionHostId: 'local' as const, connectionId: 'remote' }
    ]) {
      const catalog = store({ getRepos: () => [repo, Object.assign({ ...repo }, sibling)] })
      expectCode(() => requireLocalWorkbenchWorkspace(catalog, mainId))
    }
  })

  it('refuses corrupt non-string ownership fields without throwing a TypeError', () => {
    const mainId = getRepoMainWorktreeId(repo)
    for (const corrupt of [{ connectionId: 5 }, { executionHostId: 5 }, { connectionId: {} }]) {
      const sibling = Object.assign({ ...repo }, corrupt)
      expectCode(() => requireLocalWorkbenchWorkspace(store({ getRepos: () => [sibling] }), mainId))
      expectCode(() =>
        requireLocalWorkbenchWorkspace(store({ getRepos: () => [repo, sibling] }), mainId)
      )
    }
  })

  it('reports an SSH host that contradicts its connection as unavailable, not unsupported', () => {
    const mainId = getRepoMainWorktreeId(repo)
    const contradictory = { ...repo, executionHostId: 'ssh:other' as const, connectionId: 'server' }
    expectCode(() =>
      requireLocalWorkbenchWorkspace(store({ getRepos: () => [contradictory] }), mainId)
    )
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({
          getFolderWorkspaces: () => [
            { ...folder, executionHostId: 'ssh:other', connectionId: 'server' }
          ]
        }),
        'folder:folder'
      )
    )
    const consistent = { ...repo, executionHostId: 'ssh:server' as const, connectionId: 'server' }
    expectCode(
      () => requireLocalWorkbenchWorkspace(store({ getRepos: () => [consistent] }), mainId),
      'unsupported_host'
    )
  })

  it('reports same-ID repos that are all nonlocal as unsupported and any local owner as admitted', () => {
    const mainId = getRepoMainWorktreeId(repo)
    const ssh = { ...repo, path: '/remote/a', connectionId: 'server' }
    const runtime = { ...repo, path: '/remote/b', executionHostId: 'runtime:other' as const }
    expectCode(
      () => requireLocalWorkbenchWorkspace(store({ getRepos: () => [ssh, runtime] }), mainId),
      'unsupported_host'
    )
    expect(
      requireLocalWorkbenchWorkspace(store({ getRepos: () => [ssh, runtime, repo] }), mainId).path
    ).toBe(repo.path)
  })

  it('requires a unique persisted project and respects local host setup ownership', () => {
    expectCode(() =>
      requireLocalWorkbenchWorkspace(store({ getProjects: undefined }), getRepoMainWorktreeId(repo))
    )
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({ getProjects: () => [project, { ...project, id: 'other' }] }),
        getRepoMainWorktreeId(repo)
      )
    )
    const setup: ProjectHostSetup = {
      id: 'setup',
      projectId: project.id,
      hostId: 'local',
      repoId: repo.id,
      path: repo.path,
      displayName: 'Setup',
      setupState: 'ready',
      setupMethod: 'legacy-repo',
      createdAt: 1,
      updatedAt: 1
    }
    expect(
      requireLocalWorkbenchWorkspace(
        store({ getProjectHostSetups: () => [setup] }),
        getRepoMainWorktreeId(repo)
      ).projectId
    ).toBe(project.id)
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({ getProjectHostSetups: () => [{ ...setup, projectId: 'other' }] }),
        getRepoMainWorktreeId(repo)
      )
    )
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({ getProjectHostSetups: () => [{ ...setup, hostId: 'runtime:host' }] }),
        getRepoMainWorktreeId(repo)
      )
    )
  })

  it('refuses metadata attributed to another project or host', () => {
    const id = 'repo::C:\\work\\secondary'
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({ getAllWorktreeMetaForHost: () => ({ [id]: { ...metadata, projectId: 'other' } }) }),
        id
      )
    )
    expectCode(
      () =>
        requireLocalWorkbenchWorkspace(
          store({
            getAllWorktreeMetaForHost: () => ({ [id]: { ...metadata, hostId: 'ssh:remote' } })
          }),
          id
        ),
      'unsupported_host'
    )
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({
          getAllWorktreeMetaForHost: () => ({
            [id]: { ...metadata, projectHostSetupId: 'missing' }
          })
        }),
        id
      )
    )
  })

  it('checks folder and ancestor group ownership without falling back to local', () => {
    expectCode(
      () =>
        requireLocalWorkbenchWorkspace(
          store({ getFolderWorkspaces: () => [{ ...folder, executionHostId: 'runtime:host' }] }),
          'folder:folder'
        ),
      'unsupported_host'
    )
    expectCode(
      () =>
        requireLocalWorkbenchWorkspace(
          store({ getProjectGroups: () => [{ ...group, connectionId: 'server' }] }),
          'folder:folder'
        ),
      'unsupported_host'
    )
    expectCode(() =>
      requireLocalWorkbenchWorkspace(store({ getProjectGroups: () => [] }), 'folder:folder')
    )
    expectCode(() =>
      requireLocalWorkbenchWorkspace(
        store({ getProjectGroups: () => [{ ...group, parentGroupId: 'group' }] }),
        'folder:folder'
      )
    )
    expectCode(
      () =>
        requireLocalWorkbenchWorkspace(
          store({
            getProjectGroups: () => [
              { ...group, parentGroupId: 'parent' },
              { ...group, id: 'parent', connectionId: 'server' }
            ]
          }),
          'folder:folder'
        ),
      'unsupported_host'
    )
  })

  it('rejects WSL UNC paths without probing', () => {
    const wsl = { ...repo, path: '\\\\wsl.localhost\\Ubuntu\\home\\repo' }
    expectCode(
      () =>
        requireLocalWorkbenchWorkspace(
          store({ getRepos: () => [wsl] }),
          getRepoMainWorktreeId(wsl)
        ),
      'unsupported_host'
    )
    expectCode(
      () =>
        requireLocalWorkbenchWorkspace(
          store({ getFolderWorkspaces: () => [{ ...folder, folderPath: wsl.path }] }),
          'folder:folder'
        ),
      'unsupported_host'
    )
  })

  it.runIf(process.platform === 'win32')(
    'rejects effective WSL runtime choices without probing',
    () => {
      expectCode(
        () =>
          requireLocalWorkbenchWorkspace(
            store({
              getProjects: () => [
                { ...project, localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' } }
              ]
            }),
            getRepoMainWorktreeId(repo)
          ),
        'unsupported_host'
      )
      const defaults = store({
        getSettings: () => ({ localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' } })
      })
      expectCode(
        () => requireLocalWorkbenchWorkspace(defaults, getRepoMainWorktreeId(repo)),
        'unsupported_host'
      )
      expectCode(
        () => requireLocalWorkbenchWorkspace(defaults, 'folder:folder'),
        'unsupported_host'
      )
      expect(
        requireLocalWorkbenchWorkspace(
          store({
            ...defaults,
            getProjects: () => [
              { ...project, localWindowsRuntimePreference: { kind: 'windows-host' } }
            ]
          }),
          getRepoMainWorktreeId(repo)
        ).hostId
      ).toBe('local')
    }
  )

  it('never calls migrating getters, selectors, or execution services', () => {
    const forbidden = vi.fn(() => {
      throw new Error('Unexpected side effect')
    })
    const catalog = Object.assign(store(), {
      getRepo: forbidden,
      getWorktreeMeta: forbidden,
      getWorktreeMetaForHost: forbidden,
      resolveWorktreeSelector: forbidden,
      showManagedWorktree: forbidden
    })
    requireLocalWorkbenchWorkspace(catalog, getRepoMainWorktreeId(repo))
    requireLocalWorkbenchWorkspace(catalog, 'folder:folder')
    expect(forbidden).not.toHaveBeenCalled()
  })
})
