/**
 * One SSH target's bridge: which leased relay-era panes an older relay still runs, and the
 * connections that carry their bytes until each terminal exits.
 * COMPAT(legacy-relay-bridge): revisit 2027-01-15.
 *
 * Verdicts follow docs/reference/ssh-execution-boundary.md. A pane is `live` while a relay lists
 * it and `unverifiable` while its relay can't be asked; it is retired only when the relay reports
 * its exit, or when every relay this target could have left was asked and none holds it.
 */
import { toAppSshPtyId } from '../../../shared/ssh-pty-id'
import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import type {
  LegacyRelayBridgeAttachResult,
  LegacyRelayBridgedPane
} from '../../../shared/legacy-relay-bridge-contract'
import type { LegacyRelayClient, LegacyRelayOwnerClaim } from './legacy-relay-client'
import type { LegacyRelayEndpoint, LegacyRelayEndpointListing } from './legacy-relay-endpoints'
import { LegacyRelayRetry, LegacyRelayWaiters } from './legacy-relay-bridge-timers'
import {
  ATTACH_WAIT_MS,
  bridgeableLeasesByRelayId,
  PROVEN_EXITED,
  toBridgedPane,
  type Pane
} from './legacy-relay-bridge-leases'

export type LegacyRelayTargetBridgeDeps = {
  targetId: string
  /** The target's non-terminated leases. */
  leases: () => SshRemotePtyLease[]
  retireLease: (relayPtyId: string) => void
  listEndpoints: (signal: AbortSignal) => Promise<LegacyRelayEndpointListing>
  openClient: (
    endpoint: LegacyRelayEndpoint,
    resume: LegacyRelayOwnerClaim | null
  ) => Promise<LegacyRelayClient>
  /** Only a dead socket proves its relay gone; anything else about a failed open is unverifiable. */
  endpointExited: (endpoint: LegacyRelayEndpoint) => Promise<boolean>
  onPanesChanged: () => void
  onData: (ptyId: string, data: string) => void
  onExit: (ptyId: string, code: number) => void
  onTerminalExited: () => void
}

type EndpointState = {
  endpoint: LegacyRelayEndpoint
  client: LegacyRelayClient | null
  claim: LegacyRelayOwnerClaim | null
}

export class LegacyRelayTargetBridge {
  private readonly endpoints = new Map<string, EndpointState>()
  private readonly panes = new Map<string, Pane>()
  private readonly attached = new Map<string, number>()
  private readonly waiters = new LegacyRelayWaiters()
  private readonly retry = new LegacyRelayRetry(() => void this.refresh())
  private refreshing: Promise<void> | null = null
  /** Set once a refresh has read the relays, so an attach never answers from an empty first look. */
  private looked = false
  /** Keeps the backoff growing while a listed terminal still refuses to attach. */
  private attachFailing = false
  private readonly abort = new AbortController()
  private disposed = false

  constructor(private readonly deps: LegacyRelayTargetBridgeDeps) {}

  get targetId(): string {
    return this.deps.targetId
  }

  livePaneCount(): number {
    return [...this.panes.values()].filter((pane) => pane.state === 'live').length
  }

  snapshot(): LegacyRelayBridgedPane[] {
    return [...this.panes].map(([ptyId, pane]) => toBridgedPane(this.deps.targetId, ptyId, pane))
  }

  /** Re-reads every relay; concurrent callers share one pass. */
  refresh(): Promise<void> {
    this.refreshing ??= this.runRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  async attach(ptyId: string): Promise<LegacyRelayBridgeAttachResult> {
    await (this.looked ? this.refreshing : this.refresh())
    let pane = this.panes.get(ptyId)
    if (pane?.state === 'unverifiable') {
      await this.waiters.waitUntil(
        () => this.disposed || this.panes.get(ptyId)?.state !== 'unverifiable',
        ATTACH_WAIT_MS
      )
      pane = this.panes.get(ptyId)
    }
    if (!pane) {
      const leased = [...bridgeableLeasesByRelayId(this.deps.leases()).keys()].some(
        (relayPtyId) => toAppSshPtyId(this.deps.targetId, relayPtyId) === ptyId
      )
      return leased ? { status: 'unverifiable' } : { status: 'exited' }
    }
    const client = pane.endpoint ? this.endpoints.get(pane.endpoint)?.client : null
    if (pane.state !== 'live' || !client) {
      return { status: 'unverifiable' }
    }
    // Why before the request: output that races the reply must reach the pane, not be dropped.
    this.attached.set(ptyId, (this.attached.get(ptyId) ?? 0) + 1)
    try {
      const { replay } = await client.attach(pane.relayPtyId)
      this.attachFailing = false
      return { status: 'attached', replay }
    } catch (error) {
      this.detach(ptyId)
      if (PROVEN_EXITED.test(error instanceof Error ? error.message : String(error))) {
        this.retire(ptyId, pane, null)
        return { status: 'exited' }
      }
      // An unmarked refusal also means "never minted here": the next listing decides, on backoff.
      pane.state = 'unverifiable'
      this.attachFailing = true
      this.deps.onPanesChanged()
      this.retry.schedule()
      return { status: 'unverifiable' }
    }
  }

  detach(ptyId: string): void {
    const count = (this.attached.get(ptyId) ?? 0) - 1
    if (count > 0) {
      this.attached.set(ptyId, count)
    } else {
      this.attached.delete(ptyId)
    }
  }

  write(ptyId: string, data: string): void {
    const route = this.liveRoute(ptyId)
    route?.client.write(route.relayPtyId, data)
  }

  resize(ptyId: string, cols: number, rows: number): void {
    const route = this.liveRoute(ptyId)
    route?.client.resize(route.relayPtyId, cols, rows)
  }

  /** Hangs up every bridge connection; the relays keep their terminals and their own grace. */
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.abort.abort()
    this.retry.cancel()
    this.closeIdleClients(new Set())
    this.panes.clear()
    this.attached.clear()
    this.waiters.wake()
    this.deps.onPanesChanged()
  }

  private async runRefresh(): Promise<void> {
    if (this.disposed) {
      return
    }
    this.looked = true
    const leases = bridgeableLeasesByRelayId(this.deps.leases())
    if (leases.size === 0) {
      this.closeIdleClients(new Set())
      this.replacePanes(new Map())
      return
    }
    // Every leased pane is published before the slow look, so a tab that mounts meanwhile waits on
    // its relay terminal rather than starting a second shell. Only proof of exit removes it.
    const seeded = new Map(this.panes)
    for (const [relayPtyId, lease] of leases) {
      const ptyId = toAppSshPtyId(this.deps.targetId, relayPtyId)
      if (!seeded.has(ptyId)) {
        seeded.set(ptyId, { lease, relayPtyId, endpoint: null, state: 'unverifiable' })
      }
    }
    if (seeded.size !== this.panes.size) {
      this.replacePanes(seeded)
    }
    const listing = await this.deps.listEndpoints(this.abort.signal)
    if (this.disposed) {
      return
    }
    const listedBy = new Map<string, string>()
    let complete = listing.kind === 'listed' && listing.exhaustive
    for (const endpoint of listing.kind === 'listed' ? listing.endpoints : []) {
      const listed = await this.listEndpoint(endpoint)
      if (this.disposed) {
        return
      }
      if (listed === null) {
        complete = false
        continue
      }
      for (const relayPtyId of listed) {
        listedBy.set(relayPtyId, endpoint.endpoint)
      }
    }
    const next = new Map<string, Pane>()
    for (const [relayPtyId, lease] of leases) {
      const ptyId = toAppSshPtyId(this.deps.targetId, relayPtyId)
      const endpoint = listedBy.get(relayPtyId)
      if (endpoint) {
        next.set(ptyId, { lease, relayPtyId, endpoint, state: 'live' })
      } else if (complete) {
        // Every relay this target could have left answered, and none holds it.
        const wasLive = this.panes.get(ptyId)?.endpoint
        this.deps.retireLease(relayPtyId)
        this.emitExit(ptyId, -1, Boolean(wasLive))
      } else {
        // Unreachable: loss of contact is never exit, so the pane waits.
        next.set(ptyId, { lease, relayPtyId, endpoint: null, state: 'unverifiable' })
      }
    }
    this.closeIdleClients(new Set([...next.values()].map((pane) => pane.endpoint ?? '')))
    this.replacePanes(next)
    if (!complete) {
      this.retry.schedule()
    } else if (!this.attachFailing) {
      this.retry.reset()
    }
  }

  /** The relay's PTY ids, an empty list for a relay proven gone, or null when it can't be asked. */
  private async listEndpoint(endpoint: LegacyRelayEndpoint): Promise<string[] | null> {
    const state = this.endpoints.get(endpoint.endpoint) ?? {
      endpoint,
      client: null,
      claim: null
    }
    this.endpoints.set(endpoint.endpoint, state)
    if (!state.client || state.client.closed) {
      state.client = null
      if (!endpoint.connectCommand) {
        return null
      }
      try {
        const client = await this.deps.openClient(endpoint, state.claim)
        if (this.disposed) {
          client.close()
          return null
        }
        this.wireClient(endpoint.endpoint, client)
        state.client = client
        state.claim = client.ownerClaim
      } catch {
        return (await this.deps.endpointExited(endpoint).catch(() => false)) ? [] : null
      }
    }
    try {
      return (await state.client.list()).map((row) => row.relayPtyId)
    } catch {
      return null
    }
  }

  private wireClient(endpoint: string, client: LegacyRelayClient): void {
    client.onData((relayPtyId, data) => {
      const ptyId = toAppSshPtyId(this.deps.targetId, relayPtyId)
      if (this.attached.has(ptyId)) {
        this.deps.onData(ptyId, data)
      }
    })
    client.onExit((relayPtyId, code) => {
      const ptyId = toAppSshPtyId(this.deps.targetId, relayPtyId)
      const pane = this.panes.get(ptyId)
      if (pane) {
        this.retire(ptyId, pane, code)
      }
    })
    client.onClose(() => {
      const state = this.endpoints.get(endpoint)
      if (this.disposed || state?.client !== client) {
        return
      }
      state.client = null
      let changed = false
      for (const pane of this.panes.values()) {
        if (pane.endpoint === endpoint) {
          pane.state = 'unverifiable'
          changed = true
        }
      }
      if (changed) {
        this.deps.onPanesChanged()
        this.waiters.wake()
        this.retry.schedule()
      }
    })
  }

  private retire(ptyId: string, pane: Pane, code: number | null): void {
    this.deps.retireLease(pane.relayPtyId)
    this.panes.delete(ptyId)
    this.emitExit(ptyId, code ?? -1)
    this.closeIdleClients(new Set([...this.panes.values()].map((entry) => entry.endpoint ?? '')))
    this.deps.onPanesChanged()
    this.waiters.wake()
  }

  /** Only a terminal this session saw running counts as a bridged exit in telemetry. */
  private emitExit(ptyId: string, code: number, counted = true): void {
    this.attached.delete(ptyId)
    this.deps.onExit(ptyId, code)
    if (counted) {
      this.deps.onTerminalExited()
    }
  }

  private liveRoute(ptyId: string): { client: LegacyRelayClient; relayPtyId: string } | null {
    const pane = this.panes.get(ptyId)
    const client = pane?.endpoint ? this.endpoints.get(pane.endpoint)?.client : null
    return pane?.state === 'live' && client ? { client, relayPtyId: pane.relayPtyId } : null
  }

  private replacePanes(next: Map<string, Pane>): void {
    this.panes.clear()
    for (const [ptyId, pane] of next) {
      this.panes.set(ptyId, pane)
    }
    this.deps.onPanesChanged()
    this.waiters.wake()
  }

  /** A relay no pane needs is hung up; a later refresh reopens it if one appears. */
  private closeIdleClients(needed: Set<string>): void {
    for (const [endpoint, state] of this.endpoints) {
      if (!needed.has(endpoint)) {
        state.client?.close()
        this.endpoints.delete(endpoint)
      }
    }
  }
}
