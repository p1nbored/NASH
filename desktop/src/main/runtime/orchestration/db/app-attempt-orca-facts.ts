import type Database from '../../../sqlite/sync-database'
import type { DispatchContextRow, MessageRow } from '../types'
import type { OrchestrationDb } from './orchestration-db'
import type { AttemptNotice } from './app-attempt-input'

// The facts and the mailbox message an attempt's settlement leaves for Orca's readers.

function nextSequence(db: Database.Database, dispatchId: string): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM attempt_observation_facts WHERE dispatch_id = ?'
    )
    .get(dispatchId)
  return Number(row?.next)
}

/** The executor said it is done: Orca reads that as finished but unverified until a validator decides. */
export function recordClaimFact(
  owner: OrchestrationDb,
  dispatch: DispatchContextRow,
  timestamp: string
): void {
  owner.recordAttemptObservation({
    id: `app_attempt_${dispatch.id}_claim`,
    dispatchId: dispatch.id,
    sequence: nextSequence(owner.db, dispatch.id),
    authorityId: `autopilot_runtime:${dispatch.run_id}`,
    authorityClock: 'home',
    facet: 'outcome',
    payload: { outcome: 'finished_unverified', reason: 'executor_claim_awaiting_validation' },
    homeReceivedAt: Date.parse(timestamp)
  })
}

/** The accepted report is the validator's verdict, or the executor's own failure; never a bare claim. */
export function recordReportFact(
  owner: OrchestrationDb,
  dispatch: DispatchContextRow,
  report: { outcome: 'succeeded' | 'failed'; reportId: string },
  timestamp: string
): void {
  owner.recordAttemptObservation({
    id: `app_attempt_${dispatch.id}_report`,
    dispatchId: dispatch.id,
    sequence: nextSequence(owner.db, dispatch.id),
    authorityId: `autopilot_runtime:${dispatch.run_id}`,
    authorityClock: 'home',
    facet: 'worker_report',
    payload: { status: 'accepted', outcome: report.outcome, reportId: report.reportId },
    homeReceivedAt: Date.parse(timestamp)
  })
}

/** Files one English status message in the run mailbox; the caller announces it after the commit. */
export function fileAttemptNotice(
  owner: OrchestrationDb,
  dispatch: DispatchContextRow,
  notice: AttemptNotice,
  outcome: { name: string; priority: 'normal' | 'high' }
): MessageRow {
  return owner.insertMessage({
    runId: dispatch.run_id,
    from: `dispatch:${dispatch.id}`,
    to: `run:${dispatch.run_id}`,
    subject: notice.subject,
    body: notice.body ?? '',
    type: 'status',
    priority: outcome.priority,
    payload: JSON.stringify({
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      outcome: outcome.name
    })
  })
}
