import { listWorktrees, listWorktreesStrict, removeWorktree } from '../orca-runtime-test-mocks.spec'
import type { WorktreeMeta } from '../orca-runtime-test-mocks.spec'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TEST_WORKTREE_ID, makeWorktreeMeta, store } from '../orca-runtime-test-fixtures.spec'
import { createWorktreeRemovalRuntime } from '../orca-runtime-test-scenario-builders.spec'
import type { ExecutionHostId } from '../../../shared/execution-host'

const REMOTE_REPO_PATH = '/remote/repo'

function makeRemoteRepoStore(
  executionHostId: ExecutionHostId,
  extraRepoFields: Record<string, unknown> = {},
  metaOverrides: Partial<WorktreeMeta> = {}
) {
  const repo = {
    ...store.getRepos()[0]!,
    path: REMOTE_REPO_PATH,
    executionHostId,
    ...extraRepoFields
  }
  const metaById: Record<string, WorktreeMeta> = {
    [TEST_WORKTREE_ID]: makeWorktreeMeta({ hostId: executionHostId, ...metaOverrides })
  }
  const removeWorktreeMeta = vi.fn((worktreeId: string, hostId?: string) => {
    if (!hostId || metaById[worktreeId]?.hostId === hostId) {
      delete metaById[worktreeId]
    }
  })
  return {
    repo,
    metaById,
    removeWorktreeMeta,
    runtimeStore: {
      ...store,
      getRepos: () => [repo],
      getRepo: (id: string) => (id === repo.id ? repo : undefined),
      getAllWorktreeMeta: () => metaById,
      getWorktreeMeta: (worktreeId: string) => metaById[worktreeId],
      setWorktreeMeta: (worktreeId: string, meta: Partial<WorktreeMeta>) => {
        metaById[worktreeId] = { ...(metaById[worktreeId] ?? makeWorktreeMeta()), ...meta }
        return metaById[worktreeId]
      },
      removeWorktreeMeta
    }
  }
}

describe('OrcaRuntimeService worktree removal execution host', () => {
  beforeEach(() => {
    vi.mocked(listWorktrees).mockClear()
    vi.mocked(listWorktreesStrict).mockClear()
    vi.mocked(removeWorktree).mockClear()
  })

  it('refuses an SSH row whose host is unreachable instead of deleting here', async () => {
    const { runtimeStore, metaById } = makeRemoteRepoStore('ssh:target-a')
    const runtime = createWorktreeRemovalRuntime(runtimeStore)

    await expect(
      runtime.removeManagedWorktree(TEST_WORKTREE_ID, {
        force: true,
        runHooks: false,
        allowUnverifiedPtyStop: false,
        hostId: 'ssh:target-a'
      })
    ).rejects.toThrow('Remote connection dropped')

    expect(listWorktreesStrict).not.toHaveBeenCalled()
    expect(removeWorktree).not.toHaveBeenCalled()
    expect(metaById[TEST_WORKTREE_ID]).toBeDefined()
  })

  it('refuses a runtime row with no nested SSH target rather than deleting locally', async () => {
    const { runtimeStore, metaById } = makeRemoteRepoStore('runtime:env-1')
    const runtime = createWorktreeRemovalRuntime(runtimeStore)

    await expect(
      runtime.removeManagedWorktree(TEST_WORKTREE_ID, {
        force: true,
        runHooks: false,
        allowUnverifiedPtyStop: false,
        hostId: 'runtime:env-1'
      })
    ).rejects.toThrow('not dispatched by this process')

    expect(listWorktreesStrict).not.toHaveBeenCalled()
    expect(removeWorktree).not.toHaveBeenCalled()
    expect(metaById[TEST_WORKTREE_ID]).toBeDefined()
  })

  it('refuses a runtime row that also names a nested SSH target', async () => {
    // `connectionId: 'target-a'` names a target inside env-1, never one on this machine.
    const { runtimeStore, metaById } = makeRemoteRepoStore('runtime:env-1', {
      connectionId: 'target-a'
    })
    const runtime = createWorktreeRemovalRuntime(runtimeStore)

    await expect(
      runtime.removeManagedWorktree(TEST_WORKTREE_ID, {
        force: true,
        runHooks: false,
        allowUnverifiedPtyStop: false,
        hostId: 'runtime:env-1'
      })
    ).rejects.toThrow('not dispatched by this process')

    expect(removeWorktree).not.toHaveBeenCalled()
    expect(metaById[TEST_WORKTREE_ID]).toBeDefined()
  })
})
