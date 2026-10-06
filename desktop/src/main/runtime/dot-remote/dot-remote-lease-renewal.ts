import type { DotRemoteInboxItem } from '../../../shared/dot-remote/dot-remote-inbox'
import { dotRemoteErrorCode } from './dot-remote-error-code'
import type { DotRemoteSiteClient, DotRemoteSiteCredentials } from './dot-remote-site-client'
import type { DotRemoteLog, DotRemoteTimerHandle, DotRemoteTimers } from './dot-remote-timers'

// A dispatch may outlast the 60 s lease (a submit can wait for a run to start). While it runs, the
// lease is renewed shortly before it ends, with its own nonce and the pairing generation.

/** Renew this long before the lease ends, so a slow round trip still lands in time. */
export const DOT_REMOTE_LEASE_RENEW_MARGIN_MS = 20_000
const MIN_RENEW_DELAY_MS = 1_000

type RenewalDeps = {
  readonly site: DotRemoteSiteClient
  readonly timers: DotRemoteTimers
  readonly now: () => number
  readonly log: DotRemoteLog
}

type RenewalTarget = {
  readonly item: DotRemoteInboxItem
  readonly binding: { credentials: DotRemoteSiteCredentials; generation: number }
  readonly signal?: AbortSignal
}

export async function withLeaseRenewal<T>(
  deps: RenewalDeps,
  target: RenewalTarget,
  task: () => Promise<T>
): Promise<T> {
  const { item, binding, signal } = target
  // Why a holder: the handle is replaced from inside the timer callback.
  const pending: { handle: DotRemoteTimerHandle | null } = { handle: null }
  let settled = false

  function scheduleBefore(leaseExpiresAt: string): void {
    const delay = Math.max(
      MIN_RENEW_DELAY_MS,
      Date.parse(leaseExpiresAt) - deps.now() - DOT_REMOTE_LEASE_RENEW_MARGIN_MS
    )
    pending.handle = deps.timers.schedule(() => void renew().catch(reportThrow), delay)
  }

  // Why no retry either: a lost lease returns the item to the Site, and the journal answers it again.
  function reportThrow(error: unknown): void {
    const code = dotRemoteErrorCode(error)
    deps.log({ event: 'dot_remote_lease_renew_failed', code, itemId: item.itemId })
  }

  async function renew(): Promise<void> {
    pending.handle = null
    if (settled) {
      return
    }
    const result = await deps.site.call(
      'inbox.renew',
      { itemId: item.itemId, leaseNonce: item.lease.leaseNonce, generation: binding.generation },
      { credentials: binding.credentials, itemId: item.itemId, signal }
    )
    if (!result.ok) {
      // Why no retry: a lost lease returns the item to the Site, and the journal answers it again.
      deps.log({ event: 'dot_remote_lease_renew_failed', code: result.kind, itemId: item.itemId })
      return
    }
    if (!settled) {
      scheduleBefore(result.value.leaseExpiresAt)
    }
  }

  scheduleBefore(item.lease.leaseExpiresAt)
  try {
    return await task()
  } finally {
    settled = true
    pending.handle?.cancel()
  }
}
