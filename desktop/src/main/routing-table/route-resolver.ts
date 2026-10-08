import {
  ROUTING_TASK_TYPES,
  type ExecutionTarget,
  type RoutingTaskType
} from '../../shared/routing-table/routing-table-taxonomy'
import type {
  RoutingTable,
  ValidationReviewer
} from '../../shared/routing-table/routing-table-schema'
import { selectValidationReviewer } from '../../shared/routing-table/validation-reviewer-selection'
import type {
  EvaluateOptions,
  RouteAvailabilityEvaluator,
  WorkspaceRef
} from './availability/route-availability-evaluator'
import type {
  EvaluateFreshness,
  LatchKind,
  LiveRunPrimary,
  ReasoningRequirement,
  RouteAvailabilityResult,
  RouteSubject
} from './availability/route-availability-types'
import {
  subjectForCoordinator,
  subjectForReviewer,
  subjectForRoute
} from './availability/route-subjects'
import type { ResolvedRoutingTable } from './routing-table-activation'

/**
 * The one lookup from a classified task to a route: the active table's row, checked for availability.
 * An unavailable route is reported with its reasons and is never replaced by another model, target or
 * level (D-016); whether the primary session may do the work itself is the caller's recorded decision.
 */

type ActiveTable = Extract<ResolvedRoutingTable, { readonly ok: true }>
/** The active table could not be read: not installed, damaged, or of another taxonomy. */
export type RoutingTableRefusal = Extract<ResolvedRoutingTable, { readonly ok: false }>
export type RouteTableRef = { readonly version: number; readonly sha256: string }

export type RouteResolveOptions = {
  readonly workspace?: WorkspaceRef | null
  /** Defaults to `dispatch`: a catalog at most ten minutes old and a bounded rate-limit read. */
  readonly freshness?: EvaluateFreshness
  readonly signal?: AbortSignal
  /**
   * Evidence that this run's primary session is live, read by the caller from the primary-session store.
   * In-session Claude routes (subagent, workflow) then inherit its login while Orca defers the usage read.
   */
  readonly liveRunPrimary?: LiveRunPrimary | null
}

/** The table row as configured: `inherit` is kept, the concrete values are in `availability.subject`. */
export type ConfiguredRoute = {
  readonly model: string
  readonly reasoningLevel: string
  readonly requirement: ReasoningRequirement
}

export type ResolvedRoute = {
  readonly taskType: RoutingTaskType
  readonly target: ExecutionTarget
  readonly table: RouteTableRef
  readonly configured: ConfiguredRoute
  readonly availability: RouteAvailabilityResult
}

export type RouteResolution =
  | { readonly ok: true; readonly route: ResolvedRoute }
  | { readonly ok: false; readonly reason: 'unknown_task_type' }
  | RoutingTableRefusal

export type CoordinatorResolution =
  | {
      readonly ok: true
      readonly table: RouteTableRef
      readonly agent: 'claude' | 'codex'
      readonly coordinator: { readonly model: string; readonly reasoningLevel: string }
      readonly availability: RouteAvailabilityResult
    }
  | RoutingTableRefusal

export type ReviewerResolution =
  | {
      readonly ok: true
      readonly table: RouteTableRef
      readonly reviewer: ValidationReviewer
      /** Not available means the validation is inconclusive; the next reviewer is not tried. */
      readonly availability: RouteAvailabilityResult
    }
  | { readonly ok: false; readonly reason: 'no_independent_reviewer' | 'work_model_unknown' }
  | RoutingTableRefusal

export type TableAvailability = {
  readonly coordinator: RouteAvailabilityResult
  readonly routes: readonly {
    readonly taskType: RoutingTaskType
    readonly target: ExecutionTarget
    readonly configured: ConfiguredRoute
    readonly availability: RouteAvailabilityResult
  }[]
  readonly reviewers: readonly {
    readonly reviewer: ValidationReviewer
    readonly availability: RouteAvailabilityResult
  }[]
}

export type RouteResolver = {
  resolveRoute(input: RouteResolveOptions & { readonly taskType: string }): Promise<RouteResolution>
  resolveCoordinator(options: RouteResolveOptions): Promise<CoordinatorResolution>
  resolveValidationReviewer(
    input: RouteResolveOptions & { readonly workModel: string | null | undefined }
  ): Promise<ReviewerResolution>
  /** Every route, the coordinator and the reviewers of a table, with one read per source. */
  evaluateTable(table: RoutingTable, options: RouteResolveOptions): Promise<TableAvailability>
  /** The dispatch-time re-check of a subject recorded at classification; the table is not consulted. */
  recheck(subject: RouteSubject, options: RouteResolveOptions): Promise<RouteAvailabilityResult>
  /** Records an executor-reported auth or quota failure on the route. */
  latch(subject: RouteSubject, kind: LatchKind): void
}

function isRoutingTaskType(value: string): value is RoutingTaskType {
  return ROUTING_TASK_TYPES.some((taskType) => taskType === value)
}

function evaluateOptionsOf(options: RouteResolveOptions): EvaluateOptions {
  return {
    freshness: options.freshness ?? 'dispatch',
    workspace: options.workspace ?? null,
    ...(options.signal ? { signal: options.signal } : {}),
    liveRunPrimary: options.liveRunPrimary ?? null
  }
}

function tableRefOf(table: ActiveTable): RouteTableRef {
  return { version: table.version, sha256: table.sha256 }
}

export function createRouteResolver(deps: {
  activeTable: () => ResolvedRoutingTable
  evaluator: RouteAvailabilityEvaluator
}): RouteResolver {
  const { evaluator } = deps

  async function evaluateOne(
    subject: RouteSubject,
    options: RouteResolveOptions
  ): Promise<RouteAvailabilityResult> {
    const [result] = await evaluator.evaluate([subject], evaluateOptionsOf(options))
    if (result === undefined) {
      throw new Error('The availability evaluator returned no result for one subject')
    }
    return result
  }

  async function evaluateTable(
    table: RoutingTable,
    options: RouteResolveOptions
  ): Promise<TableAvailability> {
    const reviewers = table.validation.reviewers
    const subjects = [
      subjectForCoordinator(table.coordinator),
      ...table.routes.map((route) => subjectForRoute(route, table.coordinator)),
      ...reviewers.map(subjectForReviewer)
    ]
    const results = await evaluator.evaluate(subjects, evaluateOptionsOf(options))
    const [coordinator, ...rest] = results
    if (coordinator === undefined) {
      throw new Error('The availability evaluator returned no results')
    }
    return {
      coordinator,
      routes: table.routes.flatMap((route, index) => {
        const availability = rest[index]
        return availability === undefined
          ? []
          : [
              {
                taskType: route.task_type,
                target: route.execution_target,
                configured: {
                  model: route.model,
                  reasoningLevel: route.reasoning_level,
                  requirement: route.reasoning_requirement
                },
                availability
              }
            ]
      }),
      reviewers: reviewers.flatMap((reviewer, index) => {
        const availability = rest[table.routes.length + index]
        return availability === undefined ? [] : [{ reviewer, availability }]
      })
    }
  }

  return {
    async resolveRoute(input) {
      const active = deps.activeTable()
      if (!active.ok) {
        return active
      }
      const row = isRoutingTaskType(input.taskType)
        ? active.table.routes.find((route) => route.task_type === input.taskType)
        : undefined
      if (row === undefined) {
        return { ok: false, reason: 'unknown_task_type' }
      }
      const primary = input.liveRunPrimary
      const coordinator = primary
        ? { agent: primary.agent, model: primary.model, reasoning_level: primary.effort }
        : active.table.coordinator
      const availability = await evaluateOne(subjectForRoute(row, coordinator), input)
      return {
        ok: true,
        route: {
          taskType: row.task_type,
          target: row.execution_target,
          table: tableRefOf(active),
          configured: {
            model: row.model,
            reasoningLevel: row.reasoning_level,
            requirement: row.reasoning_requirement
          },
          availability
        }
      }
    },

    async resolveCoordinator(options) {
      const active = deps.activeTable()
      if (!active.ok) {
        return active
      }
      const { coordinator } = active.table
      return {
        ok: true,
        table: tableRefOf(active),
        agent: coordinator.agent,
        coordinator: { model: coordinator.model, reasoningLevel: coordinator.reasoning_level },
        availability: await evaluateOne(subjectForCoordinator(coordinator), options)
      }
    },

    async resolveValidationReviewer(input) {
      const active = deps.activeTable()
      if (!active.ok) {
        return active
      }
      const selection = selectValidationReviewer(active.table.validation.reviewers, input.workModel)
      if (!selection.ok) {
        return { ok: false, reason: selection.reason }
      }
      return {
        ok: true,
        table: tableRefOf(active),
        reviewer: selection.reviewer,
        availability: await evaluateOne(subjectForReviewer(selection.reviewer), input)
      }
    },

    evaluateTable,
    recheck: (subject, options) => evaluateOne(subject, options),
    latch: (subject, kind) => evaluator.latch(subject, kind)
  }
}
