import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWorkspaceGitPort, type GitExec } from './workspace-git-status'

type Reply = { stdout: string } | { error: Error & { stderr?: string } }

function fakeExec(
  replies: Record<string, Reply>
): GitExec & { calls: { args: string[]; env: unknown }[] } {
  const calls: { args: string[]; env: unknown }[] = []
  const exec: GitExec = async (args, options) => {
    calls.push({ args, env: options.env })
    // Why: a leading -c key=value pair comes before the subcommand.
    const reply = replies[(args[0] === '-c' ? args[2] : args[0]) ?? '']
    if (!reply) {
      throw new Error(`unexpected git ${args.join(' ')}`)
    }
    if ('error' in reply) {
      throw reply.error
    }
    return { stdout: reply.stdout, stderr: '' }
  }
  return Object.assign(exec, { calls })
}

function gitError(message: string): Error & { stderr: string } {
  return Object.assign(new Error(message), { stderr: message })
}

const TOP = join('C:', 'repo')

describe('workspace git status over the Orca git runner', () => {
  it('reports changed files as absolute paths under the top level, and the HEAD commit time', async () => {
    const exec = fakeExec({
      'rev-parse': { stdout: `${TOP}\n` },
      status: { stdout: ' M src/a.ts\0?? notes/new.md\0R  b.ts\0old-b.ts\0' },
      log: { stdout: '1759626000\n' }
    })
    const status = await createWorkspaceGitPort({ exec }).readStatus(TOP)
    expect(status).toEqual({
      ok: true,
      changedFiles: [join(TOP, 'src/a.ts'), join(TOP, 'notes/new.md'), join(TOP, 'b.ts')],
      headCommitSeconds: 1759626000
    })
    expect(exec.calls.map((call) => call.args)).toEqual([
      ['rev-parse', '--show-toplevel'],
      // Why: no repo-configured program runs; an empty fsmonitor disables it on Git 2.25 and later.
      ['-c', 'core.fsmonitor=', 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
      ['log', '-1', '--no-show-signature', '--format=%ct']
    ])
    // Why: a status read must never take the index lock the user's own git may need.
    for (const call of exec.calls) {
      expect(call.env).toMatchObject({ GIT_OPTIONAL_LOCKS: '0' })
    }
  })

  it('reads a repository without commits as having no HEAD time', async () => {
    const exec = fakeExec({
      'rev-parse': { stdout: TOP },
      status: { stdout: '' },
      log: { error: gitError("fatal: your current branch 'main' does not have any commits yet") }
    })
    expect(await createWorkspaceGitPort({ exec }).readStatus(TOP)).toEqual({
      ok: true,
      changedFiles: [],
      headCommitSeconds: null
    })
  })

  it('distinguishes a directory that is not a repository from a git failure', async () => {
    const notRepo = fakeExec({
      'rev-parse': {
        error: gitError('fatal: not a git repository (or any of the parent directories): .git')
      }
    })
    expect(await createWorkspaceGitPort({ exec: notRepo }).readStatus(TOP)).toEqual({
      ok: false,
      reason: 'not_a_repository'
    })
    const broken = fakeExec({
      'rev-parse': { stdout: TOP },
      status: { error: gitError('fatal: index file corrupt') }
    })
    expect(await createWorkspaceGitPort({ exec: broken }).readStatus(TOP)).toEqual({
      ok: false,
      reason: 'git_failed'
    })
    const badTime = fakeExec({
      'rev-parse': { stdout: TOP },
      status: { stdout: '' },
      log: { stdout: 'yesterday' }
    })
    expect(await createWorkspaceGitPort({ exec: badTime }).readStatus(TOP)).toEqual({
      ok: false,
      reason: 'git_failed'
    })
  })
})
