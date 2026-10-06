import { DOT_REMOTE_EVENT_BATCH_MAX } from '../../../shared/dot-remote/dot-remote-limits'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { DotRemoteBinding } from './dot-remote-consumer'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import {
  siteFailureOf,
  type DotRemoteSiteClient,
  type DotRemoteSiteFailure
} from './dot-remote-site-client'
import type { DotRemoteLog } from './dot-remote-timers'

// Sends the persisted events of the live generation in recorded order, at most one batch size at a
// time. A failed send keeps every event pending and backs off exponentially; the Site's cursors
// bring back what a restored Site no longer holds.

export const DOT_REMOTE_FLUSH_BACKOFF_BASE_MS = 5_000
export const DOT_REMOTE_FLUSH_BACKOFF_MAX_MS = 300_000
/** One flush sends at most this many batches, so a long backlog never holds the poll loop. */
const MAX_BATCHES_PER_FLUSH = 10

export type DotRemoteFlushResult =
  | { kind: 'idle' }
  | { kind: 'sent'; events: number }
  | { kind: 'backoff' }
  | { kind: 'failure'; failure: DotRemoteSiteFailure }

export type DotRemoteOutboxFlushDeps = {
  readonly owner: OrchestrationDb
  readonly site: DotRemoteSiteClient
  readonly now: () => number
  readonly log: DotRemoteLog
}

export function createDotRemoteOutboxFlush(deps: DotRemoteOutboxFlushDeps) {
  const outbox = getDotRemoteOutboxStore(deps.owner)
  const iso = (): string => new Date(deps.now()).toISOString()
  let failures = 0
  let retryAt = 0

  function backOff(): void {
    failures += 1
    const delay = Math.min(
      DOT_REMOTE_FLUSH_BACKOFF_MAX_MS,
      DOT_REMOTE_FLUSH_BACKOFF_BASE_MS * 2 ** (failures - 1)
    )
    retryAt = deps.now() + delay
  }

  async function sendBatch(
    binding: DotRemoteBinding,
    signal: AbortSignal | undefined
  ): Promise<{ sent: number; requeued: number } | DotRemoteSiteFailure> {
    const events = outbox.pending(binding.generation, DOT_REMOTE_EVENT_BATCH_MAX)
    if (events.length === 0) {
      return { sent: 0, requeued: 0 }
    }
    outbox.recordAttempt(
      events.map((event) => event.eventId),
      iso()
    )
    const answer = await deps.site.call(
      'events.post',
      { generation: binding.generation, events },
      { credentials: binding.credentials, signal }
    )
    if (!answer.ok) {
      return siteFailureOf(answer)
    }
    outbox.markResults(answer.value.results, iso())
    for (const result of answer.value.results) {
      if (result.status === 'conflict' || result.status === 'unknown_request') {
        deps.log({
          event: 'dot_remote_event_rejected',
          code: result.status,
          eventId: result.eventId
        })
      }
    }
    let requeued = 0
    for (const cursor of answer.value.cursors) {
      requeued += outbox.requeueAbove(cursor.dotRequestId, cursor.appliedRevision, iso())
    }
    return { sent: events.length, requeued }
  }

  /** A final flush (will-quit) sends even inside a backoff window: it is the last chance before exit. */
  async function flush(
    binding: DotRemoteBinding,
    signal?: AbortSignal,
    options: { final?: boolean } = {}
  ): Promise<DotRemoteFlushResult> {
    if (!options.final && deps.now() < retryAt) {
      return { kind: 'backoff' }
    }
    let sent = 0
    for (let batch = 0; batch < MAX_BATCHES_PER_FLUSH; batch += 1) {
      const outcome = await sendBatch(binding, signal)
      if ('kind' in outcome) {
        // Why: an abort is the agent's own stop (switch off, quit), not a Site that failed.
        if (!(outcome.kind === 'unavailable' && outcome.reason === 'aborted')) {
          backOff()
        }
        return { kind: 'failure', failure: outcome }
      }
      sent += outcome.sent
      // Why stop on a requeue: what a restored Site lost is sent on the next flush, not in a loop.
      if (outcome.sent === 0 || outcome.requeued > 0) {
        break
      }
    }
    failures = 0
    retryAt = 0
    return sent === 0 ? { kind: 'idle' } : { kind: 'sent', events: sent }
  }

  return { flush }
}

export type DotRemoteOutboxFlush = ReturnType<typeof createDotRemoteOutboxFlush>
