// FIXTURE_ONLY: a fake worktree port; no worktree, git process or CLI is created.
import { describe, expect, it, vi } from 'vitest'
import { AttemptWorktreeError, type AttemptWorktreePort } from './attempt-worktree'
import {
  placeAttempt,
  placementEvidence,
  placementFromEvidence,
  type AttemptPlacement
} from './attempt-workspace'
import type { ProcessAttemptPlan } from './process-executor-contract'

const WORKTREE = {
  worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task_0123456789ab-ctx_0123456789ab',
  branch: 'nash-task_0123456789ab-ctx_0123456789ab',
  path: 'C:/fixture/workspaces/nash-task_0123456789ab-ctx_0123456789ab',
  baseCommit: '0123456789abcdef0123456789abcdef01234567'
}

function plan(overrides: Partial<ProcessAttemptPlan> = {}): ProcessAttemptPlan {
  return {
    dispatchId: 'ctx_0123456789ab',
    runId: 'run_0123456789ab',
    taskId: 'task_0123456789ab',
    workspaceId: 'fixture-repo::C:/fixture/repo',
    access: 'workspace_write',
    cli: { model: 'gpt-6.1-sol', effort: 'max' },
    prompt: {
      taskId: 'task_0123456789ab',
      dispatchId: 'ctx_0123456789ab',
      objective: 'Fix the typo in the README.',
      expectedOutputs: [],
      acceptanceCriteria: [],
      constraints: []
    },
    ...overrides
  }
}

function port(create: AttemptWorktreePort['create'] = async () => WORKTREE) {
  return { create: vi.fn(create) }
}

describe('placeAttempt (D-025)', () => {
  it('runs a read-only attempt in the run worktree and creates no worktree', async () => {
    const worktrees = port()
    await expect(
      placeAttempt(worktrees, plan({ access: 'read_only' }), 'codex_cli', 'C:/fixture/repo')
    ).resolves.toEqual({
      ok: true,
      placed: { cwd: 'C:/fixture/repo', placement: { mode: 'run_workspace' } }
    })
    expect(worktrees.create).not.toHaveBeenCalled()
  })

  it('writes in the folder itself for a folder workspace, with no worktree and no refusal', async () => {
    const worktrees = port()
    await expect(
      placeAttempt(
        worktrees,
        plan({ workspaceId: 'folder:fixture-folder' }),
        'agy_cli',
        'C:/fixture/folder'
      )
    ).resolves.toEqual({
      ok: true,
      placed: { cwd: 'C:/fixture/folder', placement: { mode: 'folder' } }
    })
    expect(worktrees.create).not.toHaveBeenCalled()
  })

  it.each(['codex_cli', 'agy_cli'] as const)(
    'gives a %s write attempt in a git workspace its own new worktree as its working directory',
    async (executor) => {
      const worktrees = port()
      await expect(placeAttempt(worktrees, plan(), executor, 'C:/fixture/repo')).resolves.toEqual({
        ok: true,
        placed: { cwd: WORKTREE.path, placement: { mode: 'own_worktree', worktree: WORKTREE } }
      })
      expect(worktrees.create).toHaveBeenCalledExactlyOnceWith({
        runWorktreeId: 'fixture-repo::C:/fixture/repo',
        runWorktreePath: 'C:/fixture/repo',
        runId: 'run_0123456789ab',
        taskId: 'task_0123456789ab',
        dispatchId: 'ctx_0123456789ab',
        executor
      })
    }
  )

  it('refuses the start with the port reason code when the worktree cannot be created', async () => {
    const worktrees = port(async () => {
      throw new AttemptWorktreeError('create_failed')
    })
    await expect(placeAttempt(worktrees, plan(), 'codex_cli', 'C:/fixture/repo')).resolves.toEqual({
      ok: false,
      reason: 'task_worktree_create_failed'
    })
  })

  it('refuses with a generic code, never error text, when the port fails unexpectedly', async () => {
    const worktrees = port(async () => {
      throw new Error('C:/fixture/secret-path exploded')
    })
    await expect(placeAttempt(worktrees, plan(), 'agy_cli', 'C:/fixture/repo')).resolves.toEqual({
      ok: false,
      reason: 'task_worktree_failed'
    })
  })
})

describe('placement evidence', () => {
  const PLACEMENTS: readonly AttemptPlacement[] = [
    { mode: 'run_workspace' },
    { mode: 'folder' },
    { mode: 'own_worktree', worktree: WORKTREE }
  ]

  it.each(PLACEMENTS)('round-trips through the executor launch evidence (%o)', (placement) => {
    const evidence = { executor: 'codex_cli', ...placementEvidence(placement) }
    expect(placementFromEvidence(JSON.parse(JSON.stringify(evidence)))).toEqual(placement)
  })

  it('reads no placement from evidence written before D-025 or from a damaged record', () => {
    expect(placementFromEvidence(null)).toBeNull()
    expect(placementFromEvidence({ executor: 'codex_cli', entryFile: 'codex.js' })).toBeNull()
    expect(
      placementFromEvidence({ attemptWorkspace: { mode: 'own_worktree', branch: 'x' } })
    ).toBeNull()
  })
})
