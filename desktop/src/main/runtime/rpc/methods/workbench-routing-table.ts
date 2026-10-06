import {
  WorkbenchRoutingTableAcceptParams,
  WorkbenchRoutingTableCheckRoutesParams,
  WorkbenchRoutingTableImportParams,
  WorkbenchRoutingTableListParams,
  WorkbenchRoutingTableRejectParams,
  WorkbenchRoutingTableRevertParams
} from '../../../../shared/rpc-contract/workbench-run-params'
import type { RoutingTableCaller } from '../../../../shared/routing-table/routing-table-proposal-schema'
import { revertRoutingTable } from '../../../routing-table/routing-table-activation'
import type { RoutingTableContext } from '../../../routing-table/routing-table-context'
import {
  acceptRoutingTableProposal,
  rejectRoutingTableProposal,
  submitRoutingTableProposal
} from '../../../routing-table/routing-table-proposals'
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
const DESKTOP_USER: RoutingTableCaller = 'desktop_user'

/** The trusted desktop renderer only (U5: agents and app updates propose; only the desktop decides). */
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

export const WORKBENCH_ROUTING_TABLE_ACCEPT_METHOD = defineMethod({
  name: 'workbench.routingTable.accept',
  params: WorkbenchRoutingTableAcceptParams,
  handler: (params, context) =>
    routingTableDecisionView(
      acceptRoutingTableProposal(desktopTable(context), {
        proposalId: params.proposalId,
        caller: DESKTOP_USER,
        ...(params.modification === undefined ? {} : { modification: params.modification })
      }),
      params.proposalId
    )
})

export const WORKBENCH_ROUTING_TABLE_REJECT_METHOD = defineMethod({
  name: 'workbench.routingTable.reject',
  params: WorkbenchRoutingTableRejectParams,
  handler: (params, context) =>
    routingTableDecisionView(
      rejectRoutingTableProposal(desktopTable(context), {
        proposalId: params.proposalId,
        caller: DESKTOP_USER
      }),
      params.proposalId
    )
})

/** Stores the user's change set as a pending `user_import` proposal; accepting it is a second step. */
export const WORKBENCH_ROUTING_TABLE_IMPORT_METHOD = defineMethod({
  name: 'workbench.routingTable.import',
  params: WorkbenchRoutingTableImportParams,
  handler: (params, context) => {
    const submitted = submitRoutingTableProposal(
      desktopTable(context),
      params.proposal,
      DESKTOP_USER
    )
    return routingTableDecisionView(submitted, submitted.ok ? submitted.proposalId : null)
  }
})

/** Re-activates an earlier version's content as a new version. */
export const WORKBENCH_ROUTING_TABLE_REVERT_METHOD = defineMethod({
  name: 'workbench.routingTable.revert',
  params: WorkbenchRoutingTableRevertParams,
  handler: (params, context) =>
    routingTableDecisionView(
      revertRoutingTable(desktopTable(context), { version: params.version, caller: DESKTOP_USER }),
      null
    )
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
  WORKBENCH_ROUTING_TABLE_ACCEPT_METHOD,
  WORKBENCH_ROUTING_TABLE_REJECT_METHOD,
  WORKBENCH_ROUTING_TABLE_IMPORT_METHOD,
  WORKBENCH_ROUTING_TABLE_REVERT_METHOD,
  WORKBENCH_ROUTING_TABLE_CHECK_ROUTES_METHOD
]
