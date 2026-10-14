/**
 * Which relay-era leases the bridge may serve.
 * COMPAT(legacy-relay-bridge): revisit 2027-01-15.
 */
import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import type { LegacyRelayBridgedPane } from '../../../shared/legacy-relay-bridge-contract'

/** How long an attach waits for an unreachable relay before answering `unverifiable`. */
export const ATTACH_WAIT_MS = 20_000
/** The one attach refusal backed by the relay's own liveness check (1.4.2xx relays). */
export const PROVEN_EXITED = /PTY ".+" not found \(process exited\)/i

/**
 * One a relay-era pane still names and nobody closed: a lease with a stop still pending, or one a
 * newer pane won, was meant to go away and is never brought back.
 */
export function isBridgeableLease(lease: SshRemotePtyLease): boolean {
  return (
    lease.state !== 'terminated' &&
    typeof lease.tabId === 'string' &&
    lease.tabId.length > 0 &&
    !lease.pendingKill &&
    !lease.supersededBy &&
    !lease.relayIdRecycled
  )
}

export function bridgeableLeasesByRelayId(
  leases: readonly SshRemotePtyLease[]
): Map<string, SshRemotePtyLease> {
  return new Map(leases.filter(isBridgeableLease).map((lease) => [lease.ptyId, lease]))
}

/** One leased pane the bridge tracks, and the relay endpoint that listed it. */
export type Pane = {
  lease: SshRemotePtyLease
  relayPtyId: string
  endpoint: string | null
  state: 'live' | 'unverifiable'
}

export function toBridgedPane(targetId: string, ptyId: string, pane: Pane): LegacyRelayBridgedPane {
  return {
    ptyId,
    targetId,
    tabId: pane.lease.tabId ?? '',
    ...(pane.lease.leafId ? { leafId: pane.lease.leafId } : {}),
    state: pane.state
  }
}
