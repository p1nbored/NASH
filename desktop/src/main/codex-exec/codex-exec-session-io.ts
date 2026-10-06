import { createOutputSink } from '../../shared/child-process/bounded-output-sink'
import type { spawnProcess } from '../../shared/child-process/run-process'
import type { TranscriptSink } from '../agent-exec-shared/attempt-transcript'
import { createTranscriptLineSplitter } from '../agent-exec-shared/attempt-transcript-lines'
import type { CodexExecNormalizedEvent } from './codex-exec-event-normalizer'
import { createJsonlLineReader } from './codex-exec-jsonl-line-reader'
import { redactSecretLikeText } from '../agent-exec-shared/secret-redaction'
import { createCodexExecStreamState, type CodexExecStreamState } from './codex-exec-stream-state'
import type { CodexExecStreamLimits } from './codex-exec-stream-state'
import { appendCodexStdoutLine } from './codex-transcript-records'

// Everything one child's three pipes feed: the parsed stream, a bounded stderr tail and counters.

type SessionChild = Pick<ReturnType<typeof spawnProcess>, 'stdin' | 'stdout' | 'stderr'>

export type SessionIoOptions = {
  readonly maxLineBytes: number
  readonly maxStderrBytes: number
  readonly stream: Partial<CodexExecStreamLimits>
  readonly onEvent?: (event: CodexExecNormalizedEvent) => void | Promise<void>
  /** Gets every whole stdout line and stderr line for the attempt transcript; it never waits. */
  readonly transcript?: TranscriptSink
}

export type SessionIo = {
  readonly state: CodexExecStreamState
  stdoutBytes: () => number
  /** The redacted tail of stderr and whether older output was dropped. */
  stderr: () => { readonly text: string; readonly truncated: boolean }
  listenerErrors: () => number
  /** Flush a final partial line and destroy the pipes a surviving helper may still hold. */
  close: () => void
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value
}

export function attachSessionIo(child: SessionChild, options: SessionIoOptions): SessionIo {
  const state = createCodexExecStreamState(options.stream)
  const stderrSink = createOutputSink(options.maxStderrBytes, 'tail')
  let stdoutBytes = 0
  let listenerErrors = 0

  const deliver = (event: CodexExecNormalizedEvent): void => {
    try {
      const returned = options.onEvent?.(event)
      if (isThenable(returned)) {
        returned.then(undefined, () => {
          listenerErrors += 1
        })
      }
    } catch {
      // A listener must not break parsing; the failure is counted in the result instead.
      listenerErrors += 1
    }
  }
  const { transcript } = options
  const stderrLines =
    transcript === undefined ? null : createTranscriptLineSplitter('stderr', transcript)
  const reader = createJsonlLineReader({
    maxLineBytes: options.maxLineBytes,
    onLine: (line) => {
      const event = state.acceptLine(line)
      if (event !== null) {
        deliver(event)
      }
      if (transcript !== undefined && line.kind === 'line') {
        appendCodexStdoutLine(transcript, line.text)
      }
    }
  })

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length
    reader.push(chunk)
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
    state,
    stdoutBytes: () => stdoutBytes,
    stderr: () => ({
      text: redactSecretLikeText(stderrSink.text()),
      truncated: stderrSink.truncated()
    }),
    listenerErrors: () => listenerErrors,
    close: () => {
      reader.end()
      stderrLines?.end()
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }
  }
}
