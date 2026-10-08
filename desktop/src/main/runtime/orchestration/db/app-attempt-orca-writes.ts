import type { DispatchContextRow, TaskRow } from '../types'
import { OrchestrationError } from '../orchestration-error'
import { transitionLifecycleWithDb } from './lifecycle-transition'
import type { OrchestrationDb } from './orchestration-db'
import type { LoadedAttempt } from './app-attempt-load'
import { APP_ATTEMPT_STAGES } from './app-attempt-stages'

// Orca's own lifecycle writes for an attempt the app runs. Every function runs inside the transaction
// its caller opened, so an attempt's Orca rows and its side rows move together or not at all.

function failureProjection(dispatch: DispatchContextRow, reason: string, timestamp: string) {
  return {
    last_failure: reason,
    failure_count: dispatch.failure_count + 1,
    completed_at: timestamp,
    capability_revoked_at: dispatch.capability_revoked_at ?? timestamp
  }
}

function transitionWorker(
  owner: OrchestrationDb,
  attempt: LoadedAttempt,
  to: string,
  projection: Record<string, string | null>
): void {
  transitionLifecycleWithDb(owner.db, {
    entity: 'worker',
    id: attempt.dispatch.id,
    from: attempt.worker.state,
    to,
    projection
  })
}

function requireTask(task: TaskRow | undefined): TaskRow {
  if (!task) {
    throw new OrchestrationError('autopilot_recovery_required', 'The task row disappeared.')
  }
  return task
}

export function readyWorkerInOrca(
  owner: OrchestrationDb,
  attempt: LoadedAttempt,
  timestamp: string
) {
  transitionLifecycleWithDb(owner.db, {
    entity: 'dispatch',
    id: attempt.dispatch.id,
    from: 'pending',
    to: 'dispatched'
  })
  transitionWorker(owner, attempt, 'ready', {
    stage: APP_ATTEMPT_STAGES.executorRunning,
    last_error: null,
    updated_at: timestamp
  })
}

export function failStartInOrca(
  owner: OrchestrationDb,
  attempt: LoadedAttempt,
  reason: string,
  timestamp: string
): void {
  transitionLifecycleWithDb(owner.db, {
    entity: 'dispatch',
    id: attempt.dispatch.id,
    from: 'pending',
    to: 'failed',
    projection: failureProjection(attempt.dispatch, reason, timestamp)
  })
  transitionWorker(owner, attempt, 'failed', {
    stage: APP_ATTEMPT_STAGES.startFailed,
    last_error: reason,
    updated_at: timestamp
  })
  requireTask(
    owner.updateTaskStatus(attempt.task.id, 'failed', `The attempt failed to start: ${reason}.`)
  )
}

/** The claim is on record and the task waits: blocked beside an open Dispatch, never completed. */
export function recordClaimInOrca(
  owner: OrchestrationDb,
  attempt: LoadedAttempt,
  timestamp: string
) {
  transitionWorker(owner, attempt, 'ready', {
    stage: APP_ATTEMPT_STAGES.validationPending,
    updated_at: timestamp
  })
  transitionLifecycleWithDb(owner.db, {
    entity: 'task',
    id: attempt.task.id,
    from: 'dispatched',
    to: 'blocked'
  })
}

export function markInconclusiveInOrca(
  owner: OrchestrationDb,
  attempt: LoadedAttempt,
  timestamp: string
): void {
  transitionWorker(owner, attempt, 'ready', {
    stage: APP_ATTEMPT_STAGES.validationInconclusive,
    updated_at: timestamp
  })
}

export function failAttemptInOrca(
  owner: OrchestrationDb,
  attempt: LoadedAttempt,
  params: { reason: string; stage: string; resultText: string; timestamp: string }
): void {
  transitionLifecycleWithDb(owner.db, {
    entity: 'dispatch',
    id: attempt.dispatch.id,
    from: attempt.dispatch.status,
    to: 'failed',
    projection: failureProjection(attempt.dispatch, params.reason, params.timestamp)
  })
  transitionWorker(owner, attempt, 'failed', {
    stage: params.stage,
    last_error: params.reason,
    updated_at: params.timestamp
  })
  requireTask(owner.updateTaskStatus(attempt.task.id, 'failed', params.resultText))
}

/** The one place a task of an app run is completed: Orca's own status update, which promotes dependents. */
export function completeAttemptInOrca(
  owner: OrchestrationDb,
  attempt: LoadedAttempt,
  params: { resultText: string; timestamp: string }
): void {
  transitionWorker(owner, attempt, 'succeeded', {
    stage: APP_ATTEMPT_STAGES.settled,
    updated_at: params.timestamp
  })
  transitionLifecycleWithDb(owner.db, {
    entity: 'dispatch',
    id: attempt.dispatch.id,
    from: attempt.dispatch.status,
    to: 'completed',
    projection: {
      completed_at: params.timestamp,
      capability_revoked_at: attempt.dispatch.capability_revoked_at ?? params.timestamp
    }
  })
  requireTask(owner.updateTaskStatus(attempt.task.id, 'completed', params.resultText))
}
