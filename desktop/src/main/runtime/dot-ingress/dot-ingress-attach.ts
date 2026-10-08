import type { DotAttachInput } from '../../../shared/dot-ingress/dot-ingress-attach'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import type { WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import type { DotIngressServiceDeps } from './dot-ingress-ports'
import { admitDotIntake } from './dot-ingress-intake-policy'
import { analyzeDotRequirement } from './dot-ingress-requirement-analysis'
import { dotRefusal, requireDotInterfaceOn } from './dot-ingress-refusals'
import { sendDotMessage } from './dot-ingress-message-service'

/** Reuses an explicitly named coordinator; never calls the new-run intake door. */
export async function attachDotCoordinator(
  deps: DotIngressServiceDeps,
  input: DotAttachInput,
  adopt: (workspaceId: string) => { run: WorkflowRunRecord }
) {
  requireDotInterfaceOn(deps.db)
  const analysis = analyzeDotRequirement({ objective: input.objective })
  const admitted = admitDotIntake(deps, {
    workspaceRef: input.workspaceRef,
    requestedAccess: input.requestedAccess,
    recorded: null
  })
  const storeInput = {
    workspaceRef: input.workspaceRef,
    workspaceBinding: admitted.binding,
    objective: input.objective,
    requestedAccess: input.requestedAccess,
    idempotencyKey: input.idempotencyKey,
    replyCorrelationId: input.reply?.correlationId ?? null,
    client: input.client ?? null,
    scanRules: [...analysis.scanRules],
    timestamp: deps.now().toISOString()
  }
  const store = getDotIngressStore(deps.db)
  const prior = store.attachmentReplay(storeInput, input.coordinatorRunId)
  if (prior) {
    await sendDotMessage(deps, {
      dotRequestId: prior.record.dotRequestId,
      messageId: input.idempotencyKey,
      text: input.objective
    })
    return prior
  }
  const { run } = adopt(admitted.workspace.workspaceId)
  if (
    run.runId !== input.coordinatorRunId ||
    run.workspaceId !== admitted.workspace.workspaceId ||
    run.workspaceBinding !== admitted.binding
  ) {
    throw dotRefusal('dot_workspace_unavailable')
  }
  if (run.requestedAccess !== input.requestedAccess) {
    throw dotRefusal('dot_access_above_maximum')
  }
  const result = store.attach(storeInput, run.runId, run.requestId)
  await sendDotMessage(deps, {
    dotRequestId: result.record.dotRequestId,
    messageId: input.idempotencyKey,
    text: input.objective
  })
  return result
}
