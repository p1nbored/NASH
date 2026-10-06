import { buildCodexExecEnvironment } from './codex-exec-environment'
import {
  collectExecutableEvidence,
  type ExecutableEvidence
} from '../agent-exec-shared/executable-evidence'
import { defaultRealPath, findExecutableProblem } from '../agent-exec-shared/executable-validation'
import type { ValidatedCodexExecRequest } from './codex-exec-request-validation'
import type { CodexExecRunDeps, CodexExecRunOptions } from './codex-exec-run-options'
import type { PreparedCodexExecRun } from './codex-exec-run-preparation'
import type { CodexExecFailure } from './codex-exec-types'

// What must hold before the child starts: an allowed launch target, its environment and recorded evidence.

export type LaunchPlan = {
  readonly env: Record<string, string>
  readonly envNames: readonly string[]
  readonly evidence: ExecutableEvidence | null
  /** The `--version` probe was started, so an abort after it cannot claim nothing ever ran. */
  readonly versionProbeStarted: boolean
}

/** Refuses a launch target that must not start; it runs before the run directory exists. */
export function launchTargetRefusal(
  request: ValidatedCodexExecRequest,
  options: CodexExecRunOptions,
  deps: CodexExecRunDeps
): Promise<CodexExecFailure | null> {
  const problem = findExecutableProblem(options.executable, {
    worktreePath: request.worktreePath,
    runDir: request.location.runDir,
    platform: deps.platform,
    electron: deps.electron,
    realPath: defaultRealPath
  })
  return Promise.resolve(
    problem === null ? null : { kind: 'executable_not_launchable', detail: problem }
  )
}

export async function planLaunch(
  run: PreparedCodexExecRun,
  options: CodexExecRunOptions,
  deps: CodexExecRunDeps
): Promise<LaunchPlan> {
  const env = buildCodexExecEnvironment({
    parentEnv: options.parentEnv ?? process.env,
    runTempDir: run.location.tempDir,
    platform: deps.platform,
    excludePathUnder: [run.worktreePath, run.location.runDir],
    electronRunAsNode: options.executable.electronRunAsNode
  })
  const supplied = options.executableEvidence
  const versionProbeStarted = supplied === undefined && options.signal?.aborted !== true
  const evidence =
    supplied ??
    (versionProbeStarted
      ? await collectExecutableEvidence(options.executable, { env, signal: options.signal })
      : null)
  return { env, envNames: Object.keys(env).sort(), evidence, versionProbeStarted }
}
