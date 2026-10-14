import {
  getLocalWorktreePathAccess,
  toLocalWorktreeRuntimePath
} from '../../../local-worktree-filesystem'
import { gitExecFileAsync } from '../../../git/runner'
import { isWorktreePathMissing } from '../../../worktree-removal-safety'

export async function isAlreadyRemovedWorktreePath(
  worktreePath: string,
  localWorktreeGitOptions: { wslDistro?: string } = {}
): Promise<boolean> {
  const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
  return isWorktreePathMissing(
    toLocalWorktreeRuntimePath(worktreePath, localWorktreeGitOptions),
    access.statPath
  )
}

export async function isLocalGitRepository(
  runtimeWorktreePath: string,
  localWorktreeGitOptions: { wslDistro?: string } = {}
): Promise<boolean> {
  try {
    await gitExecFileAsync(['status', '--short'], {
      cwd: runtimeWorktreePath,
      ...localWorktreeGitOptions
    })
    return true
  } catch (error) {
    return !gitStatusErrorMeansNotRepository(error)
  }
}

export function gitStatusErrorMeansNotRepository(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : typeof error === 'string'
          ? error
          : ''
  const stderr =
    error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr: unknown }).stderr)
      : ''
  return /not a git repository/i.test(`${message}\n${stderr}`)
}
