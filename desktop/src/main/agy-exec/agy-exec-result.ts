import type { AttemptTranscriptOutcome } from '../agent-exec-shared/attempt-transcript'
import type { ExecutableEvidence } from '../agent-exec-shared/executable-evidence'
import type { AgySessionOutcome } from './agy-exec-session'
import type {
  AgyExecApplied,
  AgyExecCancellation,
  AgyExecOutputRecord,
  AgyExecTreeProof,
  AgyExecVerdict
} from './agy-exec-types'

/** The record one run leaves behind; the prompt and the answer text are deliberately absent. */
export type AgyExecResult = {
  readonly verdict: AgyExecVerdict
  /** True once a process was actually created. */
  readonly spawned: boolean
  readonly exitCode: number | null
  readonly exitSignal: NodeJS.Signals | null
  /** Model and effort as requested via argv; null when the request was refused. */
  readonly applied: AgyExecApplied | null
  readonly timing: { readonly startedAt: string; readonly durationMs: number }
  readonly evidence: ExecutableEvidence | null
  /** The per-run directory this module created, or null when the request never got that far. */
  readonly runDir: string | null
  readonly output: AgyExecOutputRecord
  /** Every byte stdout produced, including any past the output limit. */
  readonly stdoutBytes: number
  /** True when a surviving helper held stdout open past the drain grace. */
  readonly stdoutDrainTimedOut: boolean
  readonly stderrTail: string
  readonly stderrTruncated: boolean
  readonly cancellation: AgyExecCancellation
  /** What is known about the process tree at the end; `exited` always names its evidence. */
  readonly treeProof: AgyExecTreeProof
  /** The argv given to agy with the prompt replaced by its length. */
  readonly argv: readonly string[]
  /** Names only, never values, of what the child environment contained. */
  readonly envNames: readonly string[]
  /** How writing the attempt transcript went, as counts and a code; null when none was asked for. */
  readonly transcript: AttemptTranscriptOutcome | null
}

export type AgyExecResultInput = {
  readonly verdict: AgyExecVerdict
  readonly startedAtMs: number
  readonly durationMs: number
  readonly applied: AgyExecApplied | null
  readonly evidence: ExecutableEvidence | null
  readonly runDir: string | null
  readonly output: AgyExecOutputRecord
  readonly session: AgySessionOutcome | null
  readonly cancellation: AgyExecCancellation
  /** Used only when no session ran; a ran session carries its own proof. */
  readonly treeProofWithoutSession: AgyExecTreeProof
  readonly argv: readonly string[]
  readonly envNames: readonly string[]
}

export const NOT_STARTED_PROOF: AgyExecTreeProof = { verdict: 'exited', method: 'not_started' }

export const NO_OUTPUT: AgyExecOutputRecord = {
  state: 'not_read',
  path: null,
  bytes: null,
  sha256: null,
  secretLike: null,
  preview: '',
  previewTruncated: false
}

type SessionFields = Pick<
  AgyExecResult,
  | 'spawned'
  | 'exitCode'
  | 'exitSignal'
  | 'stdoutBytes'
  | 'stdoutDrainTimedOut'
  | 'stderrTail'
  | 'stderrTruncated'
  | 'treeProof'
>

function sessionFields(input: AgyExecResultInput): SessionFields {
  const { session } = input
  if (session === null || session.kind === 'not_started') {
    return {
      spawned: false,
      exitCode: null,
      exitSignal: null,
      stdoutBytes: 0,
      stdoutDrainTimedOut: false,
      stderrTail: '',
      stderrTruncated: false,
      treeProof: input.treeProofWithoutSession
    }
  }
  return {
    spawned: true,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    stdoutBytes: session.summary.capture.totalBytes(),
    stdoutDrainTimedOut: session.stdoutDrainTimedOut,
    stderrTail: session.summary.stderrTail,
    stderrTruncated: session.summary.stderrTruncated,
    treeProof: session.treeProof
  }
}

export function buildAgyExecResult(input: AgyExecResultInput): AgyExecResult {
  return {
    ...sessionFields(input),
    verdict: input.verdict,
    applied: input.applied,
    timing: { startedAt: new Date(input.startedAtMs).toISOString(), durationMs: input.durationMs },
    evidence: input.evidence,
    runDir: input.runDir,
    output: input.output,
    cancellation: input.cancellation,
    argv: input.argv,
    envNames: input.envNames,
    transcript: null
  }
}
