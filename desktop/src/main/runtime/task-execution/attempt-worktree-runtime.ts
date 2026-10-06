import { splitWorktreeId } from '../../../shared/worktree/id'
import { gitExecFileAsync, gitOptionalLocksDisabledEnv } from '../../git/runner'
import type { RuntimeManagedWorktreeCreateArgs } from '../runtime-managed-worktree-create-types'
import {
  AttemptWorktreeError,
  attemptWorktreeName,
  type AttemptWorktree,
  type AttemptWorktreePort,
  type AttemptWorktreeRequest
} from './attempt-worktree'

// The production worktree port: Orca's own managed-worktree creation, as an orchestration worker's
// `--worktree new-child` uses it, with no agent, terminal, setup or activation. Git is read only
// through Orca's runner, and only for `rev-parse`, which runs no repository hook.

const GIT_TIMEOUT_MS = 30_000
const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const BRANCH_REF_PREFIX = 'refs/heads/'

/** What this port needs of `OrcaRuntimeService`; the host passes the runtime itself. */
export type AttemptWorktreeRuntime = {
  createManagedWorktree(args: RuntimeManagedWorktreeCreateArgs): Promise<{
    readonly worktree: { readonly id: string; readonly branch: string }
  }>
}

export type AttemptWorktreeRuntimeDeps = {
  readonly runtime: AttemptWorktreeRuntime
  /** `runtime.requireWorkbenchWorkspace(id).path`: throws for anything but an admitted local workspace. */
  readonly workspacePath: (worktreeId: string) => string
  /** The commit HEAD names in a local checkout; Orca's git runner by default. */
  readonly readHead?: (path: string) => Promise<string>
}

type GitExec = (
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }
) => Promise<{ stdout: string }>

/** `git rev-parse --verify HEAD^{commit}` in one checkout; rejects anything but a full commit id. */
export async function readHeadCommit(
  path: string,
  exec: GitExec = gitExecFileAsync
): Promise<string> {
  const { stdout } = await exec(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
    cwd: path,
    // Why: a read takes no optional index lock the user's own git may be waiting for.
    env: gitOptionalLocksDisabledEnv(),
    timeout: GIT_TIMEOUT_MS
  })
  const commit = stdout.trim().toLowerCase()
  if (!COMMIT_ID.test(commit)) {
    throw new Error('HEAD did not resolve to a commit id.')
  }
  return commit
}

/** Orca's create call for one attempt: a child of the run worktree, branched from `baseCommit`. */
export function attemptWorktreeCreateArgs(
  request: AttemptWorktreeRequest,
  repoId: string,
  baseCommit: string
): RuntimeManagedWorktreeCreateArgs {
  return {
    repoSelector: `id:${repoId}`,
    name: attemptWorktreeName(request.taskId, request.dispatchId),
    // Why the commit id: the branch must start exactly where the run worktree is now, not at a ref.
    baseBranch: baseCommit,
    comment: `NASH task ${request.taskId}, attempt ${request.dispatchId}, run ${request.runId}`,
    runHooks: false,
    setupDecision: 'skip',
    activate: false,
    // Why: records which CLI the worktree is for, and spares it the blank shell Orca opens otherwise.
    createdWithAgent: request.executor === 'codex_cli' ? 'codex' : 'antigravity',
    // An explicit parent wins over orchestrationContext, which Orca reads only without one.
    lineage: { parentWorktree: `id:${request.runWorktreeId}` }
  }
}

async function attemptOr<T>(
  read: () => Promise<T> | T,
  failure: AttemptWorktreeError['code']
): Promise<T> {
  try {
    return await read()
  } catch {
    throw new AttemptWorktreeError(failure)
  }
}

function shortBranch(branch: string): string {
  return branch.startsWith(BRANCH_REF_PREFIX) ? branch.slice(BRANCH_REF_PREFIX.length) : branch
}

export function createRuntimeAttemptWorktreePort(
  deps: AttemptWorktreeRuntimeDeps
): AttemptWorktreePort {
  const readHead = deps.readHead ?? ((path: string) => readHeadCommit(path))
  return {
    async create(request): Promise<AttemptWorktree> {
      const repoId = splitWorktreeId(request.runWorktreeId)?.repoId
      if (!repoId) {
        throw new AttemptWorktreeError('create_failed')
      }
      const baseCommit = await attemptOr(
        () => readHead(request.runWorktreePath),
        'base_unavailable'
      )
      const created = await attemptOr(
        () =>
          deps.runtime.createManagedWorktree(
            attemptWorktreeCreateArgs(request, repoId, baseCommit)
          ),
        'create_failed'
      )
      // Why through the catalog: it admits only a native local workspace, so an SSH, WSL or unknown
      // worktree refuses the start here instead of running a CLI against a path it cannot reach.
      const path = await attemptOr(() => deps.workspacePath(created.worktree.id), 'not_local')
      const head = await attemptOr(() => readHead(path), 'base_mismatch')
      if (head !== baseCommit) {
        throw new AttemptWorktreeError('base_mismatch')
      }
      return {
        worktreeId: created.worktree.id,
        branch: shortBranch(created.worktree.branch),
        path,
        baseCommit
      }
    }
  }
}
