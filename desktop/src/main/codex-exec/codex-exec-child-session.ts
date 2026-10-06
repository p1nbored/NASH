import {
  runManagedChild,
  type ManagedChildOutcome,
  type ManagedChildTermination
} from '../agent-exec-shared/managed-child-session'
import type { TranscriptSink } from '../agent-exec-shared/attempt-transcript'
import type { TreeProof, TreeTerminationDeps } from '../agent-exec-shared/tree-termination'
import type { CodexExecNormalizedEvent } from './codex-exec-event-normalizer'
import type { CodexExecutable } from './codex-exec-executable'
import { attachSessionIo } from './codex-exec-session-io'
import type { CodexExecStreamLimits, CodexExecStreamSummary } from './codex-exec-stream-state'

// One codex child from spawn to settlement; stdout is parsed as it arrives because a long run outgrows any buffer.

export type ChildSessionInput = {
  readonly executable: CodexExecutable
  readonly argv: readonly string[]
  readonly prompt: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly signal?: AbortSignal
  readonly timeoutMs: number | null
  readonly graceMs: number
  readonly verifyMs: number
  readonly maxLineBytes: number
  readonly maxStderrBytes: number
  readonly drainGraceMs: number
  readonly stream: Partial<CodexExecStreamLimits>
  readonly onEvent?: (event: CodexExecNormalizedEvent) => void | Promise<void>
  /** The attempt transcript, fed from the pipe handlers; absent when none was asked for. */
  readonly transcript?: TranscriptSink
  /** Decides whether the child leads its own process group; defaults to the host platform. */
  readonly platform?: NodeJS.Platform
  readonly termination?: Partial<TreeTerminationDeps>
}

/** Stops the user asked for, and sweeps the session itself started when a helper outlived the root. */
export type ChildSessionTermination = ManagedChildTermination

export type ChildSessionOutcome =
  | { readonly kind: 'not_started'; readonly spawnError: string }
  | {
      readonly kind: 'ran'
      readonly exitCode: number | null
      readonly exitSignal: NodeJS.Signals | null
      readonly stream: CodexExecStreamSummary
      readonly stdoutBytes: number
      readonly stderrTail: string
      readonly stderrTruncated: boolean
      /** A helper held stdout open past the drain grace after the root exited. */
      readonly stdoutDrainTimedOut: boolean
      /** A helper held the output open or lived on after the root exited, so it may still write. */
      readonly descendantOutlivedRoot: boolean
      readonly termination: ChildSessionTermination | null
      /** What is known about the whole tree at the end, from the termination or the exit probe. */
      readonly treeProof: TreeProof
      readonly listenerErrorCount: number
    }

type CodexStreamSummary = {
  readonly stream: CodexExecStreamSummary
  readonly stdoutBytes: number
  readonly stderrTail: string
  readonly stderrTruncated: boolean
  readonly listenerErrorCount: number
}

function toChildSessionOutcome(
  outcome: ManagedChildOutcome<CodexStreamSummary>
): ChildSessionOutcome {
  if (outcome.kind === 'not_started') {
    return outcome
  }
  const { summary, ...rest } = outcome
  return { ...rest, ...summary }
}

export async function runChildSession(input: ChildSessionInput): Promise<ChildSessionOutcome> {
  const outcome = await runManagedChild({
    executable: input.executable,
    argv: input.argv,
    stdinText: input.prompt,
    cwd: input.cwd,
    env: input.env,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    graceMs: input.graceMs,
    verifyMs: input.verifyMs,
    drainGraceMs: input.drainGraceMs,
    platform: input.platform,
    termination: input.termination,
    attachIo: (child) => attachSessionIo(child, input),
    summarize: (io): CodexStreamSummary => {
      const stderr = io.stderr()
      return {
        stream: io.state.summary(),
        stdoutBytes: io.stdoutBytes(),
        stderrTail: stderr.text,
        stderrTruncated: stderr.truncated,
        listenerErrorCount: io.listenerErrors()
      }
    }
  })
  return toChildSessionOutcome(outcome)
}
