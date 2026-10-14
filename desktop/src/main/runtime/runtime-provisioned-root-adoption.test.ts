import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import {
  adoptRuntimeProvisionedRoot,
  type RuntimeProvisionedRootPorts
} from './runtime-provisioned-root-adoption'

const root = '/workspace/repo'
const repo: Repo = {
  id: 'repo-vm',
  path: root,
  displayName: 'repo',
  badgeColor: '#000',
  addedAt: 1
}

function checkout(overrides: Partial<GitWorktreeInfo> = {}): GitWorktreeInfo {
  return {
    path: root,
    head: 'abc123',
    branch: 'refs/heads/fix-login',
    isBare: false,
    isMainWorktree: true,
    ...overrides
  }
}

function ports(worktrees: GitWorktreeInfo[], sparse = false) {
  const setWorktreeMeta = vi.fn()
  const notifyChanged = vi.fn()
  const value: RuntimeProvisionedRootPorts = {
    store: {
      getSettings: () => ({ workspaceDir: '/workspaces', nestWorkspaces: false }),
      setWorktreeMeta
    },
    resolveRepo: async () => repo,
    listWorktrees: async () => worktrees,
    isSparseCheckoutEnabled: async () => sparse,
    invalidateScan: vi.fn(),
    notifyChanged,
    showWorktree: async (selector) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: adoption only returns the row it was handed; no Worktree field is read.
      ({ id: selector.slice('id:'.length), repoId: repo.id, path: root }) as never
  }
  return { value, setWorktreeMeta, notifyChanged }
}

describe('adoptRuntimeProvisionedRoot', () => {
  it('adopts the primary checkout as the workspace and records it as provisioned-root', async () => {
    const { value, setWorktreeMeta, notifyChanged } = ports([checkout()])
    const result = await adoptRuntimeProvisionedRoot(
      'repo-vm',
      { name: 'fix-login', baseBranch: 'main', expectedPath: root, expectedRefHead: 'abc123' },
      value
    )
    expect(result.worktree.id).toBe(`repo-vm::${root}`)
    expect(setWorktreeMeta).toHaveBeenCalledWith(
      `repo-vm::${root}`,
      expect.objectContaining({
        ephemeralVmCheckoutMode: 'provisioned-root',
        displayName: 'fix-login',
        orcaCreationSource: 'runtime',
        baseRef: 'main'
      })
    )
    expect(setWorktreeMeta.mock.calls[0][1]).not.toHaveProperty('hostId')
    expect(notifyChanged).toHaveBeenCalledWith('repo-vm')
  })

  it.each<[string, GitWorktreeInfo[], boolean, string]>([
    ['another branch', [checkout({ branch: 'refs/heads/other' })], false, 'requested branch'],
    ['another ref', [checkout({ head: 'def456' })], false, 'requested ref'],
    ['a linked worktree', [checkout({ isMainWorktree: false })], false, 'primary checkout'],
    ['a sparse checkout', [checkout()], true, 'sparse checkout']
  ])('refuses %s and records nothing', async (_label, worktrees, sparse, message) => {
    const { value, setWorktreeMeta } = ports(worktrees, sparse)
    await expect(
      adoptRuntimeProvisionedRoot(
        'repo-vm',
        { name: 'fix-login', expectedPath: root, expectedRefHead: 'abc123' },
        value
      )
    ).rejects.toThrow(message)
    expect(setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses a project whose root is not the recipe root', async () => {
    const { value } = ports([checkout()])
    await expect(
      adoptRuntimeProvisionedRoot('repo-vm', { name: 'fix-login', expectedPath: '/other' }, value)
    ).rejects.toThrow('does not match')
  })
})
