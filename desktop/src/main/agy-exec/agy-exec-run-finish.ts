import { describeAgyExecArgv } from './agy-exec-argv'
import { evaluateAgyExecCompletion } from './agy-exec-completion'
import { finalizeAgyOutput } from './agy-exec-output'
import {
  buildAgyExecResult,
  NO_OUTPUT,
  NOT_STARTED_PROOF,
  type AgyExecResult,
  type AgyExecResultInput
} from './agy-exec-result'
import type { AgyLaunchPlan } from './agy-exec-run-launch'
import type { AgyExecLimits } from './agy-exec-run-options'
import type { PreparedAgyExecRun } from './agy-exec-run-preparation'
import type { AgySessionOutcome } from './agy-exec-session'
import type {
  AgyExecCancellation,
  AgyExecFailure,
  AgyExecTreeProof,
  AgyExecVerdict
} from './agy-exec-types'

export type RunClock = { readonly startedAtMs: number; readonly startedPerf: number }

export function startRunClock(): RunClock {
  return { startedAtMs: Date.now(), startedPerf: performance.now() }
}

type Ran = Extract<AgySessionOutcome, { kind: 'ran' }>

export function failedVerdict(kind: AgyExecFailure['kind'], detail: string): AgyExecVerdict {
  return { status: 'failed', failures: [{ kind, detail }] }
}

const NOT_CANCELLED: AgyExecCancellation = { requested: false }

/** A run that never started: nothing to read, no tree, and the clock stops now. */
export function buildRunResult(
  clock: RunClock,
  fields: Partial<AgyExecResultInput> & Pick<AgyExecResultInput, 'verdict'>
): AgyExecResult {
  return buildAgyExecResult({
    startedAtMs: clock.startedAtMs,
    durationMs: Math.round(performance.now() - clock.startedPerf),
    applied: null,
    evidence: null,
    runDir: null,
    output: NO_OUTPUT,
    session: null,
    cancellation: NOT_CANCELLED,
    treeProofWithoutSession: NOT_STARTED_PROOF,
    argv: [],
    envNames: [],
    ...fields
  })
}

/** The abort landed before any child existed; only the version probe may have been running. */
export function abortedBeforeStart(
  clock: RunClock,
  run: PreparedAgyExecRun,
  plan: AgyLaunchPlan
): AgyExecResult {
  const proof: AgyExecTreeProof = plan.versionProbeStarted
    ? { verdict: 'unverifiable', method: 'version_probe_unproven' }
    : NOT_STARTED_PROOF
  return buildRunResult(clock, {
    verdict: failedVerdict('cancelled', 'The run was aborted before a process started.'),
    applied: run.applied,
    evidence: plan.evidence,
    runDir: run.location.runDir,
    cancellation: {
      requested: true,
      trigger: 'abort_signal',
      spawned: false,
      ...proof,
      rootExited: false,
      escalatedToForce: false
    },
    treeProofWithoutSession: proof,
    argv: describeAgyExecArgv(run.argv),
    envNames: plan.envNames
  })
}

function userStop(session: Ran): { trigger: 'abort_signal' | 'timeout' } | null {
  const trigger = session.termination?.trigger
  return trigger === 'abort_signal' || trigger === 'timeout' ? { trigger } : null
}

function stoppedVerdict(session: Ran): AgyExecVerdict | null {
  const stop = userStop(session)
  if (stop === null) {
    return null
  }
  const timedOut = stop.trigger === 'timeout'
  const tree = `${session.treeProof.verdict} (${session.treeProof.method})`
  return failedVerdict(
    timedOut ? 'timed_out' : 'cancelled',
    `The run ${timedOut ? 'exceeded its timeout' : 'was cancelled'}; tree: ${tree}.`
  )
}

function cancellationOf(session: Ran): AgyExecCancellation {
  const stop = userStop(session)
  if (stop === null || session.termination === null) {
    return NOT_CANCELLED
  }
  const { outcome } = session.termination
  return {
    requested: true,
    trigger: stop.trigger,
    spawned: true,
    verdict: outcome.verdict,
    method: outcome.method,
    rootExited: outcome.rootExited,
    escalatedToForce: outcome.escalatedToForce
  }
}

export type FinishInput = {
  readonly clock: RunClock
  readonly run: PreparedAgyExecRun
  readonly plan: AgyLaunchPlan
  readonly limits: AgyExecLimits
  readonly session: AgySessionOutcome
}

/** Turn a finished child into the typed record: stopped, never started, or judged by the completion rule. */
export async function finishAgyExecRun(input: FinishInput): Promise<AgyExecResult> {
  const { clock, run, plan, session } = input
  const common = {
    applied: run.applied,
    evidence: plan.evidence,
    runDir: run.location.runDir,
    argv: describeAgyExecArgv(run.argv),
    envNames: plan.envNames,
    session
  }
  if (session.kind === 'not_started') {
    return buildRunResult(clock, {
      ...common,
      verdict: failedVerdict('spawn_failed', session.spawnError)
    })
  }
  const stopped = stoppedVerdict(session)
  if (stopped !== null) {
    return buildRunResult(clock, {
      ...common,
      verdict: stopped,
      cancellation: cancellationOf(session)
    })
  }
  const output = await finalizeAgyOutput(session.summary.capture, {
    path: run.location.outputPath,
    maxPreviewChars: input.limits.maxPreviewChars
  })
  const verdict = evaluateAgyExecCompletion({
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    output,
    stderrTail: session.summary.stderrTail,
    descendantOutlivedRoot: session.descendantOutlivedRoot
  })
  return buildRunResult(clock, { ...common, verdict, output })
}
