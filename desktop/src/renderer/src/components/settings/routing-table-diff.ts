import type { RoutingTaskType } from '../../../../shared/routing-table/routing-table-taxonomy'
import type {
  Coordinator,
  Route,
  RoutingTable,
  ValidationPolicy
} from '../../../../shared/routing-table/routing-table-schema'

/** What a proposal (or a user modification) replaces; the shape both share. */
export type TableChangeSet = {
  readonly changes: readonly Route[]
  readonly coordinator?: Coordinator
  readonly validation?: ValidationPolicy
}

export type RouteChange = {
  readonly taskType: RoutingTaskType
  /** The active row it replaces; null when no table is active. */
  readonly before: Route | null
  readonly after: Route
  /** False when only informational fields (notes, sources) differ. */
  readonly policyChanged: boolean
}

export type ProposalDiff = {
  readonly routes: readonly RouteChange[]
  readonly coordinator: { readonly before: Coordinator | null; readonly after: Coordinator } | null
  readonly validation: {
    readonly before: ValidationPolicy | null
    readonly after: ValidationPolicy
  } | null
}

/** The four fields routing reads; notes and benchmark sources are informational only. */
export function samePolicy(a: Route, b: Route): boolean {
  return (
    a.execution_target === b.execution_target &&
    a.model === b.model &&
    a.reasoning_level === b.reasoning_level &&
    a.reasoning_requirement === b.reasoning_requirement
  )
}

export function activeRoute(table: RoutingTable | null, taskType: RoutingTaskType): Route | null {
  return table?.routes.find((route) => route.task_type === taskType) ?? null
}

/** Each proposed replacement next to what is active now, for a before and after reading. */
export function diffProposal(active: RoutingTable | null, change: TableChangeSet): ProposalDiff {
  return {
    routes: change.changes.map((after) => {
      const before = activeRoute(active, after.task_type)
      return {
        taskType: after.task_type,
        before,
        after,
        policyChanged: before === null || !samePolicy(before, after)
      }
    }),
    coordinator: change.coordinator
      ? { before: active?.coordinator ?? null, after: change.coordinator }
      : null,
    validation: change.validation
      ? { before: active?.validation ?? null, after: change.validation }
      : null
  }
}
