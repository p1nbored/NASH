import { ZodError } from 'zod'
import type {
  DotRequestAccess,
  DotSubmissionFailure
} from '../../../shared/dot-ingress/dot-ingress-limits'
import type { DotClientDescriptor } from '../../../shared/dot-ingress/dot-ingress-params'
import { findReceivedDotIntake } from '../orchestration/db/dot-ingress-intake-reads'
import {
  getDotIngressStore,
  type DotIntakeHandle,
  type DotRequestRecord
} from '../orchestration/db/dot-ingress-store'
import {
  admitDotIntake,
  intakeFailureOfRefusal,
  requireRecordedRequirement
} from './dot-ingress-intake-policy'
import type { DotIngressServiceDeps } from './dot-ingress-ports'
import {
  dotIntakeTarget,
  orchestrationCodeOf,
  requireDotInterfaceOn,
  type AdmittedDotWorkspace
} from './dot-ingress-refusals'
import { analyzeDotRequirement } from './dot-ingress-requirement-analysis'
import { findAcceptedWorkbenchRequestId } from './dot-ingress-run-link'

// D-018: a valid dot submission goes straight through the single intake door under the dot principal
// and starts a run, with no desktop confirmation. The rails stay: the interface switch, the workspaces
// the user enabled with their access maximum, and the submission caps the store enforces. The
// admission policy is re-run right before every door submit, so revoking dot stops what is not
// handed over yet; a request the Workbench already accepted is only linked, never canceled.

/** A submit as the dot sent it, without its contract version. */
export type DotSubmitRequest = {
  workspaceRef: string
  objective: string
  requestedAccess: DotRequestAccess
  idempotencyKey: string
  reply?: { correlationId?: string }
  client?: DotClientDescriptor
}

export type DotSubmitOutcome = { record: DotRequestRecord; duplicate: boolean }

const RECOVERY_BATCH = 100

// Codes the door only raises before it records anything, so the dot row may end as failed.
const FAILURE_BY_DOOR_CODE: ReadonlyMap<string, DotSubmissionFailure> = new Map([
  ['workbench_capacity_exceeded', 'capacity_exceeded'],
  ['workbench_workspace_unavailable', 'workspace_unavailable'],
  ['unsupported_host', 'workspace_unavailable'],
  ['workbench_idempotency_conflict', 'intake_refused'],
  ['workbench_invalid_input', 'intake_refused'],
  ['workbench_forbidden', 'intake_refused']
])

function refusedBeforeCreation(error: unknown): DotSubmissionFailure | null {
  if (error instanceof ZodError) {
    return 'intake_refused'
  }
  return FAILURE_BY_DOOR_CODE.get(orchestrationCodeOf(error) ?? '') ?? null
}

// Why the code only: a door message may name a path.
function reportIntake(note: string, error: unknown): void {
  console.warn(`[dot-ingress] ${note}`, orchestrationCodeOf(error) ?? 'unexpected')
}

type RecordedIntakeDecision =
  | { readonly kind: 'settled'; readonly record: DotRequestRecord }
  | { readonly kind: 'admitted'; readonly admitted: AdmittedDotWorkspace }

/**
 * What a recorded request may do now. Accepted by the Workbench already: link it and show its real
 * state. Refused by the admission policy as it stands now: end it as failed, so it never starts.
 * Otherwise it is admitted for the door.
 */
function decideRecordedIntake(
  deps: DotIngressServiceDeps,
  handle: DotIntakeHandle
): RecordedIntakeDecision {
  const store = getDotIngressStore(deps.db)
  const accepted = findAcceptedWorkbenchRequestId(deps.db, handle.workbenchIdempotencyKey)
  if (accepted !== null) {
    const linked = store.linkSubmitted({
      dotRequestId: handle.dotRequestId,
      workbenchRequestId: accepted,
      timestamp: deps.now().toISOString()
    })
    return { kind: 'settled', record: linked.record }
  }
  try {
    const admitted = admitDotIntake(deps, {
      workspaceRef: handle.workspaceRef,
      requestedAccess: handle.requestedAccess,
      recorded: { workspaceId: handle.workspaceId, workspaceBinding: handle.workspaceBinding }
    })
    requireRecordedRequirement(handle.objective)
    return { kind: 'admitted', admitted }
  } catch (error) {
    const failure = intakeFailureOfRefusal(error)
    if (failure === null) {
      throw error
    }
    reportIntake(
      'A recorded request is refused by the dot admission policy and never starts:',
      error
    )
    const failed = store.markFailed({
      dotRequestId: handle.dotRequestId,
      failure,
      timestamp: deps.now().toISOString()
    })
    return { kind: 'settled', record: failed.record }
  }
}

/**
 * Re-runs the admission policy, then calls the door once for a recorded request and links the
 * result. The Workbench key is stable, so a repeat after a crash finds the same Workbench request.
 * A failure that may have created it leaves the row received for the next retry.
 */
export async function finishDotIntake(
  deps: DotIngressServiceDeps,
  handle: DotIntakeHandle
): Promise<DotRequestRecord> {
  const decision = decideRecordedIntake(deps, handle)
  if (decision.kind === 'settled') {
    return decision.record
  }
  const store = getDotIngressStore(deps.db)
  let workbenchRequestId: string
  try {
    const result = await deps.door.submit(dotIntakeTarget(deps.db, decision.admitted.workspace), {
      workspaceId: handle.workspaceId,
      objective: handle.objective,
      idempotencyKey: handle.workbenchIdempotencyKey,
      requestedAccess: handle.requestedAccess
    })
    workbenchRequestId = result.request.requestId
  } catch (error) {
    const failure = refusedBeforeCreation(error)
    if (failure) {
      return store.markFailed({
        dotRequestId: handle.dotRequestId,
        failure,
        timestamp: deps.now().toISOString()
      }).record
    }
    reportIntake('An intake was left unfinished; the next submit or app start retries it:', error)
    return store.get(handle.dotRequestId)
  }
  return store.linkSubmitted({
    dotRequestId: handle.dotRequestId,
    workbenchRequestId,
    timestamp: deps.now().toISOString()
  }).record
}

/** A refused replay also settles the request recorded under its key; it never starts one. */
function settleRefusedReplay(
  deps: DotIngressServiceDeps,
  idempotencyKey: string,
  refusal: unknown
): void {
  if (intakeFailureOfRefusal(refusal) === null) {
    return
  }
  const handle = findReceivedDotIntake(deps.db, idempotencyKey)
  if (handle) {
    decideRecordedIntake(deps, handle)
  }
}

/** Checks, records and hands a dot request to the door; a replay finishes the same intake. */
export async function submitDotRequest(
  deps: DotIngressServiceDeps,
  request: DotSubmitRequest
): Promise<DotSubmitOutcome> {
  let admitted: AdmittedDotWorkspace
  let scanRules: string[]
  try {
    requireDotInterfaceOn(deps.db)
    const analysis = analyzeDotRequirement({ objective: request.objective })
    scanRules = [...analysis.scanRules]
    admitted = admitDotIntake(deps, {
      workspaceRef: request.workspaceRef,
      requestedAccess: request.requestedAccess,
      recorded: null
    })
  } catch (error) {
    settleRefusedReplay(deps, request.idempotencyKey, error)
    throw error
  }
  const { record, duplicate, intake } = getDotIngressStore(deps.db).submit({
    workspaceRef: request.workspaceRef,
    workspaceBinding: admitted.binding,
    objective: request.objective,
    requestedAccess: request.requestedAccess,
    idempotencyKey: request.idempotencyKey,
    replyCorrelationId: request.reply?.correlationId ?? null,
    client: request.client ?? null,
    scanRules,
    timestamp: deps.now().toISOString()
  })
  return { record: intake ? await finishDotIntake(deps, intake) : record, duplicate }
}

/**
 * Startup: settles the requests a previous app session left unfinished, oldest first. Each is linked
 * when the Workbench accepted it, failed when the admission policy now refuses it, else submitted.
 */
export async function recoverDotIntake(
  deps: DotIngressServiceDeps
): Promise<{ submitted: number; failed: number; pending: number }> {
  const report = { submitted: 0, failed: 0, pending: 0 }
  for (const handle of getDotIngressStore(deps.db).listUnsubmitted(RECOVERY_BATCH)) {
    let record: DotRequestRecord
    try {
      record = await finishDotIntake(deps, handle)
    } catch (error) {
      // Why pending: the row stays received, so the next submit or app start retries it.
      reportIntake('A recorded request could not be recovered; it stays received:', error)
      report.pending += 1
      continue
    }
    if (record.state === 'submitted') {
      report.submitted += 1
    } else if (record.state === 'failed') {
      report.failed += 1
    } else {
      report.pending += 1
    }
  }
  return report
}
