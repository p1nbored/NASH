import {
  WorkbenchPermissionAnswerParams,
  WorkbenchPermissionListParams
} from '../../../../shared/rpc-contract/permission-relay-params'
import { requirePermissionRelay } from '../../permission-relay/permission-relay-registry'
import { requireWorkbenchCaller } from '../../workbench-caller'
import { defineMethod } from '../core'

/**
 * The desktop side of the permission relay: list the prompts of open app runs and answer one. Only
 * the trusted desktop caller reaches them. Not registered here: package E1 adds them.
 */
export const WORKBENCH_PERMISSION_LIST_METHOD = defineMethod({
  name: 'workbench.permission.list',
  params: WorkbenchPermissionListParams,
  handler: (params, context) => {
    requireWorkbenchCaller(context.workbenchCaller)
    return requirePermissionRelay(context.runtime).listForDesktop(params)
  }
})

export const WORKBENCH_PERMISSION_ANSWER_METHOD = defineMethod({
  name: 'workbench.permission.answer',
  params: WorkbenchPermissionAnswerParams,
  handler: (params, context) => {
    requireWorkbenchCaller(context.workbenchCaller)
    return requirePermissionRelay(context.runtime).answerFromDesktop(params)
  }
})

export const WORKBENCH_PERMISSION_METHODS = [
  WORKBENCH_PERMISSION_LIST_METHOD,
  WORKBENCH_PERMISSION_ANSWER_METHOD
]
