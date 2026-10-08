import { createHash } from 'node:crypto'
import { getCommitMessageAgentSpec } from '../../../shared/commit-message-agent-spec'
import {
  runProcess,
  type ProcessSpec,
  type ProcessResult
} from '../../../shared/child-process/run-process'
import { withCliRuntimeOnPath } from '../../../shared/node-cli-command-resolution'
import { resolveCodexHomeProcessLockKeyForSpawnEnv } from '../../codex-cli/codex-home-process-lock'
import { runCodexProcessWithHomeLock } from '../../text-generation/source-control-local-generation'
import { getSpawnArgsForWindows } from '../../win32-utils'
import { detectCodexExecBlock } from '../../codex-exec/codex-exec-blocked-heuristics'
import { parseClaudeResultEnvelope } from './claude-reviewer-output'

// A reviewer only reads and answers once; model-review-verdict.ts parses the answer.

export type ReviewerRequest = {
  /** Delivered through the native one-shot stdin path. */
  readonly prompt: string
  readonly model: string
  /** The CLI setting the availability check resolved; null sends no effort flag. */
  readonly effort: string | null
  /** The workspace a reviewer may read; null when it is not a local directory. */
  readonly workspacePath: string | null
  /** A folder workspace is no git repository; the Codex reviewer then skips its git check (D-027). */
  readonly workspaceKind?: 'git' | 'folder'
  /** Identity recorded with the review evidence. */
  readonly runId: string
  readonly outputSchema: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}

export type ReviewerRunOutcome =
  | {
      readonly status: 'completed'
      readonly text: string
      readonly outputSha256: string
      /** Models the CLI itself reported serving the run; empty when it reported none. */
      readonly reportedModels: readonly string[]
    }
  /** The CLI reported an auth or quota failure; the route is latched by the caller. */
  | { readonly status: 'blocked'; readonly reason: 'auth' | 'quota' }
  | { readonly status: 'failed'; readonly reason: string }
  /** Nothing was started: the runner cannot run this request here. */
  | { readonly status: 'unavailable'; readonly reason: string }

export type ReviewerRunner = (request: ReviewerRequest) => Promise<ReviewerRunOutcome>

export type NativeReviewerDeps = {
  readonly resolveInvocation: (agent: 'claude' | 'codex') => Promise<{ command: string; env?: NodeJS.ProcessEnv }>
  readonly run?: (spec: ProcessSpec) => Promise<ProcessResult>
  readonly timeoutMs?: number
}

const REVIEW_TIMEOUT_MS = 15 * 60 * 1000
const REVIEW_OUTPUT_MAX_BYTES = 512 * 1024

function reviewResult(
  agent: 'claude' | 'codex',
  result: ProcessResult,
  signal?: AbortSignal
): ReviewerRunOutcome {
  if (signal?.aborted) {
    return { status: 'failed', reason: 'cancelled' }
  }
  if (result.timedOut) {
    return { status: 'failed', reason: 'timed_out' }
  }
  if (result.outputTruncated) {
    return { status: 'failed', reason: 'output_oversized' }
  }
  if (result.code !== 0) {
    const blocked = detectCodexExecBlock([result.stderr])
    return blocked
      ? { status: 'blocked', reason: blocked.reason }
      : { status: 'failed', reason: 'nonzero_exit' }
  }
  const envelope = agent === 'claude' ? parseClaudeResultEnvelope(result.stdout) : null
  if (envelope && !envelope.ok) {
    return { status: 'failed', reason: 'review_output_invalid' }
  }
  const text = envelope?.ok ? envelope.text : result.stdout.trim()
  if (!text) {
    return { status: 'failed', reason: 'review_output_missing' }
  }
  return {
    status: 'completed',
    text,
    outputSha256: createHash('sha256').update(text).digest('hex'),
    reportedModels: envelope?.ok ? envelope.reportedModels : []
  }
}

/** Native CLI recipes, account environment, process runner and Codex home lock; no private executor. */
export function createNativeReviewer(
  agent: 'claude' | 'codex',
  deps: NativeReviewerDeps
): ReviewerRunner {
  return async (request) => {
    if (request.signal?.aborted) {
      return { status: 'failed', reason: 'cancelled' }
    }
    if (request.workspacePath === null) {
      return { status: 'unavailable', reason: 'workspace_unavailable' }
    }
    const native = getCommitMessageAgentSpec(agent)!
    let invocation: Awaited<ReturnType<NativeReviewerDeps['resolveInvocation']>>
    try { invocation = await deps.resolveInvocation(agent) } catch {
      return { status: 'unavailable', reason: 'account_unavailable' }
    }
    const program = invocation.command
    const args = native.buildArgs({
      prompt: '',
      model: request.model,
      ...(request.effort === null ? {} : { thinkingLevel: request.effort })
    })
    if (agent === 'claude') {
      args[args.indexOf('--output-format') + 1] = 'json'
      args.push('--no-session-persistence')
    }
    const launch = getSpawnArgsForWindows(program, args)
    const spawnEnv = withCliRuntimeOnPath(program, invocation.env ?? process.env)
    const start = () => {
      let closed!: () => void
      const processClosed = new Promise<void>((resolve) => {
        closed = resolve
      })
      const result = (deps.run ?? runProcess)({
        program: launch.spawnCmd,
        args: launch.spawnArgs,
        env: spawnEnv,
        cwd: request.workspacePath!,
        input: request.prompt,
        signal: request.signal,
        timeoutMs: deps.timeoutMs ?? REVIEW_TIMEOUT_MS,
        maxOutputBytes: REVIEW_OUTPUT_MAX_BYTES,
        killOnOutputLimit: true,
        detached: process.platform !== 'win32',
        terminationBarrier: true,
        onChildTerminated: closed
      })
      return { result, processClosed }
    }
    try {
      const result =
        agent === 'codex'
          ? await runCodexProcessWithHomeLock(
              resolveCodexHomeProcessLockKeyForSpawnEnv(spawnEnv),
              start,
              request.signal
            )
          : await start().result
      return reviewResult(agent, result, request.signal)
    } catch {
      return {
        status: 'failed',
        reason: request.signal?.aborted ? 'cancelled' : 'review_process_failed'
      }
    }
  }
}
