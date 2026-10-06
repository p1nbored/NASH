import type {
  AttemptTranscriptDeps,
  AttemptTranscriptOption
} from '../agent-exec-shared/attempt-transcript'
import type { CodexExecNormalizedEvent } from './codex-exec-event-normalizer'
import type { CodexExecutable } from './codex-exec-executable'
import type { ExecutableEvidence } from '../agent-exec-shared/executable-evidence'
import {
  MAX_TIMER_MS,
  OptionError,
  readOptionalPositiveCount,
  readOptionRecord,
  readPositiveCount
} from '../agent-exec-shared/option-limits'
import { DEFAULT_MAX_LAST_MESSAGE_BYTES } from './codex-exec-last-message'
import { defaultTempRoots } from './codex-exec-run-directory'
import { DEFAULT_STREAM_LIMITS, type CodexExecStreamLimits } from './codex-exec-stream-state'
import type { TreeTerminationDeps } from '../agent-exec-shared/tree-termination'

export { MAX_TIMER_MS }
const DEFAULT_GRACE_MS = 5_000
const DEFAULT_VERIFY_MS = 10_000

export type CodexExecLimits = {
  /** Longest single stdout line parsed; longer lines are flagged and discarded. */
  readonly maxLineBytes: number
  /** Size of the stderr tail ring. */
  readonly maxStderrBytes: number
  readonly maxLastMessageBytes: number
  readonly maxPromptBytes: number
  /** How long to wait for output a surviving helper holds open after the root exits. */
  readonly drainGraceMs: number
  readonly stream: CodexExecStreamLimits
}

export const DEFAULT_CODEX_EXEC_LIMITS: CodexExecLimits = {
  maxLineBytes: 1024 * 1024,
  maxStderrBytes: 16 * 1024,
  maxLastMessageBytes: DEFAULT_MAX_LAST_MESSAGE_BYTES,
  maxPromptBytes: 512 * 1024,
  drainGraceMs: 2_000,
  stream: DEFAULT_STREAM_LIMITS
}

/** Seams for tests and for hosts that know better than the defaults. */
export type CodexExecRunDeps = {
  /** Directories a run directory must not live under; defaults to the OS temp locations. */
  readonly tempRoots: () => readonly string[]
  readonly platform: NodeJS.Platform
  /** Whether this process is Electron, where process.execPath is the app and not Node. */
  readonly electron: { readonly isElectron: boolean; readonly execPath: string }
  readonly termination: Partial<TreeTerminationDeps>
  /** The transcript file and clock; tests replace the file to make writes fail. */
  readonly transcript: Partial<AttemptTranscriptDeps>
}

export type CodexExecRunOptions = {
  /** Resolved launch target; never the real binary in tests. */
  readonly executable: CodexExecutable
  /** Evidence collected earlier (it is per binary, not per run); probed here when absent. */
  readonly executableEvidence?: ExecutableEvidence
  /** Environment the child allowlist is read from; defaults to process.env. */
  readonly parentEnv?: NodeJS.ProcessEnv
  /** Aborting stops the process tree; the host must also abort on app quit, or a run outlives Orca. */
  readonly signal?: AbortSignal
  /** Absent means no timeout: the run ends when codex ends or the signal aborts (D-027). */
  readonly timeoutMs?: number
  /** Time the root gets to exit after the first stop signal before the kill is forced. */
  readonly graceMs?: number
  /** Time to wait for the root's exit after a forced kill. */
  readonly verifyMs?: number
  readonly limits?: Partial<Omit<CodexExecLimits, 'stream'>> & {
    readonly stream?: Partial<CodexExecStreamLimits>
  }
  /** Called for each normalized event, never with reasoning; a throwing or rejecting listener is counted. */
  readonly onEvent?: (event: CodexExecNormalizedEvent) => void | Promise<void>
  /** Writes the attempt transcript to `path`, which must be `<runDir>/transcript.jsonl`; it never fails the run. */
  readonly transcript?: AttemptTranscriptOption
  readonly deps?: Partial<CodexExecRunDeps>
}

export type ResolvedCodexExecTiming = {
  readonly timeoutMs: number | null
  readonly graceMs: number
  readonly verifyMs: number
}

export type ResolvedCodexExecOptions = {
  readonly limits: CodexExecLimits
  readonly timing: ResolvedCodexExecTiming
}

export type OptionsResolution =
  | { readonly ok: true; readonly value: ResolvedCodexExecOptions }
  | { readonly ok: false; readonly detail: string }

function readStreamLimits(value: unknown): CodexExecStreamLimits {
  const raw = readOptionRecord('limits.stream', value)
  const defaults = DEFAULT_STREAM_LIMITS
  const count = (key: keyof CodexExecStreamLimits): number =>
    readPositiveCount(`limits.stream.${key}`, raw[key], defaults[key])
  return {
    maxEvents: count('maxEvents'),
    maxUnknownEvents: count('maxUnknownEvents'),
    maxNonJsonSamples: count('maxNonJsonSamples'),
    maxOversizedSamples: count('maxOversizedSamples'),
    maxFailureMessages: count('maxFailureMessages')
  }
}

function readLimits(value: unknown): CodexExecLimits {
  const raw = readOptionRecord('limits', value)
  const defaults = DEFAULT_CODEX_EXEC_LIMITS
  const count = (key: Exclude<keyof CodexExecLimits, 'stream'>): number =>
    readPositiveCount(`limits.${key}`, raw[key], defaults[key])
  return {
    maxLineBytes: count('maxLineBytes'),
    maxStderrBytes: count('maxStderrBytes'),
    maxLastMessageBytes: count('maxLastMessageBytes'),
    maxPromptBytes: count('maxPromptBytes'),
    drainGraceMs: count('drainGraceMs'),
    stream: readStreamLimits(raw.stream)
  }
}

/** Validate every numeric option once, up front, so no timer or cap can be disabled by a bad value. */
export function resolveRunOptions(options: CodexExecRunOptions): OptionsResolution {
  try {
    return {
      ok: true,
      value: {
        limits: readLimits(options.limits),
        timing: {
          timeoutMs: readOptionalPositiveCount('timeoutMs', options.timeoutMs),
          graceMs: readPositiveCount('graceMs', options.graceMs, DEFAULT_GRACE_MS),
          verifyMs: readPositiveCount('verifyMs', options.verifyMs, DEFAULT_VERIFY_MS)
        }
      }
    }
  } catch (error) {
    if (error instanceof OptionError) {
      return { ok: false, detail: error.message }
    }
    throw error
  }
}

/** Fill every seam with its production default. */
export function resolveRunDeps(deps: Partial<CodexExecRunDeps> | undefined): CodexExecRunDeps {
  const platform = deps?.platform ?? process.platform
  return {
    platform,
    tempRoots: deps?.tempRoots ?? (() => defaultTempRoots(platform)),
    electron: deps?.electron ?? {
      isElectron: Boolean(process.versions.electron),
      execPath: process.execPath
    },
    termination: deps?.termination ?? {},
    transcript: deps?.transcript ?? {}
  }
}
