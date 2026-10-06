import type { WORKFLOW_RUN_ACCESS_LEVELS } from '../orchestration/db/autopilot-run-schema-definition'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import type { AttemptPlacement } from './attempt-workspace'
import type { AttemptWorktreePort } from './attempt-worktree'
import type { ExecutorRunReport } from './executor-run-report'
import type { ExecutorPromptInput } from './executor-task-prompt'

// What the task-start service hands a Codex or agy executor, and what it gets back. The executors
// spawn only through their runners (src/main/codex-exec, src/main/agy-exec), which use
// src/shared/child-process; nothing here starts a process itself.

export type TaskExecutorKind = 'codex_cli' | 'agy_cli'

export type ProcessAttemptPlan = {
  readonly dispatchId: string
  readonly runId: string
  readonly taskId: string
  readonly workspaceId: string
  readonly access: (typeof WORKFLOW_RUN_ACCESS_LEVELS)[number]
  /** The model and the value the resolved CLI setting sends; a null effort sends none. */
  readonly cli: { readonly model: string; readonly effort: string | null }
  readonly prompt: ExecutorPromptInput
}

export type PreparedProcessRun = {
  /** Launch evidence for the executor row: kind, launch shape, entry file name, and where it runs. */
  readonly evidence: JsonObject
  /** D-025: the run workspace, the folder itself, or the attempt's own worktree. */
  readonly placement: AttemptPlacement
  /** Runs the child once; expected failures come back as a report, never as a rejection. */
  readonly run: (signal: AbortSignal) => Promise<ExecutorRunReport>
}

export type PrepareOutcome =
  | { readonly ok: true; readonly prepared: PreparedProcessRun }
  | { readonly ok: false; readonly reason: string }

export type ProcessTaskExecutor = {
  readonly kind: TaskExecutorKind
  /** Resolves every launch input before the attempt is marked running; a refusal means nothing ran. */
  prepare(plan: ProcessAttemptPlan): Promise<PrepareOutcome>
}

/** Launch inputs both executors resolve the same way. */
export type ProcessLaunchPorts = {
  /** The local path of the run's workspace; throws when it cannot be resolved. */
  readonly workspacePath: (workspaceId: string) => string
  /** Creates and returns `<userData>/autopilot-runs/<runId>`; each attempt gets a child folder there. */
  readonly runsRoot: (runId: string) => Promise<string>
  /** The environment the child allowlist is read from; the runner's default is process.env. */
  readonly parentEnv?: () => Promise<NodeJS.ProcessEnv>
  readonly timeoutMs?: number
  /** D-025: creates the own worktree of a write attempt in a git workspace. */
  readonly worktrees: AttemptWorktreePort
}
