import type {
  AttemptTranscriptDeps,
  AttemptTranscriptOption
} from '../agent-exec-shared/attempt-transcript'
import type { ExecutableEvidence } from '../agent-exec-shared/executable-evidence'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'
import {
  OptionError,
  readOptionalPositiveCount,
  readOptionRecord,
  readPositiveCount
} from '../agent-exec-shared/option-limits'
import { defaultTempRoots } from '../agent-exec-shared/run-directory'
import type { TreeTerminationDeps } from '../agent-exec-shared/tree-termination'
const DEFAULT_GRACE_MS = 5_000
const DEFAULT_VERIFY_MS = 10_000
/** The answer is held in memory and scanned on the main thread, so the cap itself has a ceiling (D-027). */
export const AGY_EXEC_OUTPUT_CEILING_BYTES = 64 * 1024 * 1024

export type AgyExecLimits = {
  /** The answer is kept up to this many bytes; a run that passes it is stopped and fails. */
  readonly maxOutputBytes: number
  /** Longest redacted preview kept in the result. */
  readonly maxPreviewChars: number
  /** Size of the stderr tail ring. */
  readonly maxStderrBytes: number
  /** How long to wait for output a surviving helper holds open after the root exits. */
  readonly drainGraceMs: number
}

export const DEFAULT_AGY_EXEC_LIMITS: AgyExecLimits = {
  maxOutputBytes: AGY_EXEC_OUTPUT_CEILING_BYTES,
  maxPreviewChars: 8_000,
  maxStderrBytes: 16 * 1024,
  drainGraceMs: 2_000
}

/** Seams for tests and for hosts that know better than the defaults. */
export type AgyExecRunDeps = {
  /** Directories a run directory must not live under; defaults to the OS temp locations. */
  readonly tempRoots: () => readonly string[]
  readonly platform: NodeJS.Platform
  /** Whether this process is Electron, where process.execPath is the app and not Node. */
  readonly electron: { readonly isElectron: boolean; readonly execPath: string }
  readonly termination: Partial<TreeTerminationDeps>
  /** The transcript file and clock; tests replace the file to make writes fail. */
  readonly transcript: Partial<AttemptTranscriptDeps>
}

export type AgyExecRunOptions = {
  /** Resolved launch target; never the real binary in tests. */
  readonly executable: LaunchTarget
  /** Evidence collected earlier (it is per binary, not per run); probed here when absent. */
  readonly executableEvidence?: ExecutableEvidence
  /** Environment the child allowlist is read from; defaults to process.env. */
  readonly parentEnv?: NodeJS.ProcessEnv
  /** Aborting stops the process tree; the host must also abort on app quit, or a run outlives Orca. */
  readonly signal?: AbortSignal
  /** Absent means no timeout: the run ends when agy ends or the signal aborts (D-027). */
  readonly timeoutMs?: number
  /** Time the root gets to exit after the first stop signal before the kill is forced. */
  readonly graceMs?: number
  /** Time to wait for the root's exit after a forced kill. */
  readonly verifyMs?: number
  readonly limits?: Partial<AgyExecLimits>
  /** Writes the attempt transcript to `path`, which must be `<runDir>/transcript.jsonl`; it never fails the run. */
  readonly transcript?: AttemptTranscriptOption
  readonly deps?: Partial<AgyExecRunDeps>
}

export type ResolvedAgyExecTiming = {
  readonly timeoutMs: number | null
  readonly graceMs: number
  readonly verifyMs: number
}

export type ResolvedAgyExecOptions = {
  readonly limits: AgyExecLimits
  readonly timing: ResolvedAgyExecTiming
}

export type OptionsResolution =
  | { readonly ok: true; readonly value: ResolvedAgyExecOptions }
  | { readonly ok: false; readonly detail: string }

function readLimits(value: unknown): AgyExecLimits {
  const raw = readOptionRecord('limits', value)
  const defaults = DEFAULT_AGY_EXEC_LIMITS
  const count = (key: keyof AgyExecLimits): number =>
    readPositiveCount(`limits.${key}`, raw[key], defaults[key])
  const limits: AgyExecLimits = {
    maxOutputBytes: count('maxOutputBytes'),
    maxPreviewChars: count('maxPreviewChars'),
    maxStderrBytes: count('maxStderrBytes'),
    drainGraceMs: count('drainGraceMs')
  }
  if (limits.maxOutputBytes > AGY_EXEC_OUTPUT_CEILING_BYTES) {
    throw new OptionError(`limits.maxOutputBytes must be at most ${AGY_EXEC_OUTPUT_CEILING_BYTES}.`)
  }
  return limits
}

/** Validate every numeric option once, up front, so no timer or cap can be disabled by a bad value. */
export function resolveAgyRunOptions(options: AgyExecRunOptions): OptionsResolution {
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
export function resolveAgyRunDeps(deps: Partial<AgyExecRunDeps> | undefined): AgyExecRunDeps {
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
