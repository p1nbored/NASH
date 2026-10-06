import type { CodexExecutable } from '../../codex-exec/codex-exec-executable'
import { readLastMessage } from '../../codex-exec/codex-exec-last-message'
import {
  runCodexExec,
  type CodexExecResult,
  type CodexExecRunOptions
} from '../../codex-exec/codex-exec-run'
import type { CodexExecRequest } from '../../codex-exec/codex-exec-types'
import type { ReviewerRequest, ReviewerRunner, ReviewerRunOutcome } from './reviewer-runner'

/** A review is one bounded turn; it gets less time than delegated work. */
const DEFAULT_REVIEW_TIMEOUT_MS = 15 * 60 * 1000
const REVIEW_TEXT_MAX_BYTES = 64 * 1024

/** The part of runCodexExec the reviewer depends on; tests inject a fake with this shape. */
export type CodexReviewRun = (
  request: CodexExecRequest,
  options: CodexExecRunOptions
) => Promise<Pick<CodexExecResult, 'verdict' | 'lastMessage' | 'reportedModel'>>

export type CodexReviewerDeps = {
  /** Absolute, app-private directory; each review gets a fresh run directory under it. */
  readonly runsRoot: string
  /** Throws when no launchable Codex is installed. */
  readonly resolveExecutable: () => CodexExecutable
  readonly timeoutMs?: number
  readonly run?: CodexReviewRun
  /** Extra runner options (test seams such as temp roots); never executable, signal or timeout. */
  readonly runOptions?: Partial<Omit<CodexExecRunOptions, 'executable' | 'signal' | 'timeoutMs'>>
}

async function completedOutcome(
  result: Pick<CodexExecResult, 'lastMessage' | 'reportedModel'>
): Promise<ReviewerRunOutcome> {
  if (result.lastMessage.state !== 'ok') {
    return { status: 'failed', reason: 'review_output_missing' }
  }
  const read = await readLastMessage(result.lastMessage.path, REVIEW_TEXT_MAX_BYTES)
  if (read.state !== 'ok' || read.sha256 !== result.lastMessage.sha256) {
    return { status: 'failed', reason: 'review_output_unreadable' }
  }
  return {
    status: 'completed',
    text: read.text,
    outputSha256: read.sha256,
    reportedModels: result.reportedModel ? [result.reportedModel] : []
  }
}

function resolveExecutable(deps: CodexReviewerDeps): CodexExecutable | null {
  try {
    return deps.resolveExecutable()
  } catch {
    return null
  }
}

/** Reviews through the Codex runner: codex's default sandbox (D-027), resolved effort, prompt on stdin, review schema. */
export function createCodexReviewer(deps: CodexReviewerDeps): ReviewerRunner {
  const run: CodexReviewRun = deps.run ?? runCodexExec
  return async (request: ReviewerRequest): Promise<ReviewerRunOutcome> => {
    if (request.workspacePath === null) {
      return { status: 'unavailable', reason: 'workspace_unavailable' }
    }
    if (request.effort === null) {
      return { status: 'unavailable', reason: 'effort_unresolved' }
    }
    const executable = resolveExecutable(deps)
    if (!executable) {
      return { status: 'unavailable', reason: 'cli_missing' }
    }
    const result = await run(
      {
        prompt: request.prompt,
        model: request.model,
        effort: request.effort,
        worktreePath: request.workspacePath,
        runsRoot: deps.runsRoot,
        runId: request.runId,
        outputSchema: request.outputSchema,
        ephemeral: true,
        skipGitRepoCheck: request.workspaceKind === 'folder'
      },
      {
        ...deps.runOptions,
        executable,
        signal: request.signal,
        timeoutMs: deps.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS
      }
    )
    if (result.verdict.status === 'blocked') {
      return { status: 'blocked', reason: result.verdict.reason }
    }
    if (result.verdict.status === 'failed') {
      return { status: 'failed', reason: result.verdict.failures[0].kind }
    }
    return completedOutcome(result)
  }
}
