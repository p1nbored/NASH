import { createOutputSink } from '../../shared/child-process/bounded-output-sink'
import type { TranscriptSink } from '../agent-exec-shared/attempt-transcript'
import { createTranscriptLineSplitter } from '../agent-exec-shared/attempt-transcript-lines'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'
import {
  runManagedChild,
  type ChildIo,
  type ManagedChildOutcome,
  type SpawnedChild
} from '../agent-exec-shared/managed-child-session'
import { redactSecretLikeText } from '../agent-exec-shared/secret-redaction'
import type { TreeTerminationDeps } from '../agent-exec-shared/tree-termination'
import { createAgyOutputCapture, type AgyOutputCapture } from './agy-exec-output'

// One agy child from spawn to settlement: stdout is the answer, kept bounded, and stderr a bounded redacted tail.

export type AgySessionInput = {
  readonly executable: LaunchTarget
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Record<string, string>
  readonly signal?: AbortSignal
  readonly timeoutMs: number | null
  readonly graceMs: number
  readonly verifyMs: number
  readonly drainGraceMs: number
  readonly maxOutputBytes: number
  readonly maxStderrBytes: number
  /** Gets every stdout and stderr line for the attempt transcript; it never waits. */
  readonly transcript?: TranscriptSink
  /** Decides whether the child leads its own process group; defaults to the host platform. */
  readonly platform?: NodeJS.Platform
  readonly termination?: Partial<TreeTerminationDeps>
}

export type AgySessionSummary = {
  readonly capture: AgyOutputCapture
  /** The redacted tail of stderr and whether older output was dropped. */
  readonly stderrTail: string
  readonly stderrTruncated: boolean
}

export type AgySessionOutcome = ManagedChildOutcome<AgySessionSummary>

type AgyIo = ChildIo & {
  readonly capture: AgyOutputCapture
  readonly stderr: () => { readonly text: string; readonly truncated: boolean }
}

function attachAgyIo(
  child: SpawnedChild,
  input: AgySessionInput,
  requestStop: (trigger: 'output_limit') => void
): AgyIo {
  const capture = createAgyOutputCapture(input.maxOutputBytes, () => requestStop('output_limit'))
  const stderrSink = createOutputSink(input.maxStderrBytes, 'tail')
  const { transcript } = input
  const stdoutLines =
    transcript === undefined ? null : createTranscriptLineSplitter('stdout', transcript)
  const stderrLines =
    transcript === undefined ? null : createTranscriptLineSplitter('stderr', transcript)
  child.stdout.on('data', (chunk: Buffer) => {
    capture.write(chunk)
    stdoutLines?.push(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderrSink.write(chunk)
    stderrLines?.push(chunk)
  })
  // Why no-op handlers: an unhandled stream error (EPIPE on a child that never reads stdin) would crash the process.
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on('error', () => {})
  }
  return {
    capture,
    stderr: () => ({
      text: redactSecretLikeText(stderrSink.text()),
      truncated: stderrSink.truncated()
    }),
    close: () => {
      stdoutLines?.end()
      stderrLines?.end()
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }
  }
}

export function runAgySession(input: AgySessionInput): Promise<AgySessionOutcome> {
  return runManagedChild({
    executable: input.executable,
    argv: input.argv,
    // The prompt is on argv, so stdin is closed empty: agy never waits on it.
    stdinText: '',
    cwd: input.cwd,
    env: input.env,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    graceMs: input.graceMs,
    verifyMs: input.verifyMs,
    drainGraceMs: input.drainGraceMs,
    platform: input.platform,
    termination: input.termination,
    attachIo: (child, requestStop) => attachAgyIo(child, input, requestStop),
    summarize: (io): AgySessionSummary => {
      const stderr = io.stderr()
      return { capture: io.capture, stderrTail: stderr.text, stderrTruncated: stderr.truncated }
    }
  })
}
