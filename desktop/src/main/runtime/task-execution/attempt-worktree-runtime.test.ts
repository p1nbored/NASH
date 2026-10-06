// FIXTURE_ONLY: a fake Orca runtime and a fake git; no worktree, git process or CLI is created.
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeManagedWorktreeCreateArgs } from '../runtime-managed-worktree-create-types'
import {
  AttemptWorktreeError,
  attemptWorktreeName,
  attemptWorktreeRefusal,
  type AttemptWorktreeRequest
} from './attempt-worktree'
import { createRuntimeAttemptWorktreePort, readHeadCommit } from './attempt-worktree-runtime'

const BASE = '0123456789abcdef0123456789abcdef01234567'
const RUN_WORKTREE = 'fixture-repo::C:/fixture/repo'
const TASK_PATH = 'C:/fixture/workspaces/nash-task_0123456789ab-ctx_0123456789ab'
const TASK_WORKTREE = `fixture-repo::${TASK_PATH}`

const REQUEST: AttemptWorktreeRequest = {
  runWorktreeId: RUN_WORKTREE,
  runWorktreePath: 'C:/fixture/repo',
  runId: 'run_0123456789ab',
  taskId: 'task_0123456789ab',
  dispatchId: 'ctx_0123456789ab',
  executor: 'codex_cli'
}

function harness(
  overrides: {
    create?: (args: RuntimeManagedWorktreeCreateArgs) => Promise<{
      worktree: { id: string; branch: string }
    }>
    heads?: Record<string, string>
    workspacePath?: (id: string) => string
  } = {}
) {
  const createManagedWorktree = vi.fn(
    overrides.create ??
      (async () => ({
        worktree: {
          id: TASK_WORKTREE,
          branch: 'refs/heads/nash-task_0123456789ab-ctx_0123456789ab'
        }
      }))
  )
  const heads = overrides.heads ?? { 'C:/fixture/repo': BASE, [TASK_PATH]: BASE }
  const readHead = vi.fn(async (path: string) => {
    const head = heads[path]
    if (head === undefined) {
      throw new Error('fatal: not a git repository')
    }
    return head
  })
  const workspacePath = vi.fn(
    overrides.workspacePath ??
      ((id: string) => {
        if (id !== TASK_WORKTREE) {
          throw new Error('workbench_workspace_unavailable')
        }
        return TASK_PATH
      })
  )
  const port = createRuntimeAttemptWorktreePort({
    runtime: { createManagedWorktree },
    workspacePath,
    readHead
  })
  return { port, createManagedWorktree, readHead, workspacePath }
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise
    return null
  } catch (error) {
    return error instanceof AttemptWorktreeError ? error.code : 'unexpected'
  }
}

describe('attempt worktree through the Orca runtime', () => {
  it('creates a new child worktree of the run worktree from its HEAD, with no agent, terminal or setup', async () => {
    const { port, createManagedWorktree } = harness()
    await port.create(REQUEST)
    expect(createManagedWorktree).toHaveBeenCalledTimes(1)
    const [args] = createManagedWorktree.mock.calls[0] ?? []
    expect(args).toMatchObject({
      repoSelector: 'id:fixture-repo',
      name: 'nash-task_0123456789ab-ctx_0123456789ab',
      baseBranch: BASE,
      activate: false,
      setupDecision: 'skip',
      runHooks: false,
      createdWithAgent: 'codex',
      lineage: { parentWorktree: `id:${RUN_WORKTREE}` }
    })
    for (const key of [
      'startupAgent',
      'startup',
      'startupPrompt',
      'startupDraft',
      'startupDraftPaste',
      'startupAgentArgs',
      'awaitTerminalProvisioning'
    ]) {
      expect(args).not.toHaveProperty(key)
    }
    expect(args?.comment).toContain('task_0123456789ab')
    expect(args?.comment).toContain('ctx_0123456789ab')
  })

  it('names the agy CLI as the agent the worktree was created for', async () => {
    const { port, createManagedWorktree } = harness()
    await port.create({ ...REQUEST, executor: 'agy_cli' })
    expect(createManagedWorktree.mock.calls[0]?.[0]).toMatchObject({
      createdWithAgent: 'antigravity'
    })
  })

  it('records the branch, the admitted local path and the base commit', async () => {
    const { port, workspacePath } = harness()
    await expect(port.create(REQUEST)).resolves.toEqual({
      worktreeId: TASK_WORKTREE,
      branch: 'nash-task_0123456789ab-ctx_0123456789ab',
      path: TASK_PATH,
      baseCommit: BASE
    })
    expect(workspacePath).toHaveBeenCalledWith(TASK_WORKTREE)
  })

  it('refuses before creating anything when the run worktree HEAD cannot be read', async () => {
    const { port, createManagedWorktree } = harness({ heads: {} })
    expect(await codeOf(port.create(REQUEST))).toBe('base_unavailable')
    expect(createManagedWorktree).not.toHaveBeenCalled()
  })

  it('refuses when Orca cannot create the worktree', async () => {
    const { port } = harness({
      create: async () => {
        throw new Error('Could not resolve a default base ref')
      }
    })
    expect(await codeOf(port.create(REQUEST))).toBe('create_failed')
  })

  it('refuses a created worktree the catalog does not admit as local (SSH, WSL or unknown)', async () => {
    const { port } = harness({
      workspacePath: () => {
        throw new Error('unsupported_host')
      }
    })
    expect(await codeOf(port.create(REQUEST))).toBe('not_local')
  })

  it('refuses a created worktree that does not start at the run worktree HEAD', async () => {
    const { port } = harness({
      heads: { 'C:/fixture/repo': BASE, [TASK_PATH]: 'f'.repeat(40) }
    })
    expect(await codeOf(port.create(REQUEST))).toBe('base_mismatch')
  })
})

describe('attempt worktree naming and refusals', () => {
  it('names the worktree after the task and the attempt, within git ref rules', () => {
    const name = attemptWorktreeName('task_0123456789ab', 'ctx_0123456789ab')
    expect(name).toBe('nash-task_0123456789ab-ctx_0123456789ab')
    expect(attemptWorktreeName('task_0123456789ab', 'ctx_0123456789ab')).toBe(name)
    expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  })

  it('folds any character git or a path would refuse into a dash', () => {
    expect(attemptWorktreeName('task x..y', 'ctx/1:~^')).toMatch(/^nash-task-x-y-ctx-1-?$/)
  })

  it('turns a port error into one reason code and anything else into a generic one', () => {
    expect(attemptWorktreeRefusal(new AttemptWorktreeError('create_failed'))).toBe(
      'task_worktree_create_failed'
    )
    expect(attemptWorktreeRefusal(new Error('C:/secret/path is gone'))).toBe('task_worktree_failed')
  })
})

describe('readHeadCommit', () => {
  it('asks git for the HEAD commit without optional locks and returns the full sha', async () => {
    const exec = vi.fn(async (_args: string[], _options: unknown) => ({
      stdout: `${BASE}\n`,
      stderr: ''
    }))
    await expect(readHeadCommit('C:/fixture/repo', exec)).resolves.toBe(BASE)
    const [args, options] = exec.mock.calls[0] ?? []
    expect(args).toEqual(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    expect(options).toMatchObject({ cwd: 'C:/fixture/repo', env: { GIT_OPTIONAL_LOCKS: '0' } })
  })

  it('rejects output that is not a commit id', async () => {
    const exec = vi.fn(async (_args: string[], _options: unknown) => ({
      stdout: 'HEAD\n',
      stderr: ''
    }))
    await expect(readHeadCommit('C:/fixture/repo', exec)).rejects.toThrow()
  })
})
