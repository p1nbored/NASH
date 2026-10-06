import { workspaceKindForWorktreeId } from '../../../shared/workspace-launch-kind'
import { attemptTranscriptPath } from '../../agent-exec-shared/attempt-transcript'
import { isCodexExecEffort } from '../../codex-exec/codex-exec-argv'
import type { CodexExecutable } from '../../codex-exec/codex-exec-executable'
import type { CodexExecResult } from '../../codex-exec/codex-exec-result'
import type { CodexExecRunOptions } from '../../codex-exec/codex-exec-run-options'
import type { CodexExecRequest } from '../../codex-exec/codex-exec-types'
import { placeAttempt, transcriptWorktreeOf, type PlacedAttempt } from './attempt-workspace'
import type { ExecutorRunReport } from './executor-run-report'
import {
  codexAppliedAccess,
  codexSandboxForAccess,
  type RunAccess
} from './executor-sandbox-policy'
import { buildExecutorTaskPrompt } from './executor-task-prompt'
import {
  cancellationOf,
  executableFacts,
  launchEvidence,
  resolveLaunch,
  runnerVerdict,
  type ResolvedLaunch
} from './process-executor-launch'
import type {
  PrepareOutcome,
  ProcessAttemptPlan,
  ProcessLaunchPorts,
  ProcessTaskExecutor
} from './process-executor-contract'

export type CodexTaskExecutorPorts = ProcessLaunchPorts & {
  /** `runCodexExec`; injected so tests drive a fake. */
  readonly run: (
    request: CodexExecRequest,
    options: CodexExecRunOptions
  ) => Promise<CodexExecResult>
  /** `resolveCodexExecutable` bound as the routing table's availability check binds it. */
  readonly resolveExecutable: () => CodexExecutable
}

/** The runner-neutral record of one Codex run; the message text, stderr and paths stay behind. */
export function codexRunReport(result: CodexExecResult, requested: RunAccess): ExecutorRunReport {
  const message = result.lastMessage
  return {
    verdict: runnerVerdict(result.verdict),
    spawned: result.spawned,
    exitCode: result.exitCode,
    cancellation: cancellationOf(result.cancellation),
    treeProof: result.treeProof,
    lastMessage:
      message.state === 'ok'
        ? { sha256: message.sha256, bytes: message.bytes, secretLike: message.secretLike }
        : null,
    usage: result.usage ? { ...result.usage } : null,
    threadId: result.threadId,
    facts: {
      ...executableFacts(result.evidence, result.timing.durationMs),
      exactModelVerified: result.exactModelVerified
    },
    sandbox: { requested, applied: codexAppliedAccess(result.applied) }
  }
}

function requestFor(
  plan: ProcessAttemptPlan,
  effort: string,
  launch: ResolvedLaunch<CodexExecutable>,
  placed: PlacedAttempt
): CodexExecRequest {
  return {
    // Why: the runner sends the prompt on stdin only; it never reaches argv or the result.
    prompt: buildExecutorTaskPrompt(plan.prompt, plan.access),
    model: plan.cli.model,
    effort,
    // D-025: the sandbox follows the run's access level; never full access.
    sandbox: codexSandboxForAccess(plan.access),
    worktreePath: placed.cwd,
    runsRoot: launch.runsRoot,
    runId: plan.dispatchId,
    // D-027: a folder workspace is no git repository, which codex refuses unless told to skip the check.
    skipGitRepoCheck: workspaceKindForWorktreeId(plan.workspaceId) === 'folder'
  }
}

function optionsFor(
  ports: CodexTaskExecutorPorts,
  launch: ResolvedLaunch<CodexExecutable>,
  plan: ProcessAttemptPlan,
  placed: PlacedAttempt,
  signal: AbortSignal
): CodexExecRunOptions {
  const worktree = transcriptWorktreeOf(placed.placement)
  return {
    executable: launch.executable,
    ...(launch.parentEnv === undefined ? {} : { parentEnv: launch.parentEnv }),
    signal,
    // D-027: no fixed timeout; the run ends when codex ends or the user stops it.
    ...(ports.timeoutMs === undefined ? {} : { timeoutMs: ports.timeoutMs }),
    // D-024: the read-only task window shows this attempt's transcript, kept in its run directory.
    transcript: {
      path: attemptTranscriptPath(launch.runsRoot, plan.dispatchId),
      ...(worktree === null ? {} : { worktree })
    }
  }
}

/** Codex runs in the sandbox its access level asks for, with the effort sent explicitly; no effort, no start. */
export function createCodexTaskExecutor(ports: CodexTaskExecutorPorts): ProcessTaskExecutor {
  return {
    kind: 'codex_cli',
    async prepare(plan): Promise<PrepareOutcome> {
      const { effort } = plan.cli
      if (effort === null) {
        return { ok: false, reason: 'effort_missing' }
      }
      if (!isCodexExecEffort(effort)) {
        return { ok: false, reason: 'effort_unsupported' }
      }
      const resolved = await resolveLaunch(ports, ports.resolveExecutable, plan)
      if (!resolved.ok) {
        return resolved
      }
      const { launch } = resolved
      // Why last: every refusal above leaves no worktree behind.
      const placement = await placeAttempt(ports.worktrees, plan, 'codex_cli', launch.worktreePath)
      if (!placement.ok) {
        return placement
      }
      const { placed } = placement
      const request = requestFor(plan, effort, launch, placed)
      return {
        ok: true,
        prepared: {
          evidence: launchEvidence('codex_cli', launch.executable, placed.placement),
          placement: placed.placement,
          run: async (signal) =>
            codexRunReport(
              await ports.run(request, optionsFor(ports, launch, plan, placed, signal)),
              plan.access
            )
        }
      }
    }
  }
}
