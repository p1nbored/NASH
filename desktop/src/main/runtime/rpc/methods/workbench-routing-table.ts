import {
  WorkbenchRoutingTableCheckRoutesParams,
  WorkbenchRoutingTableSaveParams,
  WorkbenchRoutingTableListParams
} from '../../../../shared/rpc-contract/workbench-run-params'
import type { RoutingTableContext } from '../../../routing-table/routing-table-context'
import { saveRoutingTable } from '../../../routing-table/routing-table-save'
import { requireWorkbenchCaller } from '../../workbench-caller'
import {
  requireRoutingTableAvailability,
  requireRoutingTableContext,
  routingTableAvailabilityOf
} from '../../workbench-run/routing-table-context-registry'
import {
  routingTableCheckView,
  routingTableDecisionView,
  routingTableListView
} from '../../workbench-run/routing-table-view-mapping'
import { defineMethod, type RpcContext } from '../core'

// Why a constant: the routing-table store decides only for this caller, and only the RPC context names it.
const DESKTOP_USER = 'desktop_user'

/** Routing edits belong to the trusted desktop renderer. */
function desktopTable(context: RpcContext): RoutingTableContext {
  requireWorkbenchCaller(context.workbenchCaller)
  return requireRoutingTableContext(context.runtime)
}

/** Route availability from held readings only: listing starts no CLI process, network call or login read. */
export const WORKBENCH_ROUTING_TABLE_LIST_METHOD = defineMethod({
  name: 'workbench.routingTable.list',
  params: WorkbenchRoutingTableListParams,
  handler: (_params, context) =>
    routingTableListView(desktopTable(context), routingTableAvailabilityOf(context.runtime))
})

export const WORKBENCH_ROUTING_TABLE_SAVE_METHOD = defineMethod({
  name: 'workbench.routingTable.save',
  params: WorkbenchRoutingTableSaveParams,
  handler: (params, context) =>
    routingTableDecisionView(saveRoutingTable(desktopTable(context), params, DESKTOP_USER))
})

/**
 * The user's "Check now": re-reads detection, each CLI's model list and the rate limits for every
 * route of the active table. Desktop only, because it may run each CLI's model listing.
 */
export const WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD = defineMethod({
  name: 'workbench.routingTable.checkRoutes',
  params: WorkbenchRoutingTableCheckRoutesParams,
  handler: (_params, context) => {
    const ctx = desktopTable(context)
    return routingTableCheckView(ctx, requireRoutingTableAvailability(context.runtime))
  }
})

/** Registered as one group in `rpc/methods/index.ts`; the caller-boundary test lists each name. */
export const WORKBENCH_ROUTING_TABLE_METHODS = [
  WORKBENCH_ROUTING_TABLE_LIST_METHOD,
  WORKBENCH_ROUTING_TABLE_SAVE_METHOD,
  WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD
]
