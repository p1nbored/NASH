import { buildAgentExecEnvironment } from '../agent-exec-shared/exec-environment'
import {
  collectExecutableEvidence,
  type ExecutableEvidence
} from '../agent-exec-shared/executable-evidence'
import { defaultRealPath, findExecutableProblem } from '../agent-exec-shared/executable-validation'
import { agyCommandLineProblem } from './agy-exec-command-line'
import type { AgyRunLocation } from './agy-exec-run-directory'
import type { ValidatedAgyExecRequest } from './agy-exec-request-validation'
import type { AgyExecRunDeps, AgyExecRunOptions } from './agy-exec-run-options'
import type { PreparedAgyExecRun } from './agy-exec-run-preparation'
import type { AgyExecFailure } from './agy-exec-types'

// What must hold before the child starts: an allowed launch target, its environment and recorded evidence.

export type AgyLaunchPlan = {
  readonly env: Record<string, string>
  readonly envNames: readonly string[]
  readonly evidence: ExecutableEvidence | null
  /** The `--version` probe was started, so an abort after it cannot claim nothing ever ran. */
  readonly versionProbeStarted: boolean
}

function childEnvironment(
  location: AgyRunLocation,
  worktreePath: string,
  options: AgyExecRunOptions,
  deps: AgyExecRunDeps
): Record<string, string> {
  return buildAgentExecEnvironment({
    parentEnv: options.parentEnv ?? process.env,
    runTempDir: location.tempDir,
    platform: deps.platform,
    excludePathUnder: [worktreePath, location.runDir],
    electronRunAsNode: options.executable.electronRunAsNode
  })
}

/** Refuses a launch target that must not start, or a command line the OS cannot; nothing exists yet. */
export function launchTargetRefusal(
  request: ValidatedAgyExecRequest,
  options: AgyExecRunOptions,
  deps: AgyExecRunDeps
): Promise<AgyExecFailure | null> {
  const problem = findExecutableProblem(options.executable, {
    worktreePath: request.worktreePath,
    runDir: request.location.runDir,
    platform: deps.platform,
    electron: deps.electron,
    realPath: defaultRealPath
  })
  if (problem !== null) {
    return Promise.resolve({ kind: 'executable_not_launchable', detail: problem })
  }
  const tooLong = agyCommandLineProblem({
    executable: options.executable,
    argv: request.argv,
    platform: deps.platform,
    env: childEnvironment(request.location, request.worktreePath, options, deps)
  })
  return Promise.resolve(tooLong === null ? null : { kind: 'invalid_request', detail: tooLong })
}

export async function planAgyLaunch(
  run: PreparedAgyExecRun,
  options: AgyExecRunOptions,
  deps: AgyExecRunDeps
): Promise<AgyLaunchPlan> {
  const env = childEnvironment(run.location, run.worktreePath, options, deps)
  const supplied = options.executableEvidence
  const versionProbeStarted = supplied === undefined && options.signal?.aborted !== true
  const evidence =
    supplied ??
    (versionProbeStarted
      ? await collectExecutableEvidence(options.executable, { env, signal: options.signal })
      : null)
  return { env, envNames: Object.keys(env).sort(), evidence, versionProbeStarted }
}
