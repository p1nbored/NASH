// FIXTURE_ONLY: a fake git runner and a synthetic worktree; no git binary or repository is touched.
import { describe, expect, it, vi } from 'vitest'
import type { AttemptWorktree } from '../task-execution/attempt-worktree'
import { createAttemptWorktreeChangesReader } from './attempt-worktree-changes'
import type { GitExec } from './workspace-git-status'

const WORKTREE: AttemptWorktree = {
  worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task-1',
  branch: 'nash-task-1',
  path: 'C:/fixture/recorded/nash-task-1',
  baseCommit: '0123456789abcdef0123456789abcdef01234567'
}
const ADMITTED_PATH = 'C:/fixture/workspaces/nash-task-1'

type GitAnswers = { revList?: string; porcelain?: string; fail?: 'rev-list' | 'status' }

function fakeGit(answers: GitAnswers = {}) {
  const exec = vi.fn<GitExec>(async (args) => {
    const command = args.find((arg) => !arg.startsWith('-') && !arg.includes('=')) ?? ''
    if (answers.fail === command) {
      throw new Error('fixture git failure')
    }
    switch (command) {
      case 'rev-list':
        return { stdout: answers.revList ?? '2\n', stderr: '' }
      case 'status':
        return { stdout: answers.porcelain ?? '', stderr: '' }
      case 'rev-parse':
        return { stdout: `${ADMITTED_PATH}\n`, stderr: '' }
      case 'log':
        return { stdout: '1700000000\n', stderr: '' }
      default:
        throw new Error(`unexpected git ${args.join(' ')}`)
    }
  })
  return exec
}

function reader(exec: GitExec, resolvePath = vi.fn(async () => ADMITTED_PATH)) {
  return { read: createAttemptWorktreeChangesReader({ resolvePath, exec }), resolvePath }
}

describe('attempt worktree changes', () => {
  it('counts the commits past the base and finds no uncommitted change', async () => {
    const exec = fakeGit()
    const { read, resolvePath } = reader(exec)
    expect(await read(WORKTREE)).toEqual({ readable: true, commitsAhead: 2, uncommitted: false })
    expect(resolvePath).toHaveBeenCalledWith(WORKTREE.worktreeId)
    const revList = exec.mock.calls.find(([args]) => args[0] === 'rev-list')
    expect(revList?.[0]).toEqual(['rev-list', '--count', `${WORKTREE.baseCommit}..HEAD`])
    expect(revList?.[1]).toMatchObject({ cwd: ADMITTED_PATH })
    expect(revList?.[1].env.GIT_OPTIONAL_LOCKS).toBe('0')
  })

  it('reads the status with the fsmonitor hook and optional locks off, in the admitted path', async () => {
    const exec = fakeGit({ porcelain: ' M report.md\u0000?? notes.md\u0000' })
    const { read } = reader(exec)
    expect(await read(WORKTREE)).toEqual({ readable: true, commitsAhead: 2, uncommitted: true })
    const status = exec.mock.calls.find(([args]) => args.includes('status'))
    expect(status?.[0].slice(0, 3)).toEqual(['-c', 'core.fsmonitor=', 'status'])
    expect(status?.[1]).toMatchObject({ cwd: ADMITTED_PATH })
    expect(status?.[1].env.GIT_OPTIONAL_LOCKS).toBe('0')
    expect(exec.mock.calls.every(([, options]) => options.cwd === ADMITTED_PATH)).toBe(true)
  })

  it('reports no commits and no changes as readable facts', async () => {
    const { read } = reader(fakeGit({ revList: '0\n' }))
    expect(await read(WORKTREE)).toEqual({ readable: true, commitsAhead: 0, uncommitted: false })
  })

  it.each([
    ['the catalog no longer admits the worktree', async () => null],
    [
      'the catalog lookup throws',
      async (): Promise<string | null> => {
        throw new Error('fixture catalog refusal')
      }
    ]
  ])('is unreadable, and runs no git, when %s', async (_label, resolve) => {
    const exec = fakeGit()
    const read = createAttemptWorktreeChangesReader({ resolvePath: vi.fn(resolve), exec })
    expect(await read(WORKTREE)).toEqual({ readable: false })
    expect(exec).not.toHaveBeenCalled()
  })

  it.each(['--all', 'HEAD', '0123456789abcdef', `${'g'.repeat(40)}`])(
    'refuses a recorded base that is not a full commit id (%s) before running git',
    async (baseCommit) => {
      const exec = fakeGit()
      const { read } = reader(exec)
      expect(await read({ ...WORKTREE, baseCommit })).toEqual({ readable: false })
      expect(exec).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['rev-list fails', { fail: 'rev-list' } as const],
    ['status fails', { fail: 'status' } as const],
    ['rev-list prints no count', { revList: 'fatal: bad revision\n' }]
  ])('is unreadable when %s', async (_label, answers) => {
    const { read } = reader(fakeGit(answers))
    expect(await read(WORKTREE)).toEqual({ readable: false })
  })
})
