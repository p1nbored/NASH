import type { WorkbenchRequest } from '../../../shared/workbench-request'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { getDotIngressStore, type DotRequestRecord } from '../orchestration/db/dot-ingress-store'
import type { WorkbenchIntakeTarget } from '../workbench-intake-submit'
import type { DotIngressServiceDeps } from './dot-ingress-ports'
import {
  admitDotWorkspace,
  dotIntakeTarget,
  dotRefusal,
  orchestrationCodeOf,
  requireDotInterfaceOn
} from './dot-ingress-refusals'
import { findDotRequestRun } from './dot-ingress-run-link'

// The dot cancels only its own request: the door stops the run the request started and cancels the
// Workbench request first, and only then is the dot row marked canceled.

const DOOR_ATTEMPTS = 2

function busy(reason: string): Error {
  return dotRefusal('dot_request_busy', { reason })
}

// The door's refusals as dot codes; its message and stop code stay in the app (coarse, D-017).
const REFUSALS_BY_DOOR_CODE: ReadonlyMap<string, () => Error> = new Map([
  ['workbench_request_handed_off', () => dotRefusal('dot_request_not_cancelable')],
  [
    'workbench_run_completed',
    () => dotRefusal('dot_request_not_cancelable', { reason: 'run_completed' })
  ],
  ['workbench_run_stop_unconfirmed', () => busy('run_stop_unconfirmed')],
  ['workbench_run_stop_refused', () => busy('run_stop_refused')],
  ['autopilot_primary_session_not_configured', () => busy('run_control_unavailable')],
  ['workbench_revision_conflict', () => busy('request_changed')],
  ['workbench_run_not_found', () => dotRefusal('dot_recovery_required')],
  ['workbench_request_not_found', () => dotRefusal('dot_recovery_required')],
  ['workbench_workspace_unavailable', () => dotRefusal('dot_workspace_unavailable')],
  ['unsupported_host', () => dotRefusal('dot_workspace_unavailable')]
])

/** An unexpected failure is not translated; the ingress then answers with a generic error. */
function doorRefusal(error: unknown): unknown {
  const refusal = REFUSALS_BY_DOOR_CODE.get(orchestrationCodeOf(error) ?? '')
  return refusal ? refusal() : error
}

function readWorkbenchRequest(target: WorkbenchIntakeTarget, requestId: string): WorkbenchRequest {
  try {
    return target.store.get(
      target.principalId,
      { workspaceId: target.workspace.workspaceId, requestId },
      target.workspace
    )
  } catch (error) {
    // Why: the dot row links this request, so not finding it in the dot scope is an inconsistency.
    if (orchestrationCodeOf(error) === 'workbench_request_not_found') {
      throw dotRefusal('dot_recovery_required')
    }
    throw error
  }
}

async function cancelThroughDoor(
  deps: DotIngressServiceDeps,
  target: WorkbenchIntakeTarget,
  requestId: string
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const current = readWorkbenchRequest(target, requestId)
    if (current.status === 'CANCELED') {
      return
    }
    try {
      await deps.door.cancel(target, {
        workspaceId: target.workspace.workspaceId,
        requestId,
        expectedRevision: current.revision
      })
      return
    } catch (error) {
      // Why one retry: the launch may have moved the request on between the read and the cancel.
      const conflict = orchestrationCodeOf(error) === 'workbench_revision_conflict'
      if (!conflict || attempt >= DOOR_ATTEMPTS) {
        throw doorRefusal(error)
      }
    }
  }
}

/** Cancels a submitted dot request after its run stopped; a repeat reports no change. */
export async function cancelDotRequest(
  deps: DotIngressServiceDeps,
  dotRequestId: string
): Promise<{ record: DotRequestRecord; changed: boolean }> {
  requireDotInterfaceOn(deps.db)
  const store = getDotIngressStore(deps.db)
  const record = store.get(dotRequestId)
  if (record.state === 'canceled') {
    return { record, changed: false }
  }
  const requestId = record.workbenchRequestId
  if (record.state !== 'submitted' || requestId === null) {
    throw dotRefusal('dot_request_not_cancelable')
  }
  // Proves the run, if one was launched, came from this dot request before anything is stopped.
  findDotRequestRun(deps.db, record)
  const entry = getDotIngressSettingsStore(deps.db).getWorkspace(record.workspaceRef)
  if (!entry) {
    throw dotRefusal('dot_recovery_required')
  }
  const admitted = admitDotWorkspace(deps, entry.workspaceId)
  await cancelThroughDoor(deps, dotIntakeTarget(deps.db, admitted.workspace), requestId)
  return store.cancel({ dotRequestId, timestamp: deps.now().toISOString() })
}
