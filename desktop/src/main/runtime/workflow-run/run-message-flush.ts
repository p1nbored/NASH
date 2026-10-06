import type { OrchestrationDb } from '../orchestration/db'
import { getRunMessageStore, type RunMessageRecord } from '../orchestration/db/run-message-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { clockTimestamp } from './primary-session-ports'
import type { PrimaryAgentActivity } from './primary-session-status'
import type { RunMessageSendResult } from './run-message-sender'

/** The primary as delivery sees it: typeable, worth waiting for (unverifiable), or gone. */
export type LivePrimaryRead =
  | { readonly kind: 'live'; readonly handle: string; readonly activity: PrimaryAgentActivity }
  | { readonly kind: 'wait' }
  | { readonly kind: 'gone' }

export type RunMessageFlushContext = {
  readonly db: OrchestrationDb
  readonly clock: { now(): number }
  /** How many held messages one flush reads; the rest wait for the next pass. */
  readonly heldLimit: number
  readLivePrimary(runId: string): Promise<LivePrimaryRead>
  send(handle: string, text: string): Promise<RunMessageSendResult>
  /** Arms the run's flush timer, at most one per run. */
  arm(runId: string): void
  cancel(runId: string): void
}

/** Records what one terminal write did; a message that may sit in the composer is never retyped. */
export function settleRunMessageSend(
  context: RunMessageFlushContext,
  record: RunMessageRecord,
  sent: RunMessageSendResult,
  activity: PrimaryAgentActivity
): RunMessageRecord {
  const messages = getRunMessageStore(context.db)
  const timestamp = clockTimestamp(context.clock)
  switch (sent.kind) {
    case 'sent': {
      const idle = activity === 'idle'
      return messages.settle(record.messageId, {
        to: 'delivered',
        firstOutcome: idle ? 'delivered' : 'queued',
        reason: idle ? null : 'agent_busy',
        timestamp
      })
    }
    case 'dialog_blocked':
      context.arm(record.runId)
      return record.state === 'held'
        ? record
        : messages.settle(record.messageId, {
            to: 'held',
            firstOutcome: 'queued',
            reason: 'dialog_open',
            timestamp
          })
    case 'not_written':
    case 'incomplete':
      return messages.settle(record.messageId, {
        to: 'refused',
        firstOutcome: 'refused',
        reason: sent.kind === 'incomplete' ? 'delivery_incomplete' : 'terminal_unavailable',
        timestamp
      })
  }
}

function refuseAll(
  context: RunMessageFlushContext,
  held: readonly RunMessageRecord[],
  reason: string
): void {
  const messages = getRunMessageStore(context.db)
  const timestamp = clockTimestamp(context.clock)
  for (const record of held) {
    messages.settle(record.messageId, { to: 'refused', firstOutcome: 'refused', reason, timestamp })
  }
}

/**
 * Delivers a run's held messages oldest first. A dialog stops the flush and the timer retries; a run
 * that is no longer active or a primary that is gone refuses them; an unverifiable pane is waited for.
 * D-027: a held message waits as long as the dialog stays open; nothing expires.
 */
export async function flushHeldRunMessages(
  context: RunMessageFlushContext,
  runId: string
): Promise<void> {
  const messages = getRunMessageStore(context.db)
  const held = messages.listHeld(runId, context.heldLimit)
  if (held.length === 0) {
    context.cancel(runId)
    return
  }
  const run = getWorkflowRunStore(context.db).get(runId)
  if (run?.status !== 'active') {
    refuseAll(context, held, 'run_not_active')
    context.cancel(runId)
    return
  }
  const primary = await context.readLivePrimary(runId)
  if (primary.kind === 'gone') {
    refuseAll(context, held, 'primary_not_live')
    context.cancel(runId)
    return
  }
  if (primary.kind === 'wait' || primary.activity === 'dialog_open') {
    context.arm(runId)
    return
  }
  let activity = primary.activity
  for (const record of held) {
    const sent = await context.send(primary.handle, record.text ?? '')
    settleRunMessageSend(context, record, sent, activity)
    if (sent.kind === 'dialog_blocked' || sent.kind === 'incomplete') {
      context.arm(runId)
      return
    }
    // The agent is busy with the message just typed, so the next one queues behind it.
    activity = 'working'
  }
  if (messages.countHeld(runId) === 0) {
    context.cancel(runId)
  } else {
    context.arm(runId)
  }
}
