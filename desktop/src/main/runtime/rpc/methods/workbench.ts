import { defineMethod, type RpcContext } from '../core'
import {
  WorkbenchSubmitParams,
  WorkbenchListParams,
  WorkbenchCancelParams,
  WorkbenchClefProfilePinParams,
  WorkbenchClefVerifyParams
} from '../../../../shared/rpc-contract/workbench-params'
import { requireWorkbenchCaller } from '../../workbench-caller'
import { getWorkbenchRequestStore } from '../../orchestration/db/workbench-request-store'
import {
  cancelWorkbenchRequest,
  listWorkbenchRequests,
  submitWorkbenchRequest,
  type WorkbenchIntakeTarget
} from '../../workbench-intake-submit'
import { requireWorkbenchRoutingRuntime } from '../../workbench-routing/workbench-routing-runtime'

function intake(context: RpcContext, workspaceId: string): WorkbenchIntakeTarget {
  const caller = requireWorkbenchCaller(context.workbenchCaller)
  const workspace = context.runtime.requireWorkbenchWorkspace(workspaceId)
  // Passive intake must not start old federation or coordinator delivery pumps.
  const owner = context.runtime.getOrchestrationDb({ passive: true })
  return {
    owner,
    store: getWorkbenchRequestStore(owner),
    principalId: caller.principalId,
    workspace
  }
}

/** Clef administration needs no workspace, only the trusted desktop caller and an installed runtime. */
function routingAdministration(context: RpcContext) {
  requireWorkbenchCaller(context.workbenchCaller)
  return requireWorkbenchRoutingRuntime()
}

export const WORKBENCH_METHODS = [
  defineMethod({
    name: 'workbench.requests.submit',
    params: WorkbenchSubmitParams,
    handler: (params, context) => {
      const target = intake(context, params.workspaceId)
      return submitWorkbenchRequest(target, {
        ...params,
        workspaceId: target.workspace.workspaceId
      })
    }
  }),
  defineMethod({
    name: 'workbench.requests.list',
    params: WorkbenchListParams,
    handler: (params, context) => {
      const target = intake(context, params.workspaceId)
      return listWorkbenchRequests(target, { ...params, workspaceId: target.workspace.workspaceId })
    }
  }),
  defineMethod({
    name: 'workbench.requests.cancel',
    params: WorkbenchCancelParams,
    handler: (params, context) => {
      const target = intake(context, params.workspaceId)
      return cancelWorkbenchRequest(target, {
        ...params,
        workspaceId: target.workspace.workspaceId
      })
    }
  }),
  defineMethod({
    name: 'workbench.routing.status',
    params: null,
    handler: (_params, context) => routingAdministration(context).routingStatusView()
  }),
  defineMethod({
    name: 'workbench.clef.verify',
    params: WorkbenchClefVerifyParams,
    handler: (_params, context) => routingAdministration(context).verifyClef()
  }),
  defineMethod({
    name: 'workbench.clef.profile.pin',
    params: WorkbenchClefProfilePinParams,
    handler: (params, context) => routingAdministration(context).pinClefProfile(params.reportSha256)
  })
]
