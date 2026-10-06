import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LaunchTarget } from '../../agent-exec-shared/launch-target'
import { runAgyExec } from '../../agy-exec/agy-exec-run'
import type { CodexExecutable } from '../../codex-exec/codex-exec-executable'
import { runCodexExec } from '../../codex-exec/codex-exec-run'
import type { OrchestrationDb } from '../orchestration/db'
import type { MessageRow } from '../orchestration/types'
import { getExecutorProcessStore } from '../orchestration/db/executor-process-store'
import type { ExecutorStopPort } from '../workflow-run/executor-stop-port'
import { createAgyTaskExecutor, type AgyTaskExecutorPorts } from './agy-task-executor'
import type { AttemptWorktreePort } from './attempt-worktree'
import { createCodexTaskExecutor, type CodexTaskExecutorPorts } from './codex-task-executor'
import { createExecutorRegistry } from './executor-registry'
import {
  reconcileExecutorsAfterRestart,
  type ExecutorRestartSummary
} from './executor-restart-reconcile'
import { readAttemptResult, type AttemptResultView } from './executor-result-view'
import { createTaskStartService, type TaskStartService } from './task-start-service'
import type { RouteRecheckPort } from './task-start-route'
import type { TaskExecutionLogEvent } from './task-execution-ports'

/** Matches appAttemptRunDirectory (B3): `autopilot-runs/<run>/<dispatch>` under the data folder. */
export const ATTEMPT_RUNS_FOLDER = 'autopilot-runs'
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

type ExecutorHostPorts<Run, Target> = {
  readonly resolveExecutable: () => Target
  readonly parentEnv?: () => Promise<NodeJS.ProcessEnv>
  readonly timeoutMs?: number
  /** Test seam; production uses the runner. */
  readonly run?: Run
}

/** What the startup wiring (E1) binds; nothing here imports electron or starts a process itself. */
export type TaskExecutionRuntimePorts = {
  readonly owner: OrchestrationDb
  /** B2's `routingTableRuntime.resolver`. */
  readonly routes: RouteRecheckPort
  readonly now: () => number
  readonly cliCommand: string
  readonly userDataPath: string
  /** `runtime.requireWorkbenchWorkspace(id).path`: local workspaces only. */
  readonly workspacePath: (workspaceId: string) => string
  /** D-025: Orca's worktree creation for a write attempt (`createRuntimeAttemptWorktreePort`). */
  readonly worktrees: AttemptWorktreePort
  /** `runtime.notifyMessageArrived(message.to_handle, message.type)`. */
  readonly announce: (message: MessageRow) => void
  readonly log: (event: TaskExecutionLogEvent) => void
  readonly codex: ExecutorHostPorts<CodexTaskExecutorPorts['run'], CodexExecutable>
  readonly agy: ExecutorHostPorts<
    AgyTaskExecutorPorts['run'],
    LaunchTarget & { readonly source?: string }
  >
}

export type TaskExecutionRuntime = {
  readonly startTask: TaskStartService['startTask']
  /** For `registerExecutorStopPort(runtime, stopPort)` (B4). */
  readonly stopPort: ExecutorStopPort
  /** Will-quit: aborts every child and resolves once each settled; the host bounds the wait. */
  abortAllForQuit(): Promise<void>
  /** Once at startup, after the schema is ensured and before any start. */
  reconcileAfterRestart(): ExecutorRestartSummary
  /** For task-show (D1). */
  readAttemptResult(dispatchId: string): Promise<AttemptResultView>
}

/** Creates `<userData>/autopilot-runs/<runId>` (owner-only on POSIX) and returns it. */
export function createRunsRootPort(userDataPath: string): (runId: string) => Promise<string> {
  return async (runId) => {
    if (!RUN_ID.test(runId)) {
      throw new RangeError('A run id must be letters, digits, `_` or `-`.')
    }
    const path = join(userDataPath, ATTEMPT_RUNS_FOLDER, runId)
    await mkdir(path, { recursive: true, mode: 0o700 })
    return path
  }
}

export function createTaskExecutionRuntime(ports: TaskExecutionRuntimePorts): TaskExecutionRuntime {
  const executorRows = getExecutorProcessStore(ports.owner)
  const registry = createExecutorRegistry({
    recordedTree: (dispatchId) => {
      const row = executorRows.get(dispatchId)
      return row?.treeVerdict && row.treeMethod
        ? { verdict: row.treeVerdict, method: row.treeMethod }
        : null
    }
  })
  const launch = {
    workspacePath: ports.workspacePath,
    runsRoot: createRunsRootPort(ports.userDataPath),
    worktrees: ports.worktrees
  }
  const codex = createCodexTaskExecutor({
    ...launch,
    ...ports.codex,
    run: ports.codex.run ?? runCodexExec
  })
  const agy = createAgyTaskExecutor({
    ...launch,
    ...ports.agy,
    run: ports.agy.run ?? runAgyExec
  })
  const service = createTaskStartService({
    owner: ports.owner,
    routes: ports.routes,
    executors: { codex_cli: codex, agy_cli: agy },
    registry,
    now: ports.now,
    cliCommand: ports.cliCommand,
    announce: ports.announce,
    log: ports.log
  })
  return {
    startTask: service.startTask,
    stopPort: { stopExecutor: (request) => registry.stopExecutor(request) },
    abortAllForQuit: () => registry.abortAll(),
    reconcileAfterRestart: () => reconcileExecutorsAfterRestart({ ...ports, registry }),
    readAttemptResult: (dispatchId) =>
      readAttemptResult({ owner: ports.owner, userDataPath: ports.userDataPath }, dispatchId)
  }
}
