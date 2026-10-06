import type { ChildSessionOutcome } from './codex-exec-child-session'
import { evaluateCodexExecCompletion, type CodexExecSchemaCheck } from './codex-exec-completion'
import { readLastMessage, type CodexExecLastMessageCheck } from './codex-exec-last-message'
import {
  buildCodexExecResult,
  NO_LAST_MESSAGE,
  NOT_STARTED_PROOF,
  recordLastMessage,
  type CodexExecResult,
  type CodexExecResultInput
} from './codex-exec-result'
import type { LaunchPlan } from './codex-exec-run-launch'
import type { CodexExecLimits } from './codex-exec-run-options'
import type { PreparedCodexExecRun } from './codex-exec-run-preparation'
import type {
  CodexExecCancellation,
  CodexExecFailure,
  CodexExecTreeProof,
  CodexExecVerdict
} from './codex-exec-types'

export type RunClock = { readonly startedAtMs: number; readonly startedPerf: number }

export function startRunClock(): RunClock {
  return { startedAtMs: Date.now(), startedPerf: performance.now() }
}

type Ran = Extract<ChildSessionOutcome, { kind: 'ran' }>

export function failedVerdict(kind: CodexExecFailure['kind'], detail: string): CodexExecVerdict {
  return { status: 'failed', failures: [{ kind, detail }] }
}

const NOT_CANCELLED: CodexExecCancellation = { requested: false }

/** A run that never started: nothing to read, no tree, and the clock stops now. */
export function buildRunResult(
  clock: RunClock,
  fields: Partial<CodexExecResultInput> & Pick<CodexExecResultInput, 'verdict'>
): CodexExecResult {
  return buildCodexExecResult({
    startedAtMs: clock.startedAtMs,
    durationMs: Math.round(performance.now() - clock.startedPerf),
    applied: null,
    evidence: null,
    runDir: null,
    lastMessage: NO_LAST_MESSAGE,
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
  run: PreparedCodexExecRun,
  plan: LaunchPlan
): CodexExecResult {
  const proof: CodexExecTreeProof = plan.versionProbeStarted
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
    argv: run.argv,
    envNames: plan.envNames
  })
}

function userStop(session: Ran): { trigger: 'abort_signal' | 'timeout' } | null {
  const trigger = session.termination?.trigger
  return trigger === 'abort_signal' || trigger === 'timeout' ? { trigger } : null
}

function stoppedVerdict(session: Ran): CodexExecVerdict | null {
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

function cancellationOf(session: Ran): CodexExecCancellation {
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

function schemaCheckFor(
  run: PreparedCodexExecRun,
  lastMessage: CodexExecLastMessageCheck
): CodexExecSchemaCheck {
  // A missing or empty message is already a failure of its own; there is nothing to validate.
  if (run.schema === null || lastMessage.state !== 'ok') {
    return { kind: 'not_required' }
  }
  try {
    const check = run.schema.validate(lastMessage.text)
    if (check.ok) {
      return { kind: 'passed' }
    }
    return { kind: check.kind === 'violation' ? 'failed' : 'unvalidatable', detail: check.detail }
  } catch {
    return { kind: 'unvalidatable', detail: 'The validator failed on this document.' }
  }
}

export type FinishInput = {
  readonly clock: RunClock
  readonly run: PreparedCodexExecRun
  readonly plan: LaunchPlan
  readonly limits: CodexExecLimits
  readonly session: ChildSessionOutcome
}

/** Turn a finished child into the typed record: stopped, never started, or judged by the completion rule. */
export async function finishCodexExecRun(input: FinishInput): Promise<CodexExecResult> {
  const { clock, run, plan, session } = input
  const common = {
    applied: run.applied,
    evidence: plan.evidence,
    runDir: run.location.runDir,
    argv: run.argv,
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
  const lastMessage = await readLastMessage(
    run.location.lastMessagePath,
    input.limits.maxLastMessageBytes
  )
  const verdict = evaluateCodexExecCompletion({
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    stream: session.stream,
    lastMessage,
    schemaCheck: schemaCheckFor(run, lastMessage),
    stderrTail: session.stderrTail,
    descendantOutlivedRoot: session.descendantOutlivedRoot
  })
  return buildRunResult(clock, {
    ...common,
    verdict,
    lastMessage: recordLastMessage(run.location.lastMessagePath, lastMessage)
  })
}
