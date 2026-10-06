import { open } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ATTEMPT_TRANSCRIPT_FILE,
  type TranscriptEnd,
  type TranscriptRecord,
  type TranscriptStart,
  type TranscriptWorktree
} from './attempt-transcript-records'
import {
  pruneSettledTranscripts,
  type TranscriptRetentionResult
} from './attempt-transcript-retention'
import { TranscriptWriter } from './attempt-transcript-writer'
import { pathApiFor } from './path-containment'

// One attempt's transcript file: records queue in memory and one writer drains them, so the child's
// pipes never wait on the disk. Writing problems are counted as codes and never fail the run.

export { ATTEMPT_TRANSCRIPT_FILE }

const PRIVATE_FILE_MODE = 0o600
const DEFAULT_FLUSH_TIMEOUT_MS = 5_000

/** The run option: where the runner writes this attempt's transcript; it must be `<runDir>/transcript.jsonl`. */
export type AttemptTranscriptOption = {
  readonly path: string
  /** D-025: the attempt's own worktree, which its `start` record names; absent when it has none. */
  readonly worktree?: TranscriptWorktree
}

export function attemptTranscriptPath(runsRoot: string, runId: string): string {
  return join(runsRoot, runId, ATTEMPT_TRANSCRIPT_FILE)
}

/** What the pipe handlers see: both calls return at once and never throw. */
export type TranscriptSink = {
  readonly append: (record: TranscriptRecord) => void
  /** Counts a record that could not be built. */
  readonly fault: () => void
}

export type AttemptTranscriptErrorCode =
  | 'transcript_path_invalid'
  | 'transcript_open_failed'
  | 'transcript_write_failed'
  | 'transcript_close_failed'
  | 'transcript_flush_timeout'
  | 'transcript_record_failed'

/** Counts and codes only; the transcript's text never leaves the file. */
export type AttemptTranscriptOutcome = {
  /** The first problem; later ones only raise the count. */
  readonly errorCode: AttemptTranscriptErrorCode | null
  readonly errorCount: number
  readonly droppedRecords: number
  readonly truncated: boolean
  /** The retention pass run at open; null when the transcript was refused. */
  readonly retention: TranscriptRetentionResult | null
}

export type AttemptTranscript = TranscriptSink & {
  /** Writes `end` last, flushes and closes; resolves within the flush timeout and never rejects. */
  readonly finish: (end: TranscriptEnd) => Promise<AttemptTranscriptOutcome>
}

export type TranscriptFileHandle = {
  readonly write: (text: string) => Promise<unknown>
  readonly close: () => Promise<void>
}

export type AttemptTranscriptDeps = {
  /** Exclusive create, owner-only; it fails on an existing file or link. */
  readonly open: (path: string) => Promise<TranscriptFileHandle>
  readonly now: () => number
  /** Retention under the runs root; started at open, beside the writes. */
  readonly prune: (runsRoot: string) => Promise<TranscriptRetentionResult>
  readonly flushTimeoutMs: number
}

export type AttemptTranscriptInput = {
  readonly path: string
  /** The attempt's run directory, `<runs root>/<run>/<attempt>`, already created by the runner. */
  readonly runDir: string
  readonly platform: NodeJS.Platform
  readonly start: TranscriptStart
  readonly deps?: Partial<AttemptTranscriptDeps>
}

async function openExclusive(path: string): Promise<TranscriptFileHandle> {
  const handle = await open(path, 'ax', PRIVATE_FILE_MODE)
  return {
    // appendFile writes the whole string even when the OS takes it in parts.
    write: (text) => handle.appendFile(text, 'utf8'),
    close: () => handle.close()
  }
}

const DEFAULT_DEPS: AttemptTranscriptDeps = {
  open: openExclusive,
  now: Date.now,
  prune: (root) => pruneSettledTranscripts({ root, nowMs: Date.now() }),
  flushTimeoutMs: DEFAULT_FLUSH_TIMEOUT_MS
}

function sameDirectory(a: string, b: string, platform: NodeJS.Platform): boolean {
  const api = pathApiFor(platform)
  const left = api.resolve(a)
  const right = api.resolve(b)
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function refused(): AttemptTranscript {
  const outcome: AttemptTranscriptOutcome = {
    errorCode: 'transcript_path_invalid',
    errorCount: 1,
    droppedRecords: 0,
    truncated: false,
    retention: null
  }
  return { append: () => {}, fault: () => {}, finish: async () => outcome }
}

/** `<runs root>` of `<runs root>/<run>/<attempt>/transcript.jsonl`, or null for any other path. */
function runsRootFor(input: AttemptTranscriptInput): string | null {
  try {
    const api = pathApiFor(input.platform)
    const inRunDir =
      api.basename(input.path) === ATTEMPT_TRANSCRIPT_FILE &&
      sameDirectory(api.dirname(input.path), input.runDir, input.platform)
    return inRunDir ? api.dirname(api.dirname(api.resolve(input.runDir))) : null
  } catch {
    return null
  }
}

/** Starts the attempt's transcript with its `start` record; a path outside the run directory writes nothing. */
export function openAttemptTranscript(input: AttemptTranscriptInput): AttemptTranscript {
  const runsRoot = runsRootFor(input)
  if (runsRoot === null) {
    return refused()
  }
  const writer = new TranscriptWriter(input.path, runsRoot, input.start, {
    ...DEFAULT_DEPS,
    ...input.deps
  })
  return { append: writer.append, fault: writer.fault, finish: writer.finish }
}
