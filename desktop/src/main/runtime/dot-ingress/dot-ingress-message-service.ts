import { DOT_INGRESS_RATE_WINDOW_MS } from '../../../shared/dot-ingress/dot-ingress-limits'
import {
  DOT_MESSAGE_REASONS,
  type DotMessageOutcome,
  type DotMessageReason
} from '../../../shared/dot-ingress/dot-ingress-message'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getRunMessageStore } from '../orchestration/db/run-message-store'
import type { DotIngressServiceDeps, DotRunMessenger } from './dot-ingress-ports'
import { dotRefusal, orchestrationCodeOf, requireDotInterfaceOn } from './dot-ingress-refusals'
import { findDotRequestRun, hasAppTable } from './dot-ingress-run-link'

// D-019: dot sends a follow-up message to the run its own request started, never to a run it names.
// It passes the same checks as a new task: the ingress caller, the user's caps, and the text checks
// of the run message path (secret scan, English, length), which also stores it with the run.

export type DotMessageDelivery = {
  outcome: DotMessageOutcome
  reason: DotMessageReason | null
  duplicate: boolean
}

function isDotMessageReason(value: string): value is DotMessageReason {
  return DOT_MESSAGE_REASONS.some((reason) => reason === value)
}

/** The run message path's codes are reported as they are when the contract names them, else as `other`. */
function coarseReason(reason: string | null): DotMessageReason | null {
  if (reason === null) {
    return null
  }
  return isDotMessageReason(reason) ? reason : 'other'
}

function refusedWith(reason: DotMessageReason): DotMessageDelivery {
  return { outcome: 'refused', reason, duplicate: false }
}

/** The submission caps the user set, counted separately over the messages dot sent. */
function requireWithinCaps(db: OrchestrationDb, now: Date): void {
  if (!hasAppTable(db, 'run_messages')) {
    return
  }
  const { ratePerMinute, ratePerUtcDay } = getDotIngressSettingsStore(db).getSettings()
  const countSince = (comparison: '>' | '>=', since: string): number =>
    Number(
      db.db
        .prepare(
          `SELECT count(*) AS n FROM run_messages WHERE source = 'dot' AND created_at ${comparison} ?`
        )
        .get(since)?.n
    )
  const minuteStart = new Date(now.getTime() - DOT_INGRESS_RATE_WINDOW_MS).toISOString()
  if (countSince('>', minuteStart) >= ratePerMinute) {
    throw dotRefusal('dot_rate_limited', { window: 'minute' })
  }
  if (countSince('>=', `${now.toISOString().slice(0, 10)}T00:00:00.000Z`) >= ratePerUtcDay) {
    throw dotRefusal('dot_rate_limited', { window: 'utc_day' })
  }
}

function messengerOrNull(deps: DotIngressServiceDeps): DotRunMessenger | null {
  try {
    return deps.messenger()
  } catch (error) {
    if (orchestrationCodeOf(error) === 'autopilot_primary_session_not_configured') {
      return null
    }
    throw error
  }
}

/** Delivers, queues or refuses one message; the message id makes a repeat return the first outcome. */
export async function sendDotMessage(
  deps: DotIngressServiceDeps,
  input: { dotRequestId: string; messageId: string; text: string }
): Promise<DotMessageDelivery> {
  requireDotInterfaceOn(deps.db)
  const record = getDotIngressStore(deps.db).get(input.dotRequestId)
  if (record.state === 'received') {
    return refusedWith('run_not_started')
  }
  if (record.state !== 'submitted') {
    return refusedWith('run_not_active')
  }
  const run = findDotRequestRun(deps.db, record)
  if (!run) {
    return refusedWith('run_not_started')
  }
  const replay =
    hasAppTable(deps.db, 'run_messages') &&
    getRunMessageStore(deps.db).findBySource('dot', input.messageId) !== null
  if (!replay) {
    requireWithinCaps(deps.db, deps.now())
  }
  const messenger = messengerOrNull(deps)
  if (!messenger) {
    return refusedWith('primary_not_live')
  }
  const delivered = await messenger.deliverRunMessage({
    runId: run.runId,
    source: 'dot',
    sourceRequestId: input.messageId,
    text: input.text
  })
  if (delivered.messageId === null && delivered.reason === 'request_id_reused') {
    throw dotRefusal('dot_idempotency_conflict')
  }
  return {
    outcome: delivered.outcome,
    reason: coarseReason(delivered.reason),
    duplicate: delivered.duplicate
  }
}
