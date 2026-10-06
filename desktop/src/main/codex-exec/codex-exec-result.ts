import type { ChildSessionOutcome } from './codex-exec-child-session'
import type { AttemptTranscriptOutcome } from '../agent-exec-shared/attempt-transcript'
import type { ExecutableEvidence } from '../agent-exec-shared/executable-evidence'
import type { CodexExecLastMessageCheck } from './codex-exec-last-message'
import { createCodexExecStreamState, type CodexExecStreamSummary } from './codex-exec-stream-state'
import type {
  CodexExecApplied,
  CodexExecCancellation,
  CodexExecTreeProof,
  CodexExecUsage,
  CodexExecVerdict
} from './codex-exec-types'

/** Where the final message stands; its text is never carried, only whether and how to find it. */
export type CodexExecLastMessageRecord =
  | {
      readonly state: 'ok'
      readonly path: string
      readonly bytes: number
      readonly sha256: string
      /** A credential shape occurs in the file; treat the text as sensitive before forwarding it. */
      readonly secretLike: boolean
    }
  | {
      readonly state: 'oversized'
      readonly path: string
      readonly bytes: number
      readonly sha256: null
      readonly secretLike: null
    }
  | {
      readonly state: 'missing' | 'empty' | 'unreadable'
      readonly path: string
      readonly bytes: null
      readonly sha256: null
      readonly secretLike: null
    }
  | {
      readonly state: 'not_read'
      readonly path: string | null
      readonly bytes: null
      readonly sha256: null
      readonly secretLike: null
    }

/** The record one run leaves behind; the prompt and message text are deliberately absent. */
export type CodexExecResult = {
  readonly verdict: CodexExecVerdict
  /** True once a process was actually created. */
  readonly spawned: boolean
  /** Set only when exactly one thread.started was seen. */
  readonly threadId: string | null
  readonly threadStartedCount: number
  readonly exitCode: number | null
  readonly exitSignal: NodeJS.Signals | null
  /** From the final turn.completed, as reported; absent fields stay null. */
  readonly usage: CodexExecUsage | null
  /** Model, effort and sandbox as requested via argv; null when the request was refused. */
  readonly applied: CodexExecApplied | null
  /** Only ever what an event reported; never filled in from the request. */
  readonly reportedModel: string | null
  /** True only when a reported model equals the requested one. */
  readonly exactModelVerified: boolean
  readonly timing: { readonly startedAt: string; readonly durationMs: number }
  readonly evidence: ExecutableEvidence | null
  /** The per-run directory this module created, or null when the request never got that far. */
  readonly runDir: string | null
  readonly lastMessage: CodexExecLastMessageRecord
  readonly stream: CodexExecStreamSummary
  readonly stdoutBytes: number
  /** True when a surviving helper held stdout open past the drain grace. */
  readonly stdoutDrainTimedOut: boolean
  readonly stderrTail: string
  readonly stderrTruncated: boolean
  readonly listenerErrorCount: number
  readonly cancellation: CodexExecCancellation
  /** What is known about the process tree at the end; `exited` always names its evidence. */
  readonly treeProof: CodexExecTreeProof
  /** The argv given to codex (prompt excluded: it travels on stdin). */
  readonly argv: readonly string[]
  /** Names only, never values, of what the child environment contained. */
  readonly envNames: readonly string[]
  /** How writing the attempt transcript went, as counts and a code; null when none was asked for. */
  readonly transcript: AttemptTranscriptOutcome | null
}

export type CodexExecResultInput = {
  readonly verdict: CodexExecVerdict
  readonly startedAtMs: number
  readonly durationMs: number
  readonly applied: CodexExecApplied | null
  readonly evidence: ExecutableEvidence | null
  readonly runDir: string | null
  readonly lastMessage: CodexExecLastMessageRecord
  readonly session: ChildSessionOutcome | null
  readonly cancellation: CodexExecCancellation
  /** Used only when no session ran; a ran session carries its own proof. */
  readonly treeProofWithoutSession: CodexExecTreeProof
  readonly argv: readonly string[]
  readonly envNames: readonly string[]
}

export const NOT_STARTED_PROOF: CodexExecTreeProof = { verdict: 'exited', method: 'not_started' }

export const NO_LAST_MESSAGE: CodexExecLastMessageRecord = {
  state: 'not_read',
  path: null,
  bytes: null,
  sha256: null,
  secretLike: null
}

export function recordLastMessage(
  path: string,
  check: CodexExecLastMessageCheck
): CodexExecLastMessageRecord {
  switch (check.state) {
    case 'ok':
      return {
        state: 'ok',
        path,
        bytes: check.bytes,
        sha256: check.sha256,
        secretLike: check.secretLike
      }
    case 'oversized':
      return { state: 'oversized', path, bytes: check.bytes, sha256: null, secretLike: null }
    case 'missing':
    case 'empty':
    case 'unreadable':
      return { state: check.state, path, bytes: null, sha256: null, secretLike: null }
  }
}

type SessionFields = Pick<
  CodexExecResult,
  | 'spawned'
  | 'exitCode'
  | 'exitSignal'
  | 'stream'
  | 'stdoutBytes'
  | 'stdoutDrainTimedOut'
  | 'stderrTail'
  | 'stderrTruncated'
  | 'listenerErrorCount'
  | 'treeProof'
>

function sessionFields(input: CodexExecResultInput): SessionFields {
  const { session } = input
  if (session === null || session.kind === 'not_started') {
    return {
      spawned: false,
      exitCode: null,
      exitSignal: null,
      stream: createCodexExecStreamState().summary(),
      stdoutBytes: 0,
      stdoutDrainTimedOut: false,
      stderrTail: '',
      stderrTruncated: false,
      listenerErrorCount: 0,
      treeProof: input.treeProofWithoutSession
    }
  }
  return {
    spawned: true,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    stream: session.stream,
    stdoutBytes: session.stdoutBytes,
    stdoutDrainTimedOut: session.stdoutDrainTimedOut,
    stderrTail: session.stderrTail,
    stderrTruncated: session.stderrTruncated,
    listenerErrorCount: session.listenerErrorCount,
    treeProof: session.treeProof
  }
}

export function buildCodexExecResult(input: CodexExecResultInput): CodexExecResult {
  const fields = sessionFields(input)
  const reportedModel = fields.stream.reportedModel
  return {
    ...fields,
    verdict: input.verdict,
    threadId: fields.stream.threadStartedCount === 1 ? (fields.stream.threadIds[0] ?? null) : null,
    threadStartedCount: fields.stream.threadStartedCount,
    usage: fields.stream.usage,
    applied: input.applied,
    reportedModel,
    exactModelVerified:
      reportedModel !== null && input.applied !== null && reportedModel === input.applied.model,
    timing: { startedAt: new Date(input.startedAtMs).toISOString(), durationMs: input.durationMs },
    evidence: input.evidence,
    runDir: input.runDir,
    lastMessage: input.lastMessage,
    cancellation: input.cancellation,
    argv: input.argv,
    envNames: input.envNames,
    transcript: null
  }
}
