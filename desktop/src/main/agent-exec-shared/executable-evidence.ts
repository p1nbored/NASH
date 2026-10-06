import { runProcess } from '../../shared/child-process/run-process'
import type { LaunchTarget } from './launch-target'
import { redactAndBound } from './secret-redaction'

// Evidence recorded with every result: launch path and a read-only --version probe that starts no task.

export type ExecutableEvidence = {
  readonly path: string
  readonly program: string
  readonly prefixArgs: readonly string[]
  readonly entryPath: string
  readonly version: string | null
  readonly versionText: string | null
  readonly versionProbe: 'ok' | 'failed' | 'timed_out'
}

export type ExecutableEvidenceOptions = {
  /** Exactly the environment the probe runs with (the sanitized child environment). */
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

const DEFAULT_VERSION_TIMEOUT_MS = 15_000
const MAX_VERSION_OUTPUT_BYTES = 16 * 1024
const MAX_VERSION_TEXT_CHARS = 200
const VERSION_PATTERN = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/

type VersionProbe = Pick<ExecutableEvidence, 'version' | 'versionText' | 'versionProbe'>

async function probeVersion(
  executable: LaunchTarget,
  options: ExecutableEvidenceOptions
): Promise<VersionProbe> {
  const failed: VersionProbe = { version: null, versionText: null, versionProbe: 'failed' }
  try {
    const result = await runProcess({
      program: executable.program,
      args: [...executable.prefixArgs, '--version'],
      env: options.env,
      timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS,
      maxOutputBytes: MAX_VERSION_OUTPUT_BYTES,
      terminationBarrier: true,
      signal: options.signal
    })
    if (result.timedOut) {
      return { ...failed, versionProbe: 'timed_out' }
    }
    if (result.code !== 0) {
      return failed
    }
    const firstLine = result.stdout.split(/\r?\n/).find((line) => line.trim() !== '') ?? ''
    const versionText = redactAndBound(firstLine.trim(), MAX_VERSION_TEXT_CHARS).text
    const version = VERSION_PATTERN.exec(versionText)?.[1] ?? null
    return {
      version,
      versionText: versionText === '' ? null : versionText,
      versionProbe: version === null ? 'failed' : 'ok'
    }
  } catch {
    // The process could not start at all; the probe reports failure rather than throwing.
    return failed
  }
}

export async function collectExecutableEvidence(
  executable: LaunchTarget,
  options: ExecutableEvidenceOptions
): Promise<ExecutableEvidence> {
  const probe = await probeVersion(executable, options)
  return {
    path: executable.requestedPath,
    program: executable.program,
    prefixArgs: executable.prefixArgs,
    entryPath: executable.entryPath,
    ...probe
  }
}
