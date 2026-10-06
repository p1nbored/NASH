import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { buildAgentExecEnvironment } from '../../agent-exec-shared/exec-environment'
import {
  defaultRealPath,
  findExecutableProblem
} from '../../agent-exec-shared/executable-validation'
import type { LaunchTarget } from '../../agent-exec-shared/launch-target'
import {
  runManagedChild,
  type ManagedChildOutcome
} from '../../agent-exec-shared/managed-child-session'
import {
  createRunDirectory,
  defaultTempRoots,
  type RunDirectoryLocation
} from '../../agent-exec-shared/run-directory'
import type { TreeTerminationDeps } from '../../agent-exec-shared/tree-termination'
import { buildClaudeReviewArgv } from './claude-reviewer-argv'
import { attachClaudeReviewIo, parseClaudeResultEnvelope } from './claude-reviewer-output'
import type { ReviewerRequest, ReviewerRunner, ReviewerRunOutcome } from './reviewer-runner'

// Not Orca's commit-message claude -p, which keeps its tools and runs in source-control lanes.

const DEFAULT_REVIEW_TIMEOUT_MS = 15 * 60 * 1000
const GRACE_MS = 5_000
const VERIFY_MS = 10_000
const DRAIN_GRACE_MS = 2_000

export type ClaudeReviewerDeps = {
  /** Absolute, app-private directory; each review gets a fresh, empty run directory under it as its cwd. */
  readonly runsRoot: string
  /** The installed Claude Code launch target, or null (or a throw) when none is installed. */
  readonly resolveExecutable: () => LaunchTarget | null
  readonly timeoutMs?: number
  readonly parentEnv?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly electron?: { readonly isElectron: boolean; readonly execPath: string }
  /** Test seams, as in the Codex and agy runners. */
  readonly tempRoots?: () => readonly string[]
  readonly termination?: Partial<TreeTerminationDeps>
}

type Prepared = {
  readonly argv: string[]
  readonly executable: LaunchTarget
  readonly location: RunDirectoryLocation
}

const unavailable = (reason: string): ReviewerRunOutcome => ({ status: 'unavailable', reason })

function resolveLaunch(deps: ClaudeReviewerDeps): LaunchTarget | null {
  try {
    return deps.resolveExecutable()
  } catch {
    return null
  }
}

async function prepare(
  deps: ClaudeReviewerDeps,
  request: ReviewerRequest,
  platform: NodeJS.Platform
): Promise<Prepared | ReviewerRunOutcome> {
  let argv: string[]
  try {
    argv = buildClaudeReviewArgv({ model: request.model, effort: request.effort })
  } catch {
    return unavailable('invalid_request')
  }
  const executable = resolveLaunch(deps)
  if (!executable) {
    return unavailable('cli_missing')
  }
  const fence = request.workspacePath ?? join(deps.runsRoot, request.runId)
  const created = await createRunDirectory({
    runsRoot: deps.runsRoot,
    runId: request.runId,
    worktreePath: fence,
    platform,
    forbiddenRoots: deps.tempRoots?.() ?? defaultTempRoots(platform)
  })
  if (!created.ok) {
    return unavailable('run_dir_unusable')
  }
  const problem = findExecutableProblem(executable, {
    worktreePath: fence,
    runDir: created.value.runDir,
    platform,
    electron: deps.electron ?? { isElectron: false, execPath: process.execPath },
    realPath: defaultRealPath
  })
  if (problem !== null) {
    return unavailable('cli_not_launchable')
  }
  return { argv, executable, location: created.value }
}

type Summary = { readonly stdout: string; readonly overflowed: boolean }

function settle(outcome: ManagedChildOutcome<Summary>): ReviewerRunOutcome {
  if (outcome.kind === 'not_started') {
    return unavailable('spawn_failed')
  }
  const trigger = outcome.termination?.trigger
  if (trigger === 'abort_signal' || trigger === 'timeout' || trigger === 'output_limit') {
    const reasons = {
      abort_signal: 'cancelled',
      timeout: 'timed_out',
      output_limit: 'output_oversized'
    } as const
    return { status: 'failed', reason: reasons[trigger] }
  }
  if (outcome.descendantOutlivedRoot) {
    return { status: 'failed', reason: 'descendant_outlived_root' }
  }
  if (outcome.exitCode !== 0) {
    return { status: 'failed', reason: 'nonzero_exit' }
  }
  const envelope = parseClaudeResultEnvelope(outcome.summary.stdout)
  if (!envelope.ok || outcome.summary.overflowed) {
    return { status: 'failed', reason: 'review_output_invalid' }
  }
  return {
    status: 'completed',
    text: envelope.text,
    outputSha256: createHash('sha256').update(envelope.text).digest('hex'),
    reportedModels: envelope.reportedModels
  }
}

/** Runs `claude -p` with Claude Code's default settings; the prompt goes on stdin, the answer comes back once. */
export function createClaudeReviewer(deps: ClaudeReviewerDeps): ReviewerRunner {
  const platform = deps.platform ?? process.platform
  return async (request) => {
    const prepared = await prepare(deps, request, platform)
    if ('status' in prepared) {
      return prepared
    }
    if (request.signal?.aborted) {
      return { status: 'failed', reason: 'cancelled' }
    }
    const { executable, location } = prepared
    const env = buildAgentExecEnvironment({
      parentEnv: deps.parentEnv ?? process.env,
      runTempDir: location.tempDir,
      platform,
      excludePathUnder: [
        location.runDir,
        ...(request.workspacePath ? [request.workspacePath] : [])
      ],
      electronRunAsNode: executable.electronRunAsNode === true
    })
    const outcome = await runManagedChild({
      executable,
      argv: prepared.argv,
      stdinText: request.prompt,
      cwd: location.runDir,
      env,
      signal: request.signal,
      timeoutMs: deps.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS,
      graceMs: GRACE_MS,
      verifyMs: VERIFY_MS,
      drainGraceMs: DRAIN_GRACE_MS,
      platform,
      termination: deps.termination,
      attachIo: attachClaudeReviewIo,
      summarize: (io) => ({ stdout: io.stdout(), overflowed: io.overflowed() })
    })
    return settle(outcome)
  }
}
