import {
  WorkbenchRoutingTableCheckResultSchema,
  WorkbenchRoutingTableDecisionResultSchema,
  WorkbenchRoutingTableListResultSchema,
  type RoutingTableRefusalView,
  type WorkbenchRoutingTableCheckResult,
  type WorkbenchRoutingTableDecisionResult,
  type WorkbenchRoutingTableListResult
} from '../../../shared/workbench-routing-table-view'
import { resolveActiveRoutingTable } from '../../routing-table/routing-table-activation'
import type { RoutingTableContext } from '../../routing-table/routing-table-context'
import type { RoutingTable } from '../../../shared/routing-table/routing-table-schema'
import type { RoutingTableAvailabilityView } from '../../../shared/workbench-route-availability-view'
import { routingModelLists } from './routing-table-model-lists'
import {
  checkedTableAvailability,
  listedTableAvailability,
  type RoutingTableAvailabilitySource
} from './routing-table-availability-view'

/** The fields any routing-table refusal may carry; numbers and other extras are not shown. */
type Refusal = {
  readonly ok: false
  readonly reason: string
  readonly detail?: string
}

type Success = { readonly ok: true; readonly version: number; readonly sha256: string }

export function routingTableRefusalView(refusal: Refusal): RoutingTableRefusalView {
  return {
    ok: false,
    reason: refusal.reason,
    detail: refusal.detail ?? null
  }
}

/** The save result, parsed strictly before it leaves main. */
export function routingTableDecisionView(
  result: Success | Refusal
): WorkbenchRoutingTableDecisionResult {
  return WorkbenchRoutingTableDecisionResultSchema.parse(
    result.ok
      ? {
          ok: true,
          version: result.version,
          sha256: result.sha256
        }
      : routingTableRefusalView(result)
  )
}

// Why null on failure: the table stays usable when availability cannot be read.
async function listedAvailabilityOrNull(
  availability: RoutingTableAvailabilitySource,
  table: RoutingTable
): Promise<RoutingTableAvailabilityView | null> {
  try {
    return await listedTableAvailability(availability, table)
  } catch (error) {
    console.warn(
      `[routing-table] route availability not listed: ${error instanceof Error ? error.name : 'unknown'}`
    )
    return null
  }
}

/** The active table and cached route availability; a damaged store is shown, not hidden. */
export async function routingTableListView(
  ctx: RoutingTableContext,
  availability: RoutingTableAvailabilitySource | null
): Promise<WorkbenchRoutingTableListResult> {
  const active = resolveActiveRoutingTable(ctx)
  const routes =
    active.ok && availability !== null
      ? await listedAvailabilityOrNull(availability, active.table)
      : null
  return WorkbenchRoutingTableListResultSchema.parse({
    active: active.ok
      ? {
          ok: true,
          version: active.version,
          sha256: active.sha256,
          source: active.source,
          table: active.table
        }
      : routingTableRefusalView(active),
    availability: routes,
    models: await routingModelLists(availability, 'cached')
  })
}

/** "Check now" on the active table; a table that cannot be read is refused and nothing is checked. */
export async function routingTableCheckView(
  ctx: RoutingTableContext,
  availability: RoutingTableAvailabilitySource
): Promise<WorkbenchRoutingTableCheckResult> {
  const active = resolveActiveRoutingTable(ctx)
  if (!active.ok) {
    return WorkbenchRoutingTableCheckResultSchema.parse(routingTableRefusalView(active))
  }
  const [routes, models] = await Promise.all([
    checkedTableAvailability(availability, active.table),
    routingModelLists(availability, 'recheck')
  ])
  return WorkbenchRoutingTableCheckResultSchema.parse({
    ok: true,
    version: active.version,
    sha256: active.sha256,
    availability: routes,
    models
  })
}
