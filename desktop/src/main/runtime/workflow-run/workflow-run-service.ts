import { z } from 'zod'
import { isDispatchable } from '../../routing-table/availability/route-availability-types'
import type { RouteResolver } from '../../routing-table/route-resolver'
import type { ResolvedRoutingTable } from '../../routing-table/routing-table-activation'
import type { OrchestrationDb } from '../orchestration/db'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { workbenchWorkspaceBinding } from '../orchestration/db/workbench-request-scope'
import {
  WorkflowRunCreateSchema,
  getWorkflowRunStore,
  type WorkflowRunRecord
} from '../orchestration/db/workflow-run-store'
import type { WorkbenchLocalWorkspace } from '../workbench-local-workspace'
import type {
  PrimarySessionLaunchOutcome,
  PrimarySessionLaunchRequest
} from './primary-session-launcher'
import {
  clockTimestamp,
  errorCodeOf,
  launchBlocker,
  type WorkflowRunLaunchBlocker
} from './primary-session-ports'
import {
  parseClaudeModelChoice,
  type ClaudeEffortLevel,
  type SubagentRouteRowInput
} from './primary-session-types'

// Why the store's own fields: a start the run store would refuse is refused before anything is written.
const StartWorkflowRunInputSchema = WorkflowRunCreateSchema.pick({
  requestId: true,
  workspaceId: true,
  workspaceBinding: true,
  requestedAccess: true,
  deliverableLanguage: true
})
  .extend({ objective: z.string().min(1) })
  .strict()
export type StartWorkflowRunInput = z.infer<typeof StartWorkflowRunInputSchema>

const RunCreateFieldsSchema = WorkflowRunCreateSchema.omit({ runId: true })
type RunCreateFields = z.infer<typeof RunCreateFieldsSchema>

export type StartWorkflowRunResult =
  | {
      readonly ok: true
      /** True when the request already had a run: nothing was started. */
      readonly duplicate: boolean
      readonly run: WorkflowRunRecord
      readonly owner: PrimarySessionRecord | null
    }
  | {
      readonly ok: false
      readonly blocker: WorkflowRunLaunchBlocker
      /** Null when the run was not created (refused before any write). */
      readonly run: WorkflowRunRecord | null
      readonly owner: PrimarySessionRecord | null
    }

export type WorkflowRunServiceDeps = {
  readonly db: OrchestrationDb
  /** `runtime.requireWorkbenchWorkspace`: re-admits the workspace at launch time. */
  readonly workspaces: { require(workspaceId: string): WorkbenchLocalWorkspace }
  readonly routing: {
    readonly resolver: Pick<RouteResolver, 'resolveCoordinator'>
    activeTable(): ResolvedRoutingTable
  }
  readonly launcher: {
    launch(request: PrimarySessionLaunchRequest): Promise<PrimarySessionLaunchOutcome>
  }
  readonly clock: { now(): number }
}

type Coordinator = {
  readonly version: number
  readonly sha256: string
  readonly model: string
  readonly effort: ClaudeEffortLevel
  readonly routeRows: readonly SubagentRouteRowInput[]
}

function refusedBeforeWrite(blocker: WorkflowRunLaunchBlocker): StartWorkflowRunResult {
  return { ok: false, blocker, run: null, owner: null }
}

function routeUnavailable(code: string, message: string): StartWorkflowRunResult {
  return refusedBeforeWrite(launchBlocker('coordinator_route_unavailable', code, message))
}

/** The single owner of starting a workflow run: Orca run, app record, then the visible primary. */
export function createWorkflowRunService(deps: WorkflowRunServiceDeps) {
  const { db } = deps
  const inFlight = new Map<string, Promise<StartWorkflowRunResult>>()

  /** The coordinator route must be available now; nothing is substituted (D-016). */
  async function resolveCoordinator(
    workspaceId: string
  ): Promise<Coordinator | StartWorkflowRunResult> {
    const resolved = await deps.routing.resolver.resolveCoordinator({
      workspace: { workspaceId },
      freshness: 'dispatch'
    })
    if (!resolved.ok) {
      return routeUnavailable(
        resolved.reason,
        'The routing table is not usable, so no coordinator route exists.'
      )
    }
    const availability = resolved.availability
    const choice = isDispatchable(availability)
      ? parseClaudeModelChoice(availability.cli.model, availability.cli.effort)
      : null
    if (choice === null || !choice.ok) {
      const reasons = availability.reasons.join(', ') || 'no usable model and effort'
      return routeUnavailable(
        'autopilot_coordinator_route_unavailable',
        `The coordinator route is ${availability.status}: ${reasons}.`
      )
    }
    const active = deps.routing.activeTable()
    if (
      !active.ok ||
      active.version !== resolved.table.version ||
      active.sha256 !== resolved.table.sha256
    ) {
      return routeUnavailable(
        'autopilot_routing_table_changed',
        'The routing table changed while the run was starting.'
      )
    }
    return {
      version: resolved.table.version,
      sha256: resolved.table.sha256,
      model: choice.value.model,
      effort: choice.value.effort,
      routeRows: active.table.routes.map((route) => ({
        taskType: route.task_type,
        executionTarget: route.execution_target,
        model: route.model,
        effort: route.reasoning_level
      }))
    }
  }

  function admitWorkspace(
    input: StartWorkflowRunInput
  ): WorkbenchLocalWorkspace | StartWorkflowRunResult {
    let workspace: WorkbenchLocalWorkspace
    try {
      workspace = deps.workspaces.require(input.workspaceId)
      if (workbenchWorkspaceBinding(input.workspaceId, workspace) === input.workspaceBinding) {
        return workspace
      }
    } catch (error) {
      return refusedBeforeWrite(
        launchBlocker('launch_refused', errorCodeOf(error), 'The workspace is no longer available.')
      )
    }
    return refusedBeforeWrite(
      launchBlocker(
        'launch_refused',
        'autopilot_launch_workspace_changed',
        'The workspace changed since the request was made.'
      )
    )
  }

  function existingRun(requestId: string): StartWorkflowRunResult | null {
    const existing = getWorkflowRunStore(db).getByRequestId(requestId)
    if (!existing) {
      return null
    }
    const owner = getPrimarySessionStore(db).latestForRun(existing.runId)
    return { ok: true, duplicate: true, run: existing, owner }
  }

  function createFieldsOf(
    input: StartWorkflowRunInput,
    coordinator: Coordinator
  ): RunCreateFields | null {
    const parsed = RunCreateFieldsSchema.safeParse({
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      workspaceBinding: input.workspaceBinding,
      requestedAccess: input.requestedAccess,
      deliverableLanguage: input.deliverableLanguage,
      routingTableVersion: coordinator.version,
      routingTableSha256: coordinator.sha256,
      coordinatorModel: coordinator.model,
      coordinatorEffort: coordinator.effort,
      timestamp: clockTimestamp(deps.clock)
    })
    return parsed.success ? parsed.data : null
  }

  /** Orca's run, then the app record, with nothing awaited between the duplicate check and here. */
  function createRuns(
    objective: string,
    fields: RunCreateFields
  ): { duplicate: boolean; run: WorkflowRunRecord } | StartWorkflowRunResult {
    const orcaRun = db.createRun({ objective, coordinatorHandle: null, coordinatorPaneKey: null })
    try {
      return getWorkflowRunStore(db).create({ runId: orcaRun.id, ...fields })
    } catch (error) {
      // Why logged: Orca has no API to end or delete a run, so its unbound run stays behind.
      const code = errorCodeOf(error)
      console.warn(
        `[workflow-run] the run record was not written; an unbound Orca run stays: ${code}`
      )
      return refusedBeforeWrite(
        launchBlocker('launch_refused', code, 'The run could not be recorded.')
      )
    }
  }

  async function startOnce(input: StartWorkflowRunInput): Promise<StartWorkflowRunResult> {
    const existing = existingRun(input.requestId)
    if (existing) {
      return existing
    }
    const workspace = admitWorkspace(input)
    if ('ok' in workspace) {
      return workspace
    }
    const coordinator = await resolveCoordinator(input.workspaceId)
    if ('ok' in coordinator) {
      return coordinator
    }
    const fields = createFieldsOf(input, coordinator)
    if (!fields) {
      return refusedBeforeWrite(
        launchBlocker('launch_refused', 'autopilot_invalid_input', 'The run could not be recorded.')
      )
    }
    // Why again: another start may have recorded this request while the route was resolved.
    const recorded = existingRun(input.requestId)
    if (recorded) {
      return recorded
    }
    const created = createRuns(input.objective, fields)
    if ('ok' in created) {
      return created
    }
    if (created.duplicate) {
      const owner = getPrimarySessionStore(db).latestForRun(created.run.runId)
      return { ok: true, duplicate: true, run: created.run, owner }
    }
    const launched = await deps.launcher.launch({
      run: created.run,
      objective: input.objective,
      workspacePath: workspace.path,
      routeRows: coordinator.routeRows
    })
    return launched.ok
      ? { ok: true, duplicate: false, run: launched.run, owner: launched.owner }
      : launched
  }

  return {
    /** Returns the run and its owner; Workbench rows are the caller's (D3) to update. */
    startWorkflowRun(input: StartWorkflowRunInput): Promise<StartWorkflowRunResult> {
      const parsed = StartWorkflowRunInputSchema.safeParse(input)
      if (!parsed.success) {
        return Promise.resolve(
          refusedBeforeWrite(
            launchBlocker(
              'launch_refused',
              'autopilot_invalid_input',
              'The start request is malformed.'
            )
          )
        )
      }
      const key = parsed.data.requestId
      const existing = inFlight.get(key)
      if (existing) {
        return existing
      }
      const attempt = startOnce(parsed.data).finally(() => inFlight.delete(key))
      inFlight.set(key, attempt)
      return attempt
    }
  }
}
