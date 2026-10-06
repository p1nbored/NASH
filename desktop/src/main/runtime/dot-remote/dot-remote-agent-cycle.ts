import { DOT_REMOTE_RETENTION_DAYS } from '../../../shared/dot-remote/dot-remote-defaults'
import {
  DOT_REMOTE_POLL_ACTIVE_SECONDS,
  DOT_REMOTE_POLL_IDLE_SECONDS
} from '../../../shared/dot-remote/dot-remote-limits'
import type { DotRemoteAgentDeps } from './dot-remote-agent'
import type { DotRemoteSessionHolder } from './dot-remote-agent-session'
import { createDotRemoteConsumer, type DotRemoteAckedItem } from './dot-remote-consumer'
import { createDotRemoteEventSync } from './dot-remote-event-sync'
import { failureAction } from './dot-remote-failure'
import { getDotRemoteItemJournal } from './dot-remote-item-journal'
import { createDotRemoteOutboxFlush } from './dot-remote-outbox-flush'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { createDotRemotePresence } from './dot-remote-presence'
import { getDotRemoteRequestStore } from './dot-remote-request-store'
import { getDotRemoteSettingsStore } from './dot-remote-settings-store'
import type { DotRemoteSiteClient, DotRemoteSiteFailure } from './dot-remote-site-client'

// One poll of a paired agent, in a fixed order: renew the session when due, heartbeat and workspace
// list, lease and process items, record events from the local readers, flush the outbox. The first
// failure ends the poll and decides what happens next; no step falls back to another channel.

const ACTIVE_MS = DOT_REMOTE_POLL_ACTIVE_SECONDS * 1000
const IDLE_MS = DOT_REMOTE_POLL_IDLE_SECONDS * 1000
const PURGE_EVERY_MS = 60 * 60_000
const PURGE_BATCH = 500
const RETENTION_MS = DOT_REMOTE_RETENTION_DAYS * 24 * 60 * 60_000

export type DotRemoteCycleDeps = DotRemoteAgentDeps & {
  readonly site: DotRemoteSiteClient
  readonly sessions: DotRemoteSessionHolder
  readonly isCurrent: (generation: number) => boolean
}

export function createDotRemoteCycle(deps: DotRemoteCycleDeps) {
  const { sessions } = deps
  const settings = getDotRemoteSettingsStore(deps.owner)
  const requests = getDotRemoteRequestStore(deps.owner)
  const journal = getDotRemoteItemJournal(deps.owner)
  const iso = (): string => new Date(deps.now()).toISOString()
  const eventSync = createDotRemoteEventSync({
    owner: deps.owner,
    source: deps.source,
    now: deps.now,
    newEventId: deps.newId,
    log: deps.log
  })
  const flusher = createDotRemoteOutboxFlush({
    owner: deps.owner,
    site: deps.site,
    now: deps.now,
    log: deps.log
  })
  const presence = createDotRemotePresence({
    now: deps.now,
    appVersion: deps.appVersion,
    listWorkspaces: deps.listWorkspaces
  })
  let busy = false
  let lastPurgeAt = 0

  function onAcked({ item, outcome, messageOutcome }: DotRemoteAckedItem): void {
    const generation = sessions.generation()
    const admitted = outcome.outcome === 'accepted' || outcome.outcome === 'duplicate'
    if (item.kind === 'submit' && admitted && generation !== null) {
      requests.track({
        dotRequestId: outcome.dotRequestId,
        submitItemId: item.itemId,
        generation,
        timestamp: iso()
      })
    }
    if (messageOutcome && admitted) {
      eventSync.noteMessageOutcome(outcome.dotRequestId, messageOutcome)
    }
  }

  const consumer = createDotRemoteConsumer({
    site: deps.site,
    endpoint: deps.endpoint,
    journal,
    now: deps.now,
    timers: deps.timers,
    log: deps.log,
    isCurrent: deps.isCurrent,
    onAcked
  })

  /** Returns the delay of the next poll, or null when polling must stop. */
  function settle(failure: DotRemoteSiteFailure): number | null {
    const action = failureAction(failure)
    deps.log({ event: 'dot_remote_poll_failed', code: action.action })
    switch (action.action) {
      case 'pair_again':
        sessions.fence(action.reason)
        return null
      case 'reconnect':
        sessions.requireReconnect(action.reason)
        return null
      case 'session_lost':
        // Why at once: the next poll refreshes the session with the device credential.
        sessions.sessionLost()
        return sessions.reconnectReason() === null ? 0 : null
      case 'retry':
        sessions.setOffline(true)
        return busy ? ACTIVE_MS : IDLE_MS
      case 'ignore':
        return null
    }
  }

  function purgeIfDue(): void {
    if (deps.now() - lastPurgeAt < PURGE_EVERY_MS) {
      return
    }
    lastPurgeAt = deps.now()
    const before = new Date(deps.now() - RETENTION_MS).toISOString()
    getDotRemoteOutboxStore(deps.owner).purgeSettledBefore(before, PURGE_BATCH)
    journal.purgeBefore(before, PURGE_BATCH)
  }

  async function run(signal: AbortSignal): Promise<{ nextDelayMs: number | null }> {
    const renewal = await sessions.renewIfDue(signal)
    const binding = renewal ? null : sessions.binding()
    if (renewal || !binding) {
      return { nextDelayMs: renewal ? settle(renewal) : null }
    }
    const presenceFailure = await presence.sync(deps.site, binding, signal)
    if (presenceFailure) {
      return { nextDelayMs: settle(presenceFailure) }
    }
    const consumed = await consumer.run(binding, signal)
    if (consumed.kind === 'failure') {
      return { nextDelayMs: settle(consumed.failure) }
    }
    if (consumed.kind === 'stopped') {
      return { nextDelayMs: null }
    }
    busy = eventSync.run().busy
    const flushed = await flusher.flush(binding, signal)
    if (flushed.kind === 'failure') {
      return { nextDelayMs: settle(flushed.failure) }
    }
    sessions.markHealthy()
    settings.recordSync(iso())
    purgeIfDue()
    return { nextDelayMs: busy ? ACTIVE_MS : IDLE_MS }
  }

  return {
    run,
    /** A new pairing: the heartbeat and the workspace list go out on the next poll. */
    reset: () => presence.reset(),
    async finalFlush(): Promise<void> {
      const binding = sessions.binding()
      if (binding) {
        await flusher.flush(binding, undefined, { final: true })
      }
    }
  }
}
