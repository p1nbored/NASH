import {
  WorkbenchValidationCheckPendingParams,
  type WorkbenchValidationCheckPendingResult
} from '../../../../shared/rpc-contract/workbench-validation-params'
import {
  WORKBENCH_VALIDATION_DECISIONS_DEFAULT_LIMIT,
  WorkbenchValidationDecideParams,
  WorkbenchValidationListDecisionsParams,
  type WorkbenchValidationDecideResult,
  type WorkbenchValidationListDecisionsResult
} from '../../../../shared/rpc-contract/workbench-validation-decision-params'
import { requireValidationBacklogPort } from '../../task-validation/validation-backlog-port'
import {
  createValidationDecisionService,
  type ValidationDecisionService
} from '../../task-validation/validation-decision-service'
import { requireWorkbenchCaller } from '../../workbench-caller'
import { defineMethod, type RpcContext } from '../core'

/**
 * The desktop's "Check now": one pass over the attempts still waiting for a verdict. Desktop only,
 * because a pass runs a model review (a reviewer CLI) for a task whose TaskSpec asks for one.
 */
export const WORKBENCH_VALIDATION_CHECK_PENDING_METHOD = defineMethod({
  name: 'workbench.validation.checkPending',
  params: WorkbenchValidationCheckPendingParams,
  handler: (_params, context): Promise<WorkbenchValidationCheckPendingResult> => {
    requireWorkbenchCaller(context.workbenchCaller)
    return requireValidationBacklogPort(context.runtime).checkBacklog()
  }
})

/**
 * Inconclusive results are the user's or dot's to resolve, never the primary's (section 9): the
 * same trusted-desktop check as the permission answer, before the database is even opened.
 */
function desktopDecisions(context: RpcContext): ValidationDecisionService {
  requireWorkbenchCaller(context.workbenchCaller)
  const { runtime } = context
  return createValidationDecisionService({
    owner: runtime.getOrchestrationDb({ passive: true }),
    announce: (message) => runtime.notifyMessageArrived(message.to_handle, message.type)
  })
}

export const WORKBENCH_VALIDATION_LIST_DECISIONS_METHOD = defineMethod({
  name: 'workbench.validation.listDecisions',
  params: WorkbenchValidationListDecisionsParams,
  handler: (params, context): WorkbenchValidationListDecisionsResult =>
    desktopDecisions(context).listPending({
      limit: params.limit ?? WORKBENCH_VALIDATION_DECISIONS_DEFAULT_LIMIT
    })
})

export const WORKBENCH_VALIDATION_DECIDE_METHOD = defineMethod({
  name: 'workbench.validation.decide',
  params: WorkbenchValidationDecideParams,
  handler: (params, context): Promise<WorkbenchValidationDecideResult> =>
    desktopDecisions(context).decide({ ...params, by: 'desktop_user' })
})

/** Registered as one group in `rpc/methods/index.ts`; the caller-boundary test lists each name. */
export const WORKBENCH_VALIDATION_METHODS = [
  WORKBENCH_VALIDATION_CHECK_PENDING_METHOD,
  WORKBENCH_VALIDATION_LIST_DECISIONS_METHOD,
  WORKBENCH_VALIDATION_DECIDE_METHOD
]
