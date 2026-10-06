import { z } from 'zod'
import {
  CONCRETE_REASONING_LEVELS,
  EXECUTION_TARGETS,
  REASONING_REQUIREMENTS,
  type ExecutionTarget
} from '../../../shared/routing-table/routing-table-taxonomy'
import {
  isDispatchable,
  type AvailableRouteResult,
  type LiveRunPrimary,
  type RouteAvailabilityResult,
  type RouteSubject
} from '../../routing-table/availability/route-availability-types'
import type { RouteResolver } from '../../routing-table/route-resolver'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { JsonObjectSchema, type JsonObject } from '../orchestration/db/autopilot-json-column'
import { parseAutopilotInput } from '../orchestration/db/autopilot-store-input'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getTaskClassificationStore } from '../orchestration/db/task-classification-store'
import { getTaskRouteStore, type TaskRouteRecord } from '../orchestration/db/task-route-store'

/** The routing-table side task-start needs (B2's resolver): the dispatch re-check and the latch. */
export type RouteRecheckPort = Pick<RouteResolver, 'recheck' | 'latch'>

export type DelegatedRoute = {
  readonly kind: 'delegated'
  /** The row that records this re-check; the start goes out on it, so the audit shows what it saw. */
  readonly routeId: string
  readonly target: ExecutionTarget
  readonly taskType: string
  readonly subject: RouteSubject
  readonly availability: AvailableRouteResult
}

/** The classification kept the task with the primary (needs_delegation false): no table row to re-check. */
export type KeptRoute = { readonly kind: 'kept_by_primary'; readonly routeId: string }

export type CheckedRoute = DelegatedRoute | KeptRoute

type TargetedRoute = TaskRouteRecord & { readonly target: ExecutionTarget }

const IN_SESSION: readonly ExecutionTarget[] = [
  'claude_primary',
  'claude_subagent',
  'claude_workflow'
]

const PROCESS_TARGETS: readonly ExecutionTarget[] = ['codex_cli', 'agy_cli']

const StoredSubjectSchema = z.object({
  subject: z
    .object({
      target: z.enum(EXECUTION_TARGETS),
      model: z.string().min(1).max(128),
      reasoningLevel: z.enum(CONCRETE_REASONING_LEVELS),
      requirement: z.enum(REASONING_REQUIREMENTS),
      inheritsCoordinator: z.boolean()
    })
    .strict()
})

function refuse(code: string, message: string, data?: unknown): never {
  throw new OrchestrationError(code, message, data)
}

/** The subject the classification step recorded with the route (C2); it is re-checked, never rebuilt. */
function storedSubject(route: TargetedRoute): RouteSubject {
  const parsed = StoredSubjectSchema.safeParse(route.availability ?? {})
  if (!parsed.success) {
    return refuse(
      'autopilot_route_subject_missing',
      'The route has no recorded subject to re-check.'
    )
  }
  const { subject } = parsed.data
  if (subject.target !== route.target || (route.model !== null && route.model !== subject.model)) {
    return refuse(
      'autopilot_route_subject_mismatch',
      'The recorded subject does not match the route.'
    )
  }
  return subject
}

/** A delegated row names its target; a Codex or agy row also names its own model, never `inherit`. */
function targetedRoute(route: TaskRouteRecord): TargetedRoute {
  const { target } = route
  if (target === null) {
    return refuse('autopilot_route_subject_mismatch', 'A delegated route names no target.')
  }
  if (
    PROCESS_TARGETS.includes(target) &&
    (route.model === null || route.policyLevel === 'inherit')
  ) {
    return refuse(
      'autopilot_route_model_missing',
      'A Codex or agy route must name its own model; it cannot inherit one.'
    )
  }
  return { ...route, target }
}

// Why: D-020 lets an in-session route inherit the login of the run's own primary only while it is live.
function liveRunPrimary(owner: OrchestrationDb, runId: string): LiveRunPrimary | null {
  const session = getPrimarySessionStore(owner).findLiveByRun(runId)
  return session?.state === 'running' ? { runId, ownerId: session.ownerId } : null
}

function toJsonObject(value: unknown, what: string): JsonObject {
  return parseAutopilotInput(JsonObjectSchema, JSON.parse(JSON.stringify(value)), what)
}

/** The answer as the route row keeps it: per-check outcomes without their evidence, which stays bounded. */
function availabilityRecord(result: RouteAvailabilityResult): JsonObject {
  const { snapshot } = result
  return toJsonObject(
    {
      subject: result.subject,
      status: result.status,
      reasons: result.reasons,
      cli: result.cli,
      snapshot: {
        checkedAtMs: snapshot.checkedAtMs,
        freshness: snapshot.freshness,
        workspaceKind: snapshot.workspaceKind,
        checks: snapshot.checks.map((check) =>
          check.result === 'pass'
            ? { check: check.check, result: check.result }
            : { check: check.check, result: check.result, reason: check.reason }
        )
      }
    },
    'route availability'
  )
}

function recordRecheck(
  owner: OrchestrationDb,
  route: TargetedRoute,
  result: RouteAvailabilityResult,
  timestamp: string
): TaskRouteRecord {
  return getTaskRouteStore(owner).record({
    classificationId: route.classificationId,
    routingTableVersion: route.routingTableVersion,
    routingTableSha256: route.routingTableSha256,
    target: route.target,
    model: route.model,
    policyLevel: route.policyLevel,
    cliSetting: result.cli ? toJsonObject(result.cli, 'route setting') : null,
    status: result.status,
    reasons: [...result.reasons],
    availability: availabilityRecord(result),
    timestamp
  })
}

type RecheckInput = {
  readonly taskId: string
  readonly runId: string
  readonly workspaceId: string
  readonly workflowName: string | null
}

type StoredRoute = {
  readonly route: TargetedRoute
  readonly subject: RouteSubject
  readonly taskType: string
}

/** Everything that can refuse a start before any availability check runs. */
function storedRoute(
  owner: OrchestrationDb,
  stored: TaskRouteRecord,
  input: RecheckInput
): StoredRoute {
  const route = targetedRoute(stored)
  const subject = storedSubject(route)
  if (route.target === 'claude_workflow' && input.workflowName === null) {
    return refuse(
      'autopilot_workflow_name_missing',
      'A workflow route needs the TaskSpec to name the workflow.'
    )
  }
  const taskType = getTaskClassificationStore(owner).get(route.classificationId)?.taskType
  if (!taskType) {
    return refuse('autopilot_classification_not_found', 'The route has no classified task type.')
  }
  return { route, subject, taskType }
}

/**
 * Re-checks the task's recorded route right before a start and records the answer as a new route row.
 * Only an available route starts; nothing is substituted for one that is not (D-016).
 */
export async function recheckTaskRoute(
  deps: {
    readonly owner: OrchestrationDb
    readonly routes: RouteRecheckPort
    readonly now: () => string
  },
  input: RecheckInput
): Promise<CheckedRoute> {
  const stored = getTaskRouteStore(deps.owner).latestForTask(input.taskId)
  if (!stored) {
    return refuse('autopilot_route_not_found', 'The task has no route yet.')
  }
  if (stored.status === 'not_delegated') {
    return { kind: 'kept_by_primary', routeId: stored.routeId }
  }
  const { route, subject, taskType } = storedRoute(deps.owner, stored, input)
  const result = await deps.routes.recheck(subject, {
    workspace: { workspaceId: input.workspaceId },
    liveRunPrimary: IN_SESSION.includes(route.target)
      ? liveRunPrimary(deps.owner, input.runId)
      : null
  })
  const recorded = recordRecheck(deps.owner, route, result, deps.now())
  if (!isDispatchable(result)) {
    return refuse(
      'autopilot_route_not_available',
      'The route is not available; nothing was started.',
      { routeId: recorded.routeId, status: result.status, reasons: [...result.reasons] }
    )
  }
  if (result.cli.target !== route.target || result.cli.model !== subject.model) {
    return refuse('autopilot_route_subject_mismatch', 'The re-check answered for another route.')
  }
  return {
    kind: 'delegated',
    routeId: recorded.routeId,
    target: route.target,
    taskType,
    subject,
    availability: result
  }
}
