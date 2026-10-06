import type {
  TranscriptStart,
  TranscriptWorktree
} from '../agent-exec-shared/attempt-transcript-records'
import { openRunTranscript, settleRunTranscript } from '../agent-exec-shared/attempt-transcript-run'
import { launchTargetRefusal, planAgyLaunch } from './agy-exec-run-launch'
import {
  abortedBeforeStart,
  buildRunResult,
  failedVerdict,
  finishAgyExecRun,
  startRunClock
} from './agy-exec-run-finish'
import {
  resolveAgyRunDeps,
  resolveAgyRunOptions,
  type AgyExecRunOptions
} from './agy-exec-run-options'
import { prepareAgyExecRun, type PreparedAgyExecRun } from './agy-exec-run-preparation'
import type { AgyExecResult } from './agy-exec-result'
import { runAgySession } from './agy-exec-session'
import type { AgyExecRequest } from './agy-exec-types'

export type { AgyExecResult } from './agy-exec-result'
export type { AgyExecRunDeps, AgyExecRunOptions, AgyExecLimits } from './agy-exec-run-options'

/** The `start` record of an agy attempt; the sandbox is read from the argv actually used. */
function agyTranscriptStart(
  run: PreparedAgyExecRun,
  worktree: TranscriptWorktree | null
): TranscriptStart {
  return {
    executor: 'agy',
    model: run.applied.model,
    effort: run.applied.effort,
    sandbox: run.argv.includes('--sandbox') ? 'read-only' : 'write',
    cwd: run.worktreePath,
    worktree
  }
}

/**
 * Run one headless `agy --print` and return a typed record; expected failures are verdicts, never rejections.
 * agy has no read-only flag: `--sandbox` only restricts its terminal, and its write behaviour under --print is
 * unverified, so a caller that needs a read-only run must check the workspace afterwards. Windows proves only
 * the root's exit (read treeProof), and the host must abort on app quit or a run outlives Orca.
 */
export async function runAgyExec(
  request: AgyExecRequest,
  options: AgyExecRunOptions
): Promise<AgyExecResult> {
  const clock = startRunClock()
  const resolved = resolveAgyRunOptions(options)
  if (!resolved.ok) {
    return buildRunResult(clock, { verdict: failedVerdict('invalid_request', resolved.detail) })
  }
  const { limits, timing } = resolved.value
  const deps = resolveAgyRunDeps(options.deps)
  const prepared = await prepareAgyExecRun(request, deps, (validated) =>
    launchTargetRefusal(validated, options, deps)
  )
  if (!prepared.ok) {
    return buildRunResult(clock, { verdict: { status: 'failed', failures: [prepared.failure] } })
  }
  const plan = await planAgyLaunch(prepared.run, options, deps)
  if (options.signal?.aborted) {
    return abortedBeforeStart(clock, prepared.run, plan)
  }
  const transcript = openRunTranscript(options.transcript, {
    runDir: prepared.run.location.runDir,
    platform: deps.platform,
    start: agyTranscriptStart(prepared.run, options.transcript?.worktree ?? null),
    deps: deps.transcript
  })
  const session = await runAgySession({
    ...(transcript === null ? {} : { transcript }),
    executable: options.executable,
    argv: prepared.run.argv,
    cwd: prepared.run.worktreePath,
    env: plan.env,
    signal: options.signal,
    timeoutMs: timing.timeoutMs,
    graceMs: timing.graceMs,
    verifyMs: timing.verifyMs,
    drainGraceMs: limits.drainGraceMs,
    maxOutputBytes: limits.maxOutputBytes,
    maxStderrBytes: limits.maxStderrBytes,
    platform: deps.platform,
    termination: deps.termination
  })
  const result = await finishAgyExecRun({ clock, run: prepared.run, plan, limits, session })
  return settleRunTranscript(transcript, result)
}
