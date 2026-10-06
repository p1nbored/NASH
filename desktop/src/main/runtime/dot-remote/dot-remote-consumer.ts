import { DOT_REMOTE_MAX_ITEMS_PER_LEASE } from '../../../shared/dot-remote/dot-remote-limits'
import type { DotRemoteInboxItem } from '../../../shared/dot-remote/dot-remote-inbox'
import type { DotRemoteItemKind } from '../../../shared/dot-remote/dot-remote-payload'
import { checkLeasedItem } from './dot-remote-item-checks'
import { dispatchLeasedItem, type DotRemoteMessageOutcome } from './dot-remote-item-dispatch'
import type { DotRemoteItemJournal, DotRemoteItemOutcome } from './dot-remote-item-journal'
import type { DotRemoteLocalEndpoint } from './dot-remote-local-endpoint'
import { withLeaseRenewal } from './dot-remote-lease-renewal'
import {
  siteFailureOf,
  type DotRemoteSiteClient,
  type DotRemoteSiteCredentials,
  type DotRemoteSiteFailure
} from './dot-remote-site-client'
import type { DotRemoteLog, DotRemoteTimers } from './dot-remote-timers'

// RG5: the one active consumer. It leases a batch, then processes the items one at a time in lease
// order. Before each item it re-checks the remote switch and the pairing; each outcome is journaled
// before its ack, and side effects (request tracking, message outcome) follow only a recorded ack.

export type DotRemoteAckedItem = {
  item: { itemId: string; kind: DotRemoteItemKind; dependsOnItemId: string | null }
  outcome: DotRemoteItemOutcome
  messageOutcome: DotRemoteMessageOutcome | null
}

export type DotRemoteConsumerResult =
  | { kind: 'done'; items: number }
  | { kind: 'stopped' }
  | { kind: 'failure'; failure: DotRemoteSiteFailure }

export type DotRemoteBinding = { credentials: DotRemoteSiteCredentials; generation: number }

export type DotRemoteConsumerDeps = {
  readonly site: DotRemoteSiteClient
  readonly endpoint: DotRemoteLocalEndpoint
  readonly journal: DotRemoteItemJournal
  readonly now: () => number
  readonly timers: DotRemoteTimers
  readonly log: DotRemoteLog
  /** The remote switch is on and this generation is still the live pairing. */
  readonly isCurrent: (generation: number) => boolean
  readonly onAcked: (acked: DotRemoteAckedItem) => void
}

type ItemStep = 'acked' | 'skipped' | 'retry_later' | { failure: DotRemoteSiteFailure }

const ACK_LOSSES: ReadonlySet<string> = new Set(['lease_lost', 'ack_conflict'])

export function createDotRemoteConsumer(deps: DotRemoteConsumerDeps) {
  const iso = (): string => new Date(deps.now()).toISOString()

  async function ack(
    binding: DotRemoteBinding,
    item: DotRemoteInboxItem,
    outcome: DotRemoteItemOutcome,
    messageOutcome: DotRemoteMessageOutcome | null,
    signal: AbortSignal | undefined
  ): Promise<ItemStep> {
    const body = {
      itemId: item.itemId,
      leaseNonce: item.lease.leaseNonce,
      generation: binding.generation,
      payloadSha256: item.payloadSha256,
      ackedAt: iso(),
      ...outcome
    }
    const result = await deps.site.call('inbox.ack', body, {
      credentials: binding.credentials,
      itemId: item.itemId,
      signal
    })
    if (!result.ok) {
      if (result.kind === 'site_error' && ACK_LOSSES.has(result.code)) {
        // Why continue: the item returns with a new lease and is answered from the journal.
        deps.log({ event: 'dot_remote_ack_lost', code: result.code, itemId: item.itemId })
        return 'skipped'
      }
      return { failure: siteFailureOf(result) }
    }
    deps.journal.markAcked(item.itemId, iso())
    const { itemId, kind, dependsOnItemId } = item
    deps.onAcked({ item: { itemId, kind, dependsOnItemId }, outcome, messageOutcome })
    return 'acked'
  }

  function journal(
    binding: DotRemoteBinding,
    item: DotRemoteInboxItem,
    outcome: DotRemoteItemOutcome
  ) {
    deps.journal.record({
      itemId: item.itemId,
      kind: item.kind,
      payloadSha256: item.payloadSha256,
      generation: binding.generation,
      outcome,
      dotRequestId: 'dotRequestId' in outcome ? outcome.dotRequestId : null,
      timestamp: iso()
    })
  }

  async function processItem(
    binding: DotRemoteBinding,
    raw: unknown,
    signal: AbortSignal | undefined
  ): Promise<ItemStep> {
    const check = checkLeasedItem(raw, {
      generation: binding.generation,
      now: deps.now(),
      journalEntry: (itemId) => deps.journal.get(itemId)
    })
    if (check.kind === 'skip') {
      deps.log({ event: 'dot_remote_item_skipped', code: check.reason })
      return 'skipped'
    }
    if (check.kind === 'answer') {
      if (!check.journaled) {
        journal(binding, check.item, check.outcome)
      }
      return ack(binding, check.item, check.outcome, null, signal)
    }
    const dispatch = await withLeaseRenewal(
      { site: deps.site, timers: deps.timers, now: deps.now, log: deps.log },
      { item: check.item, binding, signal },
      () =>
        dispatchLeasedItem(check.item, {
          endpoint: deps.endpoint,
          requestOfItem: (itemId) => deps.journal.requestOfItem(itemId)
        })
    )
    if (dispatch.kind === 'retry_later') {
      deps.log({
        event: 'dot_remote_dispatch_deferred',
        code: dispatch.code,
        itemId: check.item.itemId
      })
      return 'retry_later'
    }
    journal(binding, check.item, dispatch.outcome)
    return ack(binding, check.item, dispatch.outcome, dispatch.messageOutcome, signal)
  }

  /** One lease and its items, sequentially; returns how many items were acked. */
  async function run(
    binding: DotRemoteBinding,
    signal?: AbortSignal
  ): Promise<DotRemoteConsumerResult> {
    if (!deps.endpoint.ready()) {
      return { kind: 'done', items: 0 }
    }
    const lease = await deps.site.call(
      'inbox.lease',
      { generation: binding.generation, maxItems: DOT_REMOTE_MAX_ITEMS_PER_LEASE },
      { credentials: binding.credentials, signal }
    )
    if (!lease.ok) {
      return { kind: 'failure', failure: siteFailureOf(lease) }
    }
    if (lease.value.generation !== binding.generation) {
      return { kind: 'failure', failure: { kind: 'site_error', code: 'generation_revoked' } }
    }
    let ackedItems = 0
    for (const raw of lease.value.items) {
      if (signal?.aborted || !deps.isCurrent(binding.generation)) {
        return { kind: 'stopped' }
      }
      const step = await processItem(binding, raw, signal)
      if (step === 'retry_later') {
        // Why stop: a later item may depend on this one (a cancel after its submit).
        break
      }
      if (typeof step === 'object') {
        return { kind: 'failure', failure: step.failure }
      }
      ackedItems += step === 'acked' ? 1 : 0
    }
    return { kind: 'done', items: ackedItems }
  }

  return { run }
}

export type DotRemoteConsumer = ReturnType<typeof createDotRemoteConsumer>
