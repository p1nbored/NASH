import type { ExecutionTarget } from '../../../shared/routing-table/routing-table-taxonomy'
import { isCliCommandName } from '../../../shared/workflow-run/autopilot-cli-commands'
import type { OrchestrationDb } from '../orchestration/db'
import type { MessageRow } from '../orchestration/types'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { AppAttemptStartInput } from '../orchestration/db/app-attempt-input'
import {
  getAppAttemptSettlement,
  type AppAttemptView
} from '../orchestration/db/app-attempt-settlement'
import { getTaskSpecStore, type TaskSpecRecord } from '../orchestration/db/task-spec-store'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import type { ExecutorRegistry } from './executor-registry'
import { startInSessionAttempt } from './in-session-task-executor'
import { launchProcessAttempt } from './process-attempt-launch'
import type { ProcessTaskExecutor, TaskExecutorKind } from './process-executor-contract'
import { processInstruction, type InSessionTarget } from './task-start-instruction'
import {
  recheckTaskRoute,
  type CheckedRoute,
  type DelegatedRoute,
  type RouteRecheckPort
} from './task-start-route'
import type { ProcessAttemptPorts, TaskExecutionLogEvent } from './task-execution-ports'

/** What D1's task-start passes after it attested the caller as the run's primary. */
export type TaskStartInput = Pick<
  AppAttemptStartInput,
  'taskId' | 'creator' | 'maxDepth' | 'retryOf' | 'runtimeEpoch' | 'mutationReceipt'
>

/** The reply for the primary session; plain data, safe to return over RPC. */
export type TaskStartView = {
  readonly taskId: string
  readonly dispatchId: string
  readonly routeId: string
  readonly target: ExecutionTarget
  /** False for a task the classification kept with the primary (U29): it runs the attempt itself. */
  readonly delegated: boolean
  readonly runsIn: 'session' | 'process'
  readonly taskStatus: string
  readonly workerState: string
  /** English: who runs the attempt and how its result comes back. */
  readonly instruction: string
}

export type TaskStart = {
  readonly view: TaskStartView
  /** Resolves once a process attempt has settled (at once for in-session); for the host, not for RPC. */
  readonly settled: Promise<void>
}

export type TaskStartService = { startTask(input: TaskStartInput): Promise<TaskStart> }

export type TaskStartDeps = {
  readonly owner: OrchestrationDb
  readonly routes: RouteRecheckPort
  readonly executors: Readonly<Record<TaskExecutorKind, ProcessTaskExecutor>>
  readonly registry: ExecutorRegistry
  readonly now: () => number
  readonly cliCommand: string
  readonly announce: (message: MessageRow) => void
  readonly log: (event: TaskExecutionLogEvent) => void
}

const SETTLED: Promise<void> = Promise.resolve()

function processKindOf(target: ExecutionTarget): TaskExecutorKind | null {
  return target === 'codex_cli' || target === 'agy_cli' ? target : null
}

function liveRun(
  owner: OrchestrationDb,
  taskId: string
): { spec: TaskSpecRecord; run: WorkflowRunRecord } {
  const spec = getTaskSpecStore(owner).get(taskId)
  if (!spec) {
    throw new OrchestrationError('autopilot_task_spec_not_found', 'The task has no TaskSpec.')
  }
  const run = getWorkflowRunStore(owner).get(spec.runId)
  if (run?.status !== 'active') {
    throw new OrchestrationError(
      'autopilot_run_not_live',
      'An attempt can only start in an active run.'
    )
  }
  return { spec, run }
}

/** The objective Orca holds for the task; a process never starts once the task row is gone. */
function requireObjective(owner: OrchestrationDb, taskId: string): string {
  const task = owner.getTask(taskId)
  if (!task) {
    throw new OrchestrationError('autopilot_task_not_found', 'The task was not found.')
  }
  return task.spec
}

// Why: Orca restarts a failed or blocked task only from its latest attempt, which the primary never names.
function retryOfFor(owner: OrchestrationDb, taskId: string): string | undefined {
  const status = owner.getTask(taskId)?.status
  return status === 'failed' || status === 'blocked'
    ? owner.getDispatchContext(taskId)?.id
    : undefined
}

function stricterAccess(
  spec: TaskSpecRecord,
  run: WorkflowRunRecord
): TaskSpecRecord['accessNeed'] {
  return spec.accessNeed === 'read_only' || run.requestedAccess === 'read_only'
    ? 'read_only'
    : 'workspace_write'
}

/** Where the attempt goes: a delegated route's target, or the primary itself for a task it keeps. */
type Placement = {
  readonly routeId: string
  readonly target: ExecutionTarget
  readonly delegated: boolean
}

function placementOf(route: CheckedRoute): Placement {
  return route.kind === 'delegated'
    ? { routeId: route.routeId, target: route.target, delegated: true }
    : { routeId: route.routeId, target: 'claude_primary', delegated: false }
}

function viewOf(
  attempt: AppAttemptView,
  placement: Placement,
  runsIn: TaskStartView['runsIn'],
  instruction: string
): TaskStartView {
  return {
    taskId: attempt.taskId,
    dispatchId: attempt.dispatchId,
    ...placement,
    runsIn,
    taskStatus: attempt.taskStatus,
    workerState: attempt.workerState,
    instruction
  }
}

function inSessionTargetOf(target: ExecutionTarget): InSessionTarget {
  return target === 'claude_subagent' || target === 'claude_workflow' ? target : 'claude_primary'
}

type Started = {
  readonly spec: TaskSpecRecord
  readonly run: WorkflowRunRecord
  readonly dispatchId: string
}

function startInSession(
  ports: ProcessAttemptPorts,
  started: Started,
  route: CheckedRoute
): TaskStart {
  const placement = placementOf(route)
  const inSession = startInSessionAttempt(ports, {
    taskId: started.spec.taskId,
    dispatchId: started.dispatchId,
    target: inSessionTargetOf(placement.target),
    taskType: route.kind === 'delegated' ? route.taskType : null,
    workflowName: started.spec.workflowName
  })
  return {
    view: viewOf(inSession.view, placement, 'session', inSession.instruction),
    settled: SETTLED
  }
}

async function startProcess(
  ports: ProcessAttemptPorts,
  executor: ProcessTaskExecutor,
  started: Started & { readonly objective: string },
  route: DelegatedRoute
): Promise<TaskStart> {
  const { spec, run, dispatchId } = started
  const launch = await launchProcessAttempt(
    ports,
    executor,
    {
      dispatchId,
      runId: run.runId,
      taskId: spec.taskId,
      workspaceId: run.workspaceId,
      access: stricterAccess(spec, run),
      cli: { model: route.availability.cli.model, effort: route.availability.cli.effort },
      prompt: {
        taskId: spec.taskId,
        dispatchId,
        objective: started.objective,
        expectedOutputs: spec.expectedOutputs,
        acceptanceCriteria: spec.acceptanceCriteria,
        constraints: spec.constraints
      }
    },
    route.subject
  )
  const instruction = processInstruction({
    taskId: spec.taskId,
    dispatchId,
    cliCommand: ports.cliCommand,
    kind: executor.kind,
    // A start that never ran says nothing about where it would have written.
    placement: launch.placement ?? { mode: 'run_workspace' }
  })
  return {
    view: viewOf(launch.view, placementOf(route), 'process', instruction),
    settled: launch.settled
  }
}

/**
 * The primary's explicit `task-start` (U19): re-check the route, open Orca's attempt through the app's
 * settlement, then declare an in-session worker (a delegated Claude route, or a task the primary
 * keeps, U29) or launch the Codex or agy child.
 */
export function createTaskStartService(deps: TaskStartDeps): TaskStartService {
  if (!isCliCommandName(deps.cliCommand)) {
    throw new RangeError('The CLI command name must be one bare word.')
  }
  const settlement = getAppAttemptSettlement(deps.owner)
  const timestamp = (): string => new Date(deps.now()).toISOString()
  const ports: ProcessAttemptPorts = { ...deps, settlement, timestamp }

  async function startTask(input: TaskStartInput): Promise<TaskStart> {
    const { spec, run } = liveRun(deps.owner, input.taskId)
    const route = await recheckTaskRoute(
      { owner: deps.owner, routes: deps.routes, now: timestamp },
      {
        taskId: spec.taskId,
        runId: run.runId,
        workspaceId: run.workspaceId,
        workflowName: spec.workflowName
      }
    )
    const kind = route.kind === 'delegated' ? processKindOf(route.target) : null
    // Why before the start: a refusal here leaves no attempt open.
    const objective = kind === null ? null : requireObjective(deps.owner, spec.taskId)
    const attempt = settlement.start({
      ...input,
      retryOf: input.retryOf ?? retryOfFor(deps.owner, input.taskId),
      routeId: route.routeId,
      executor: kind ?? 'in_session',
      timestamp: timestamp()
    })
    const started = { spec, run, dispatchId: attempt.dispatchId }
    return route.kind === 'delegated' && kind !== null && objective !== null
      ? startProcess(ports, deps.executors[kind], { ...started, objective }, route)
      : startInSession(ports, started, route)
  }

  return { startTask }
}
