import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { WORKFLOW_RUN_STATUSES } from './autopilot-run-schema-definition'
import { ReasonCodeSchema, changedRowCount } from './autopilot-store-input'

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]

export const WORKFLOW_RUN_TERMINAL_STATUSES = Object.freeze([
  'completed',
  'failed',
  'canceled'
] as const)

function edges(...to: WorkflowRunStatus[]): readonly WorkflowRunStatus[] {
  return Object.freeze(to)
}

// Why: completed is reachable only through completing, so the primary must declare the run done;
// nothing returns to launching, so a run is never relaunched; terminal statuses have no way out.
export const WORKFLOW_RUN_TRANSITIONS: Readonly<
  Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>
> = Object.freeze({
  launching: edges('active', 'failed', 'canceled', 'unverifiable'),
  active: edges('completing', 'failed', 'canceled', 'unverifiable'),
  completing: edges('completed', 'active', 'failed', 'canceled', 'unverifiable'),
  completed: edges(),
  failed: edges(),
  canceled: edges(),
  unverifiable: edges('active', 'failed', 'canceled')
})

const STATUSES_WITH_REASON: ReadonlySet<WorkflowRunStatus> = new Set([
  'failed',
  'canceled',
  'unverifiable'
])
const TERMINAL: ReadonlySet<WorkflowRunStatus> = new Set(WORKFLOW_RUN_TERMINAL_STATUSES)

export function isWorkflowRunTransitionAllowed(
  from: WorkflowRunStatus,
  to: WorkflowRunStatus
): boolean {
  return WORKFLOW_RUN_TRANSITIONS[from].includes(to)
}

export type WorkflowRunTransition = {
  runId: string
  from: WorkflowRunStatus
  to: WorkflowRunStatus
  expectedRevision: number
  /** A reason code for failed, canceled and unverifiable; null for every other target. */
  reason: string | null
  timestamp: string
}

function invalidReason(to: WorkflowRunStatus): OrchestrationError {
  return new OrchestrationError(
    'autopilot_invalid_reason',
    STATUSES_WITH_REASON.has(to)
      ? `A run moving to ${to} needs a reason code.`
      : `A run moving to ${to} takes no reason.`
  )
}

/** One revision-fenced UPDATE; returns the new revision. The caller's stated status must still hold. */
export function transitionWorkflowRun(
  db: Database.Database,
  transition: WorkflowRunTransition
): number {
  const { runId, from, to, expectedRevision, reason, timestamp } = transition
  if (!isWorkflowRunTransitionAllowed(from, to)) {
    throw new OrchestrationError(
      'autopilot_invalid_transition',
      `Run cannot move from ${from} to ${to}.`
    )
  }
  const reasonFits = STATUSES_WITH_REASON.has(to)
    ? reason !== null && ReasonCodeSchema.safeParse(reason).success
    : reason === null
  if (!reasonFits) {
    throw invalidReason(to)
  }
  const result = db
    .prepare(
      `UPDATE workflow_runs SET status = ?, revision = revision + 1, updated_at = ?, end_reason = ?, ended_at = ?
        WHERE run_id = ? AND status = ? AND revision = ?`
    )
    .run(to, timestamp, reason, TERMINAL.has(to) ? timestamp : null, runId, from, expectedRevision)
  if (changedRowCount(result) !== 1) {
    throw new OrchestrationError(
      'autopilot_run_conflict',
      'The run changed or does not exist. Nothing was written.'
    )
  }
  return expectedRevision + 1
}
