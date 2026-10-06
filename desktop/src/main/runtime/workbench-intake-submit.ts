import { DOT_INGRESS_PRINCIPAL_ID } from '../../shared/dot-ingress/dot-ingress-limits'
import type {
  WorkbenchCancelResult,
  WorkbenchListResult,
  WorkbenchSubmitResult
} from '../../shared/workbench-request'
import type {
  WorkbenchCancelInput,
  WorkbenchListInput,
  WorkbenchSubmitInput
} from '../../shared/rpc-contract/workbench-params'
import type { OrchestrationDb } from './orchestration/db/orchestration-db'
import type { WorkbenchRequestStore } from './orchestration/db/workbench-request-store'
import { getWorkflowRunStore } from './orchestration/db/workflow-run-store'
import { OrchestrationError } from './orchestration/orchestration-error'
import type { WorkbenchLocalWorkspace } from './workbench-local-workspace'
import { scheduleWorkbenchLaunch, waitForWorkbenchLaunch } from './workbench-intake-launch'
import { stopWorkflowRunForCancel, type RunCancelReason } from './workbench-run/workbench-run-stop'
import { requirePrimarySessionRuntime } from './workflow-run/primary-session-runtime'

/** The admitted caller, workspace and stores behind one Workbench RPC call. */
export type WorkbenchIntakeTarget = {
  readonly owner: OrchestrationDb
  readonly store: WorkbenchRequestStore
  readonly principalId: string
  readonly workspace: WorkbenchLocalWorkspace
}

const cancels = new Map<string, Promise<WorkbenchCancelResult>>()

/**
 * The single intake door (desktop submit and dot submissions, D-018: no confirmation step). The store
 * records the request as RECEIVED with its requested access; the workflow run starts right after the
 * door returns (LAUNCHING, then LAUNCHED or LAUNCH_BLOCKED). A replayed key starts nothing. D-016 has
 * no classification at intake, so a submit makes no Clef call and no spend reservation.
 */
export function submitWorkbenchRequest(
  target: WorkbenchIntakeTarget,
  params: WorkbenchSubmitInput
): WorkbenchSubmitResult {
  const result = target.store.submit(target.principalId, params, target.workspace)
  if (result.duplicate === false) {
    scheduleWorkbenchLaunch(target, result.request)
  }
  return result
}

function cancelReason(principalId: string): RunCancelReason {
  return principalId === DOT_INGRESS_PRINCIPAL_ID ? 'dot_canceled' : 'user_canceled'
}

function isHandedOff(error: unknown): boolean {
  return error instanceof OrchestrationError && error.code === 'workbench_request_handed_off'
}

/** A launching or launched request: settle its launch, stop its run, then record the cancel. */
async function cancelHandedOff(
  target: WorkbenchIntakeTarget,
  params: WorkbenchCancelInput
): Promise<WorkbenchCancelResult> {
  await waitForWorkbenchLaunch(params.requestId)
  const ids = { workspaceId: params.workspaceId, requestId: params.requestId }
  const current = target.store.get(target.principalId, ids, target.workspace)
  if (current.status === 'CANCELED') {
    return { request: current, changed: false }
  }
  const atCurrent = { ...ids, expectedRevision: current.revision }
  if (current.status === 'ROUTING_BLOCKED') {
    return target.store.cancel(target.principalId, atCurrent, target.workspace)
  }
  const runId =
    current.workflowRunId ??
    getWorkflowRunStore(target.owner).getByRequestId(params.requestId)?.runId ??
    null
  if (runId !== null) {
    await stopWorkflowRunForCancel(
      target.owner,
      runId,
      cancelReason(target.principalId),
      requirePrimarySessionRuntime
    )
  }
  const request = target.store.advance(target.principalId, atCurrent, target.workspace, {
    to: 'CANCELED'
  })
  return { request, changed: true }
}

/**
 * Cancels a received or launch-blocked request in one store transaction. A request handed to its run
 * is canceled by stopping the run's primary first (D-016); a second cancel joins the first.
 */
export async function cancelWorkbenchRequest(
  target: WorkbenchIntakeTarget,
  params: WorkbenchCancelInput
): Promise<WorkbenchCancelResult> {
  try {
    return target.store.cancel(target.principalId, params, target.workspace)
  } catch (error) {
    if (!isHandedOff(error)) {
      throw error
    }
  }
  const pending = cancels.get(params.requestId)
  if (pending) {
    return pending
  }
  const canceling = cancelHandedOff(target, params).finally(() => cancels.delete(params.requestId))
  cancels.set(params.requestId, canceling)
  return canceling
}

/** Reads local SQLite only; the routing summary stays at the store's fail-closed default. */
export function listWorkbenchRequests(
  target: WorkbenchIntakeTarget,
  params: WorkbenchListInput
): WorkbenchListResult {
  return target.store.list(target.principalId, params, target.workspace)
}
