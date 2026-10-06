import type { TranscriptSink } from '../agent-exec-shared/attempt-transcript'
import { openRunTranscript, settleRunTranscript } from '../agent-exec-shared/attempt-transcript-run'
import { runChildSession, type ChildSessionInput } from './codex-exec-child-session'
import type { CodexExecResult } from './codex-exec-result'
import {
  abortedBeforeStart,
  buildRunResult,
  failedVerdict,
  finishCodexExecRun,
  startRunClock
} from './codex-exec-run-finish'
import { launchTargetRefusal, planLaunch, type LaunchPlan } from './codex-exec-run-launch'
import {
  resolveRunDeps,
  resolveRunOptions,
  type CodexExecRunDeps,
  type CodexExecRunOptions,
  type ResolvedCodexExecOptions
} from './codex-exec-run-options'
import { prepareCodexExecRun, type PreparedCodexExecRun } from './codex-exec-run-preparation'
import type { CodexExecRequest } from './codex-exec-types'
import { codexTranscriptStart } from './codex-transcript-records'

export type { CodexExecResult, CodexExecLastMessageRecord } from './codex-exec-result'
export type {
  CodexExecRunDeps,
  CodexExecRunOptions,
  CodexExecLimits
} from './codex-exec-run-options'

function sessionInput(
  run: PreparedCodexExecRun,
  plan: LaunchPlan,
  options: CodexExecRunOptions,
  resolved: ResolvedCodexExecOptions,
  deps: CodexExecRunDeps,
  transcript: TranscriptSink | null
): ChildSessionInput {
  const { limits, timing } = resolved
  return {
    ...(transcript === null ? {} : { transcript }),
    executable: options.executable,
    argv: run.argv,
    prompt: run.prompt,
    cwd: run.worktreePath,
    env: plan.env,
    signal: options.signal,
    timeoutMs: timing.timeoutMs,
    graceMs: timing.graceMs,
    verifyMs: timing.verifyMs,
    maxLineBytes: limits.maxLineBytes,
    maxStderrBytes: limits.maxStderrBytes,
    drainGraceMs: limits.drainGraceMs,
    stream: limits.stream,
    onEvent: options.onEvent,
    platform: deps.platform,
    termination: deps.termination
  }
}

/**
 * Run one headless `codex exec` and return a typed record; expected failures are verdicts, never rejections.
 * Windows proves only the root's exit (read treeProof), and the host must abort on app quit or a run outlives Orca.
 */
export async function runCodexExec(
  request: CodexExecRequest,
  options: CodexExecRunOptions
): Promise<CodexExecResult> {
  const clock = startRunClock()
  const resolved = resolveRunOptions(options)
  if (!resolved.ok) {
    return buildRunResult(clock, { verdict: failedVerdict('invalid_request', resolved.detail) })
  }
  const deps = resolveRunDeps(options.deps)
  const prepared = await prepareCodexExecRun(request, resolved.value.limits, deps, (validated) =>
    launchTargetRefusal(validated, options, deps)
  )
  if (!prepared.ok) {
    return buildRunResult(clock, {
      verdict: { status: 'failed', failures: [prepared.failure] }
    })
  }
  const plan = await planLaunch(prepared.run, options, deps)
  if (options.signal?.aborted) {
    return abortedBeforeStart(clock, prepared.run, plan)
  }
  const transcript = openRunTranscript(options.transcript, {
    runDir: prepared.run.location.runDir,
    platform: deps.platform,
    start: codexTranscriptStart(
      prepared.run.applied,
      prepared.run.worktreePath,
      options.transcript?.worktree ?? null
    ),
    deps: deps.transcript
  })
  const session = await runChildSession(
    sessionInput(prepared.run, plan, options, resolved.value, deps, transcript)
  )
  const result = await finishCodexExecRun({
    clock,
    run: prepared.run,
    plan,
    limits: resolved.value.limits,
    session
  })
  return settleRunTranscript(transcript, result)
}
