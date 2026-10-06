import { join } from 'node:path'
import { parsePorcelainV1Records } from '../../git/porcelain-v1-records'
import { gitExecFileAsync, gitOptionalLocksDisabledEnv } from '../../git/runner'
import { gitStatusErrorMeansNotRepository } from '../runtime-worktree-selection'
import type { WorkspaceGitPort, WorkspaceGitStatus } from './workspace-write-check'

// Git is read only through Orca's runner, which owns admission, timeouts, WSL routing and cleanup.

const GIT_TIMEOUT_MS = 30_000
const NO_COMMITS = /does not have any commits|bad default revision|unknown revision or path/i

export type GitExec = (
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeout: number }
) => Promise<{ stdout: string; stderr: string }>

function stderrOf(error: unknown): string {
  const stderr = error instanceof Error && 'stderr' in error ? error.stderr : ''
  const message = error instanceof Error ? error.message : ''
  return `${message}\n${typeof stderr === 'string' ? stderr : ''}`
}

async function headCommitSeconds(run: (args: string[]) => Promise<string>): Promise<number | null> {
  try {
    const text = (await run(['log', '-1', '--no-show-signature', '--format=%ct'])).trim()
    if (!/^\d{1,12}$/.test(text)) {
      throw new Error('unparseable commit time')
    }
    return Number(text)
  } catch (error) {
    if (NO_COMMITS.test(stderrOf(error))) {
      return null
    }
    throw error
  }
}

export function createWorkspaceGitPort(deps: { readonly exec?: GitExec } = {}): WorkspaceGitPort {
  const exec: GitExec = deps.exec ?? gitExecFileAsync
  return {
    async readStatus(workspacePath, signal): Promise<WorkspaceGitStatus> {
      // Why: a status read takes no optional index lock the user's own git may be waiting for.
      const options = {
        cwd: workspacePath,
        env: gitOptionalLocksDisabledEnv(),
        signal,
        timeout: GIT_TIMEOUT_MS
      }
      const run = async (args: string[]): Promise<string> => (await exec(args, options)).stdout
      let topLevel: string
      try {
        topLevel = (await run(['rev-parse', '--show-toplevel'])).trim()
      } catch (error) {
        return {
          ok: false,
          reason: gitStatusErrorMeansNotRepository(error) ? 'not_a_repository' : 'git_failed'
        }
      }
      try {
        // Why: -z keeps paths raw; an empty fsmonitor runs no repo hook on Git 2.25 or later.
        const porcelain = await run([
          '-c',
          'core.fsmonitor=',
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all'
        ])
        const changedFiles = parsePorcelainV1Records(porcelain).map((record) =>
          join(topLevel, record.path)
        )
        return { ok: true, changedFiles, headCommitSeconds: await headCommitSeconds(run) }
      } catch {
        return { ok: false, reason: 'git_failed' }
      }
    }
  }
}
