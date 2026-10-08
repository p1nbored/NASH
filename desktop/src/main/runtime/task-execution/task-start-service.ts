import type { ExecutionTarget } from '../../../shared/routing-table/routing-table-taxonomy'
import { isCliCommandName } from '../../../shared/workflow-run/autopilot-cli-commands'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { AppAttemptStartInput } from '../orchestration/db/app-attempt-input'
import {
  getAppAttemptSettlement,
  type AppAttemptView
} from '../orchestration/db/app-attempt-settlement'
import { getTaskSpecStore, type TaskSpecRecord } from '../orchestration/db/task-spec-store'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import { startInSessionAttempt } from './in-session-task-executor'
import type { InSessionTarget } from './task-start-instruction'
import {
  recheckTaskRoute,
  type CheckedRoute,
  type DelegatedRoute,
  type RouteRecheckPort
} from './task-start-route'
import type { AttemptSettlementPorts, TaskExecutionLogEvent } from './task-execution-ports'

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
  readonly nativeWorker?: true
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
  readonly startWorker: (input: TaskStartInput, route: DelegatedRoute) => Promise<TaskStart>
  readonly owner: OrchestrationDb
  readonly routes: RouteRecheckPort
  readonly now: () => number
  readonly cliCommand: string
  readonly log: (event: TaskExecutionLogEvent) => void
}

const SETTLED: Promise<void> = Promise.resolve()

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

// Why: Orca restarts a failed or blocked task only from its latest attempt, which the primary never names.
function retryOfFor(owner: OrchestrationDb, taskId: string): string | undefined {
  const status = owner.getTask(taskId)?.status
  return status === 'failed' || status === 'blocked'
    ? owner.getDispatchContext(taskId)?.id
    : undefined
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
  ports: AttemptSettlementPorts,
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

export function createTaskStartService(deps: TaskStartDeps): TaskStartService {
  if (!isCliCommandName(deps.cliCommand)) {
    throw new RangeError('The CLI command name must be one bare word.')
  }
  const settlement = getAppAttemptSettlement(deps.owner)
  const timestamp = (): string => new Date(deps.now()).toISOString()
  const ports: AttemptSettlementPorts = { ...deps, settlement, timestamp }

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
    if (
      route.kind === 'delegated' &&
      (route.target === 'codex_cli' ||
        route.target === 'agy_cli' ||
        (route.target === 'claude_subagent' && run.coordinatorAgent === 'codex'))
    ) {
      return deps.startWorker(
        { ...input, retryOf: input.retryOf ?? retryOfFor(deps.owner, input.taskId) },
        route
      )
    }
    const attempt = settlement.start({
      ...input,
      retryOf: input.retryOf ?? retryOfFor(deps.owner, input.taskId),
      routeId: route.routeId,
      executor: 'in_session',
      timestamp: timestamp()
    })
    const started = { spec, run, dispatchId: attempt.dispatchId }
    return startInSession(ports, started, route)
  }

  return { startTask }
}
