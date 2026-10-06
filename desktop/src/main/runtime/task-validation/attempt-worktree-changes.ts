import { gitExecFileAsync, gitOptionalLocksDisabledEnv } from '../../git/runner'
import type { AttemptWorktree } from '../task-execution/attempt-worktree'
import type { WorktreeChangeFacts } from '../task-execution/task-result-notice'
import { createWorkspaceGitPort, type GitExec } from './workspace-git-status'

// What a passed or waived write attempt left in its own worktree, read just before the merge notice:
// commits past its base, and uncommitted changes. Reads only, through Orca's git runner, with
// optional locks off and the status read's fsmonitor hook off; any doubt is reported as unreadable.

const GIT_TIMEOUT_MS = 30_000
const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const COUNT = /^\d{1,9}$/
const UNREADABLE: WorktreeChangeFacts = { readable: false }

export type AttemptWorktreeChangesReader = (
  worktree: AttemptWorktree,
  signal?: AbortSignal
) => Promise<WorktreeChangeFacts>

export type AttemptWorktreeChangesDeps = {
  /** The worktree's local path as the catalog admits it now; null when it is gone or not local. */
  readonly resolvePath: (worktreeId: string) => Promise<string | null>
  readonly exec?: GitExec
}

async function admittedPath(
  resolvePath: AttemptWorktreeChangesDeps['resolvePath'],
  worktreeId: string
): Promise<string | null> {
  try {
    return await resolvePath(worktreeId)
  } catch {
    return null
  }
}

export function createAttemptWorktreeChangesReader(
  deps: AttemptWorktreeChangesDeps
): AttemptWorktreeChangesReader {
  const exec = deps.exec ?? gitExecFileAsync
  const status = createWorkspaceGitPort({ exec })
  return async (worktree, signal) => {
    // Why: the base is recorded evidence, so it is checked before it becomes a git argument.
    if (!COMMIT_ID.test(worktree.baseCommit)) {
      return UNREADABLE
    }
    const path = await admittedPath(deps.resolvePath, worktree.worktreeId)
    if (path === null) {
      return UNREADABLE
    }
    try {
      const counted = await exec(['rev-list', '--count', `${worktree.baseCommit}..HEAD`], {
        cwd: path,
        env: gitOptionalLocksDisabledEnv(),
        signal,
        timeout: GIT_TIMEOUT_MS
      })
      const count = counted.stdout.trim()
      if (!COUNT.test(count)) {
        return UNREADABLE
      }
      const read = await status.readStatus(path, signal)
      return read.ok
        ? { readable: true, commitsAhead: Number(count), uncommitted: read.changedFiles.length > 0 }
        : UNREADABLE
    } catch {
      return UNREADABLE
    }
  }
}
