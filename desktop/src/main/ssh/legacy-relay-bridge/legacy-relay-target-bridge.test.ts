import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toAppSshPtyId } from '../../../shared/ssh-pty-id'
import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import { getRemoteHostPlatform } from '../ssh-remote-platform'
import type { LegacyRelayClient } from './legacy-relay-client'
import type { LegacyRelayEndpoint, LegacyRelayEndpointListing } from './legacy-relay-endpoints'
import {
  LegacyRelayTargetBridge,
  type LegacyRelayTargetBridgeDeps
} from './legacy-relay-target-bridge'

const TARGET = 'ssh-box'
const PTY = toAppSshPtyId(TARGET, 'pty-1')

type FakeRelay = {
  ptys: Set<string>
  attachError: Error | null
  clients: FakeClient[]
  openError: Error | null
}

type FakeClient = LegacyRelayClient & {
  emitData: (id: string, data: string) => void
  emitExit: (id: string, code: number) => void
  drop: () => void
  writes: string[]
}

function fakeClient(relay: FakeRelay): FakeClient {
  const data = new Set<(id: string, data: string) => void>()
  const exits = new Set<(id: string, code: number) => void>()
  const closes = new Set<() => void>()
  let closed = false
  const writes: string[] = []
  const close = (): void => {
    if (!closed) {
      closed = true
      closes.forEach((listener) => listener())
    }
  }
  const client = {
    ownerClaim: { ownerGeneration: 1, ownerLease: 'lease' },
    get closed() {
      return closed
    },
    list: async () => [...relay.ptys].map((relayPtyId) => ({ relayPtyId })),
    attach: async () => {
      if (relay.attachError) {
        throw relay.attachError
      }
      return { replay: 'SCREEN' }
    },
    write: (_id: string, chunk: string) => writes.push(chunk),
    resize: () => {},
    onData: (listener: (id: string, data: string) => void) => {
      data.add(listener)
      return () => data.delete(listener)
    },
    onExit: (listener: (id: string, code: number) => void) => {
      exits.add(listener)
      return () => exits.delete(listener)
    },
    onClose: (listener: () => void) => {
      closes.add(listener)
      return () => closes.delete(listener)
    },
    close,
    emitData: (id: string, chunk: string) => data.forEach((listener) => listener(id, chunk)),
    emitExit: (id: string, code: number) => exits.forEach((listener) => listener(id, code)),
    drop: close,
    writes
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the bridge reads only the members this fake implements.
  return client as unknown as FakeClient
}

const ENDPOINT: LegacyRelayEndpoint = {
  endpoint: '/home/me/.orca-remote/relay-0.1.0+abc/relay-x.sock',
  connectCommand: 'cd x && node relay.js --connect',
  wrapCommand: true,
  host: getRemoteHostPlatform('linux-x64'),
  nodePath: 'node'
}

function lease(overrides: Partial<SshRemotePtyLease> = {}): SshRemotePtyLease {
  return {
    targetId: TARGET,
    ptyId: 'pty-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    state: 'detached',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

let relay: FakeRelay
let leases: SshRemotePtyLease[]
let listing: LegacyRelayEndpointListing
let endpointExited: boolean
let events: { data: string[]; exits: string[]; exitedTelemetry: number; panesChanged: number }

function bridge(overrides: Partial<LegacyRelayTargetBridgeDeps> = {}): LegacyRelayTargetBridge {
  return new LegacyRelayTargetBridge({
    targetId: TARGET,
    leases: () => leases.filter((row) => row.state !== 'terminated'),
    retireLease: (relayPtyId) => {
      leases = leases.map((row) =>
        row.ptyId === relayPtyId ? { ...row, state: 'terminated' } : row
      )
    },
    listEndpoints: async () => listing,
    openClient: async () => {
      if (relay.openError) {
        throw relay.openError
      }
      const client = fakeClient(relay)
      relay.clients.push(client)
      return client
    },
    endpointExited: async () => endpointExited,
    onPanesChanged: () => {
      events.panesChanged += 1
    },
    onData: (_id, chunk) => events.data.push(chunk),
    onExit: (id) => events.exits.push(id),
    onTerminalExited: () => {
      events.exitedTelemetry += 1
    },
    ...overrides
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  relay = { ptys: new Set(['pty-1']), attachError: null, clients: [], openError: null }
  leases = [lease()]
  listing = { kind: 'listed', endpoints: [ENDPOINT], exhaustive: true }
  endpointExited = false
  events = { data: [], exits: [], exitedTelemetry: 0, panesChanged: 0 }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('one target’s legacy relay bridge', () => {
  it('serves a leased pane its relay lists, forwarding output only once attached', async () => {
    const subject = bridge()
    await subject.refresh()
    expect(subject.snapshot()).toEqual([
      { ptyId: PTY, targetId: TARGET, tabId: 'tab-1', leafId: 'leaf-1', state: 'live' }
    ])
    relay.clients[0].emitData('pty-1', 'early')
    await expect(subject.attach(PTY)).resolves.toEqual({ status: 'attached', replay: 'SCREEN' })
    relay.clients[0].emitData('pty-1', 'late')
    subject.write(PTY, 'ls\r')
    expect(events.data).toEqual(['late'])
    expect(relay.clients[0].writes).toEqual(['ls\r'])
  })

  it('retires the pane and hangs up when its relay reports the exit', async () => {
    const subject = bridge()
    await subject.refresh()
    await subject.attach(PTY)
    relay.clients[0].emitExit('pty-1', 0)
    expect(events.exits).toEqual([PTY])
    expect(events.exitedTelemetry).toBe(1)
    expect(leases[0].state).toBe('terminated')
    expect(subject.snapshot()).toEqual([])
    expect(relay.clients[0].closed).toBe(true)
  })

  it('reads a dropped connection as unverifiable and reattaches once the relay answers', async () => {
    const subject = bridge()
    await subject.refresh()
    relay.openError = new Error('ssh down')
    relay.clients[0].drop()
    expect(subject.snapshot()[0].state).toBe('unverifiable')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(subject.snapshot()[0].state).toBe('unverifiable')
    expect(leases[0].state).toBe('detached')
    relay.openError = null
    await vi.advanceTimersByTimeAsync(4_000)
    expect(subject.snapshot()[0].state).toBe('live')
    expect(events.exits).toEqual([])
  })

  it('answers an attach for a leased pane it cannot reach as unverifiable, never exited', async () => {
    listing = { kind: 'unverifiable' }
    const subject = bridge()
    await subject.refresh()
    // Published before any relay answers, so the tab waits instead of starting a second shell.
    expect(subject.snapshot()).toEqual([
      { ptyId: PTY, targetId: TARGET, tabId: 'tab-1', leafId: 'leaf-1', state: 'unverifiable' }
    ])
    const attached = subject.attach(PTY)
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(attached).resolves.toEqual({ status: 'unverifiable' })
    expect(leases[0].state).toBe('detached')
  })

  it('serves a pane whose relay could not be asked at first once it answers', async () => {
    relay.openError = new Error('owner claim timed out')
    const subject = bridge()
    await subject.refresh()
    expect(subject.snapshot()[0].state).toBe('unverifiable')
    relay.openError = null
    await vi.advanceTimersByTimeAsync(2_000)
    expect(subject.snapshot()[0].state).toBe('live')
    await expect(subject.attach(PTY)).resolves.toMatchObject({ status: 'attached' })
  })

  it('retires a lease only when every relay for the target answered without it', async () => {
    relay.ptys.clear()
    await bridge().refresh()
    expect(leases[0].state).toBe('terminated')
    // Never seen live in this session, so no exit is counted for it.
    expect(events.exitedTelemetry).toBe(0)
  })

  it('keeps a lease when a relay could not be asked', async () => {
    relay.ptys.clear()
    relay.openError = new Error('refused')
    await bridge().refresh()
    expect(leases[0].state).toBe('detached')
  })

  it('keeps a lease when a relay may run that no endpoint accounts for', async () => {
    relay.ptys.clear()
    listing = { kind: 'listed', endpoints: [ENDPOINT], exhaustive: false }
    await bridge().refresh()
    expect(leases[0].state).toBe('detached')
  })

  it('counts a relay whose socket is provably dead as holding nothing', async () => {
    relay.openError = new Error('ECONNREFUSED')
    endpointExited = true
    await bridge().refresh()
    expect(leases[0].state).toBe('terminated')
  })

  it('retires on a proven-exited attach refusal, and only re-lists an ambiguous one', async () => {
    const subject = bridge()
    await subject.refresh()
    relay.attachError = new Error('PTY "pty-1" not found')
    await expect(subject.attach(PTY)).resolves.toEqual({ status: 'unverifiable' })
    expect(leases[0].state).toBe('detached')
    expect(subject.snapshot()[0].state).toBe('unverifiable')
    // Re-listed on backoff, never in a tight loop.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(subject.snapshot()[0].state).toBe('live')
    relay.attachError = new Error('PTY "pty-1" not found (process exited)')
    await expect(subject.attach(PTY)).resolves.toEqual({ status: 'exited' })
    expect(leases[0].state).toBe('terminated')
  })

  it('never serves a lease a stop is pending for, or one a newer pane won', async () => {
    leases = [
      lease({ pendingKill: { requestedAt: 1, attempts: 1 } }),
      lease({ ptyId: 'pty-2', supersededBy: 'pty-3' }),
      lease({ ptyId: 'pty-4', tabId: undefined })
    ]
    relay.ptys = new Set(['pty-1', 'pty-2', 'pty-4'])
    const subject = bridge()
    await subject.refresh()
    expect(subject.snapshot()).toEqual([])
    expect(relay.clients).toEqual([])
  })

  it('hangs up every connection on dispose and leaves the relays to their own grace', async () => {
    const subject = bridge()
    await subject.refresh()
    subject.dispose()
    expect(relay.clients.every((client) => client.closed)).toBe(true)
    expect(leases[0].state).toBe('detached')
    expect(subject.snapshot()).toEqual([])
  })
})
