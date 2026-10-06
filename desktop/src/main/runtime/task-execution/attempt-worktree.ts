import type { TaskExecutorKind } from './process-executor-contract'

// D-025: a Codex or agy attempt that may write in a git workspace gets its own new Orca worktree,
// branched from the run worktree's HEAD, so parallel writers never share a checkout. NASH creates it
// and never merges, removes or cleans it up; the primary merges its branch, the user removes it.

/** Where an attempt's own worktree is, recorded with the attempt and named in its transcript. */
export type AttemptWorktree = {
  /** Orca's worktree id (`<repo>::<path>`); validation resolves it again through the catalog. */
  readonly worktreeId: string
  /** The short branch name, without `refs/heads/`. */
  readonly branch: string
  /** The local path the CLI runs in. */
  readonly path: string
  /** The run worktree's HEAD commit the branch starts from. */
  readonly baseCommit: string
}

export type AttemptWorktreeRequest = {
  /** The run's worktree, which becomes the parent in Orca's worktree lineage. */
  readonly runWorktreeId: string
  readonly runWorktreePath: string
  readonly runId: string
  readonly taskId: string
  readonly dispatchId: string
  readonly executor: TaskExecutorKind
}

export type AttemptWorktreePort = {
  /** Creates the worktree before the attempt is marked running; rejects with an AttemptWorktreeError. */
  create(request: AttemptWorktreeRequest): Promise<AttemptWorktree>
}

export type AttemptWorktreeFailure =
  | 'base_unavailable'
  | 'create_failed'
  | 'not_local'
  | 'base_mismatch'

/** A refusal with a fixed code; the message never carries git or Orca error text, which can hold paths. */
export class AttemptWorktreeError extends Error {
  readonly code: AttemptWorktreeFailure

  constructor(code: AttemptWorktreeFailure) {
    super(`The attempt worktree could not be prepared (${code}).`)
    this.name = 'AttemptWorktreeError'
    this.code = code
  }
}

/** The start refusal reason for a failed worktree; anything unexpected gets one generic code. */
export function attemptWorktreeRefusal(error: unknown): string {
  return error instanceof AttemptWorktreeError
    ? `task_worktree_${error.code}`
    : 'task_worktree_failed'
}

const UNSAFE_NAME_CHARACTERS = /[^A-Za-z0-9_-]+/g

/** `nash-<task>-<attempt>`: the same for the same attempt, and only characters git refs and paths take. */
export function attemptWorktreeName(taskId: string, dispatchId: string): string {
  return `nash-${taskId}-${dispatchId}`.replace(UNSAFE_NAME_CHARACTERS, '-')
}
