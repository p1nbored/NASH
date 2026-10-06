import { describe, expect, it } from 'vitest'
import { DotWorkspaceLabelSchema } from '../../../../shared/dot-ingress/dot-ingress-request'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  dotWorkspaceLabel,
  dotWorkspacePath,
  listDotWorkspaceCandidates,
  type DotWorkspaceCandidateState
} from './dot-workspace-candidates'

function repo(id: string, displayName: string, extra: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `C:/fixtures/${displayName}`,
    displayName,
    badgeColor: '#000000',
    addedAt: 0,
    ...extra
  }
}

function worktree(repoId: string, branch: string, extra: Partial<Worktree> = {}): Worktree {
  const path = `C:/fixtures/${repoId}/${branch.replaceAll('/', '-')}`
  return {
    id: `${repoId}::${path}`,
    repoId,
    path,
    head: '0'.repeat(40),
    branch,
    isBare: false,
    isMainWorktree: false,
    displayName: branch,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0,
    ...extra
  }
}

function folder(id: string, name: string, extra: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id,
    projectGroupId: 'group-1',
    name,
    folderPath: `C:/fixtures/folders/${name}`,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...extra
  }
}

function state(overrides: Partial<DotWorkspaceCandidateState> = {}): DotWorkspaceCandidateState {
  return {
    repos: [repo('repo-a', 'autopilot'), repo('repo-b', 'field-notes')],
    worktreesByRepo: {
      'repo-a': [worktree('repo-a', 'main'), worktree('repo-a', 'feature/evidence')],
      'repo-b': [worktree('repo-b', 'main')]
    },
    folderWorkspaces: [folder('folder-1', 'Research notes')],
    projectGroups: [],
    ...overrides
  }
}

describe('dotWorkspaceLabel', () => {
  it('keeps a plain name', () => {
    expect(dotWorkspaceLabel('autopilot: main')).toBe('autopilot: main')
  })

  it('replaces path separators so dot never sees a path-like label', () => {
    const label = dotWorkspaceLabel('autopilot: feature/evidence\\x')
    expect(label).toBe('autopilot: feature-evidence-x')
    expect(DotWorkspaceLabelSchema.safeParse(label).success).toBe(true)
  })

  it('flattens control characters and line breaks', () => {
    const label = dotWorkspaceLabel('a\tb\nc\u2028d\u0007e')
    expect(label).toBe('a b c d e')
    expect(DotWorkspaceLabelSchema.safeParse(label).success).toBe(true)
  })

  it('cuts at 120 code units without splitting a surrogate pair', () => {
    const label = dotWorkspaceLabel(`${'x'.repeat(119)}\u{1F600}tail`)
    expect(label.length).toBeLessThanOrEqual(120)
    expect(label).toBe('x'.repeat(119))
    expect(DotWorkspaceLabelSchema.safeParse(label).success).toBe(true)
  })

  it('falls back to a fixed name when nothing printable is left', () => {
    expect(dotWorkspaceLabel(' / \n ')).toBe('-')
    expect(dotWorkspaceLabel('\n\t ')).toBe('Workspace')
  })

  it('removes invisible, bidi, tag, private-use and lone surrogate characters', () => {
    expect(dotWorkspaceLabel('a‮b​c\u{E0041}de\uD800f⁦g')).toBe('abcdefg')
    expect(dotWorkspaceLabel('​‮\u{E0049}')).toBe('Workspace')
  })
})

describe('dotWorkspacePath', () => {
  it('shows the path part of a worktree id and nothing for a folder key', () => {
    expect(dotWorkspacePath('repo-a::C:/fixtures/repo-a/main')).toBe('C:/fixtures/repo-a/main')
    expect(dotWorkspacePath('folder:folder-1')).toBeNull()
  })
})

describe('listDotWorkspaceCandidates', () => {
  it('lists local worktrees with their repository name and local folder workspaces, by name', () => {
    const candidates = listDotWorkspaceCandidates(state(), [])
    expect(candidates.map((entry) => entry.label)).toEqual([
      'autopilot: feature-evidence',
      'autopilot: main',
      'field-notes: main',
      'Research notes'
    ])
    expect(candidates.find((entry) => entry.label === 'Research notes')?.workspaceId).toBe(
      'folder:folder-1'
    )
    expect(candidates[0]).toMatchObject({
      workspaceId: 'repo-a::C:/fixtures/repo-a/feature-evidence',
      path: 'C:/fixtures/repo-a/feature-evidence'
    })
  })

  it('leaves out workspaces already in the dot list', () => {
    const candidates = listDotWorkspaceCandidates(state(), [
      { workspaceId: 'repo-a::C:/fixtures/repo-a/main', label: 'autopilot: main' },
      { workspaceId: 'folder:folder-1', label: 'Research notes' }
    ])
    expect(candidates.map((entry) => entry.label)).toEqual([
      'autopilot: feature-evidence',
      'field-notes: main'
    ])
  })

  it('numbers labels that would repeat one dot already sees or another candidate', () => {
    const candidates = listDotWorkspaceCandidates(
      state({
        repos: [repo('repo-a', 'app'), repo('repo-b', 'app'), repo('repo-c', 'docs')],
        worktreesByRepo: {
          'repo-a': [worktree('repo-a', 'main')],
          'repo-b': [worktree('repo-b', 'main')],
          'repo-c': [worktree('repo-c', 'main')]
        },
        folderWorkspaces: []
      }),
      [{ workspaceId: 'folder:elsewhere', label: 'docs: main' }]
    )
    expect(candidates.map((entry) => entry.label)).toEqual([
      'app: main',
      'app: main (2)',
      'docs: main (2)'
    ])
  })

  it('keeps a numbered label within the 120-unit cap', () => {
    const long = 'x'.repeat(130)
    const candidates = listDotWorkspaceCandidates(
      state({
        repos: [repo('repo-a', long), repo('repo-b', long)],
        worktreesByRepo: {
          'repo-a': [worktree('repo-a', 'main')],
          'repo-b': [worktree('repo-b', 'main')]
        },
        folderWorkspaces: []
      }),
      []
    )
    const labels = candidates.map((entry) => entry.label)
    expect(new Set(labels).size).toBe(2)
    expect(labels[1]?.endsWith(' (2)')).toBe(true)
    for (const label of labels) {
      expect(DotWorkspaceLabelSchema.safeParse(label).success).toBe(true)
    }
  })

  it('leaves out archived and remote workspaces', () => {
    const candidates = listDotWorkspaceCandidates(
      state({
        repos: [
          repo('repo-a', 'autopilot'),
          repo('repo-b', 'field-notes', { connectionId: 'ssh-target-1' })
        ],
        worktreesByRepo: {
          'repo-a': [worktree('repo-a', 'main', { isArchived: true }), worktree('repo-a', 'dev')],
          'repo-b': [worktree('repo-b', 'main')]
        },
        folderWorkspaces: [
          folder('folder-1', 'Archived', { isArchived: true }),
          folder('folder-2', 'Remote', { connectionId: 'ssh-target-1' })
        ]
      }),
      []
    )
    expect(candidates.map((entry) => entry.label)).toEqual(['autopilot: dev'])
  })
})
