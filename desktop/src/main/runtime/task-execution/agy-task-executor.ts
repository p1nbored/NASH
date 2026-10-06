import { attemptTranscriptPath } from '../../agent-exec-shared/attempt-transcript'
import type { LaunchTarget } from '../../agent-exec-shared/launch-target'
import { buildAgyExecArgv } from '../../agy-exec/agy-exec-argv'
import { agyCommandLineProblem } from '../../agy-exec/agy-exec-command-line'
import type { AgyExecResult } from '../../agy-exec/agy-exec-result'
import type { AgyExecRunOptions } from '../../agy-exec/agy-exec-run-options'
import type { AgyExecRequest } from '../../agy-exec/agy-exec-types'
import { placeAttempt, transcriptWorktreeOf, type PlacedAttempt } from './attempt-workspace'
import type { ExecutorRunReport } from './executor-run-report'
import { agyAppliedAccess, agySandboxForAccess, type RunAccess } from './executor-sandbox-policy'
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

export type AgyTaskExecutorPorts = ProcessLaunchPorts & {
  /** `runAgyExec`; injected so tests drive a fake. */
  readonly run: (request: AgyExecRequest, options: AgyExecRunOptions) => Promise<AgyExecResult>
  /** `resolveAgyExecutable` bound by the host; agy ships as a native binary. */
  readonly resolveExecutable: () => LaunchTarget & { readonly source?: string }
}

/** The runner-neutral record of one agy run; the answer, its preview and stderr stay behind. */
export function agyRunReport(result: AgyExecResult, requested: RunAccess): ExecutorRunReport {
  const { output } = result
  return {
    verdict: runnerVerdict(result.verdict),
    spawned: result.spawned,
    exitCode: result.exitCode,
    cancellation: cancellationOf(result.cancellation),
    treeProof: result.treeProof,
    lastMessage:
      output.state === 'ok'
        ? { sha256: output.sha256, bytes: output.bytes, secretLike: output.secretLike }
        : null,
    usage: null,
    threadId: null,
    facts: executableFacts(result.evidence, result.timing.durationMs),
    sandbox: { requested, applied: agyAppliedAccess(result) }
  }
}

// Why: the variant id (gemini-3.8-flash-high) encodes the thinking level, and whether agy combines a
// level flag with a variant id is unverified, so the request never carries one.
function requestFor(
  plan: ProcessAttemptPlan,
  prompt: string,
  launch: ResolvedLaunch<LaunchTarget>,
  placed: PlacedAttempt
): AgyExecRequest {
  return {
    prompt,
    model: plan.cli.model,
    // D-025: a write run drops --sandbox and adds nothing; agy's own print-mode defaults apply.
    sandbox: agySandboxForAccess(plan.access),
    worktreePath: placed.cwd,
    runsRoot: launch.runsRoot,
    runId: plan.dispatchId
  }
}

function optionsFor(
  ports: AgyTaskExecutorPorts,
  launch: ResolvedLaunch<LaunchTarget>,
  plan: ProcessAttemptPlan,
  placed: PlacedAttempt,
  signal: AbortSignal
): AgyExecRunOptions {
  const worktree = transcriptWorktreeOf(placed.placement)
  return {
    executable: launch.executable,
    ...(launch.parentEnv === undefined ? {} : { parentEnv: launch.parentEnv }),
    signal,
    // D-027: no fixed timeout; the run ends when agy ends or the user stops it.
    ...(ports.timeoutMs === undefined ? {} : { timeoutMs: ports.timeoutMs }),
    // D-024: the read-only task window shows this attempt's transcript, kept in its run directory.
    transcript: {
      path: attemptTranscriptPath(launch.runsRoot, plan.dispatchId),
      ...(worktree === null ? {} : { worktree })
    }
  }
}

/** Whether the OS can start this prompt on agy's command line; the runner checks again with the child env. */
function promptFitsCommandLine(
  prompt: string,
  plan: ProcessAttemptPlan,
  launch: ResolvedLaunch<LaunchTarget>
): boolean {
  let argv: readonly string[]
  try {
    argv = buildAgyExecArgv({
      sandbox: agySandboxForAccess(plan.access),
      prompt,
      model: plan.cli.model
    })
  } catch {
    // A model or prompt the argv builder refuses is reported by the runner with its own code.
    return true
  }
  const problem = agyCommandLineProblem({
    executable: launch.executable,
    argv,
    platform: process.platform,
    env: launch.parentEnv ?? process.env
  })
  return problem === null
}

/** agy keeps --sandbox only for a read-only run; the prompt rides argv, so the command line is checked first. */
export function createAgyTaskExecutor(ports: AgyTaskExecutorPorts): ProcessTaskExecutor {
  return {
    kind: 'agy_cli',
    async prepare(plan): Promise<PrepareOutcome> {
      const prompt = buildExecutorTaskPrompt(plan.prompt, plan.access)
      const resolved = await resolveLaunch(ports, ports.resolveExecutable, plan)
      if (!resolved.ok) {
        return resolved
      }
      const { launch } = resolved
      if (!promptFitsCommandLine(prompt, plan, launch)) {
        return { ok: false, reason: 'prompt_too_long' }
      }
      // Why last: every refusal above leaves no worktree behind.
      const placement = await placeAttempt(ports.worktrees, plan, 'agy_cli', launch.worktreePath)
      if (!placement.ok) {
        return placement
      }
      const { placed } = placement
      const request = requestFor(plan, prompt, launch, placed)
      return {
        ok: true,
        prepared: {
          evidence: launchEvidence('agy_cli', launch.executable, placed.placement),
          placement: placed.placement,
          run: async (signal) =>
            agyRunReport(
              await ports.run(request, optionsFor(ports, launch, plan, placed, signal)),
              plan.access
            )
        }
      }
    }
  }
}
