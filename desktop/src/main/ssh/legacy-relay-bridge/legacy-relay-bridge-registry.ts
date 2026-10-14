/**
 * Every SSH target's legacy relay bridge, and the one seam the rest of main calls.
 * COMPAT(legacy-relay-bridge): revisit 2027-01-15.
 */
import type { EventProps } from '../../../shared/telemetry-events'
import type {
  LegacyRelayBridgeAttachResult,
  LegacyRelayBridgedPane
} from '../../../shared/legacy-relay-bridge-contract'
import { parseAppSshPtyId } from '../../../shared/ssh-pty-id'
import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import type { SshConnection } from '../ssh-connection'
import { waitForSentinel } from '../ssh-relay-sentinel'
import { probeRelayEndpointIncumbent } from '../ssh-relay-endpoint-incumbent'
import { isWindowsRemoteHost } from '../ssh-remote-platform'
import { LegacyRelayClient } from './legacy-relay-client'
import { listLegacyRelayEndpoints, type LegacyRelayEndpoint } from './legacy-relay-endpoints'
import { LegacyRelayTargetBridge } from './legacy-relay-target-bridge'
import { bridgeableLeasesByRelayId, isBridgeableLease } from './legacy-relay-bridge-leases'

/** How long a connect waits for the first look at its relays before publishing the host. */
const START_BUDGET_MS = 20_000
/** How long an attach waits for a target whose connection is still coming up. */
const CONNECTION_WAIT_MS = 20_000

type TerminalsBucket = EventProps<'ssh_host_server_legacy_relay_bridge'>['terminals']

export type LegacyRelayBridgeHost = {
  leases: (targetId: string) => SshRemotePtyLease[]
  retireLease: (targetId: string, relayPtyId: string) => void
  connection: (targetId: string) => SshConnection | null
  onPanesChanged: (panes: LegacyRelayBridgedPane[]) => void
  onData: (ptyId: string, data: string) => void
  onExit: (ptyId: string, code: number) => void
  report: (targetId: string, phase: 'connected' | 'terminal_exited', terminals: number) => void
}

let host: LegacyRelayBridgeHost | null = null
const bridges = new Map<string, LegacyRelayTargetBridge>()
/**
 * Panes a hung-up bridge served, held `unverifiable` until the target's next bridge lists its own
 * or the leases go: a hang-up is loss of contact, not exit (docs/reference/ssh-execution-boundary.md).
 */
const heldPanes = new Map<string, LegacyRelayBridgedPane[]>()

export function installLegacyRelayBridge(next: LegacyRelayBridgeHost | null): void {
  for (const bridge of bridges.values()) {
    bridge.dispose()
  }
  bridges.clear()
  heldPanes.clear()
  host = next
}

export function terminalsBucket(count: number): TerminalsBucket {
  if (count <= 0) {
    return 'none'
  }
  if (count === 1) {
    return '1'
  }
  if (count < 5) {
    return '2_4'
  }
  return count < 10 ? '5_9' : '10_plus'
}

function hasBridgeableLeases(targetId: string): boolean {
  return host?.leases(targetId).some(isBridgeableLease) ?? false
}

function bridgeFor(targetId: string): LegacyRelayTargetBridge | null {
  const existing = bridges.get(targetId)
  if (existing || !host) {
    return existing ?? null
  }
  const installed = host
  const clientInstanceId = `orca-legacy-relay-bridge:${targetId}`
  const connection = (): SshConnection => {
    const conn = installed.connection(targetId)
    if (!conn) {
      throw new Error('ssh_connection_unavailable')
    }
    return conn
  }
  const bridge = new LegacyRelayTargetBridge({
    targetId,
    leases: () => installed.leases(targetId),
    retireLease: (relayPtyId) => installed.retireLease(targetId, relayPtyId),
    listEndpoints: async (signal) => {
      const conn = installed.connection(targetId)
      return conn ? listLegacyRelayEndpoints(conn, targetId, signal) : { kind: 'unverifiable' }
    },
    openClient: (endpoint, resume) =>
      LegacyRelayClient.open({
        clientInstanceId,
        resume,
        openTransport: async () =>
          waitForSentinel(
            await connection().exec(endpoint.connectCommand ?? '', {
              wrapCommand: endpoint.wrapCommand
            })
          )
      }),
    endpointExited: (endpoint) => posixEndpointExited(connection(), endpoint),
    onPanesChanged: () => {
      // A running bridge's own listing answers for its target; a disposed one's does not.
      if (bridges.get(targetId) === bridge) {
        heldPanes.delete(targetId)
      }
      installed.onPanesChanged(legacyRelayBridgedPanes())
    },
    onData: installed.onData,
    onExit: installed.onExit,
    onTerminalExited: () => installed.report(targetId, 'terminal_exited', 0)
  })
  bridges.set(targetId, bridge)
  return bridge
}

/** A dead socket is the one failed open that proves its relay gone; Windows pipes never are. */
async function posixEndpointExited(
  conn: SshConnection,
  endpoint: LegacyRelayEndpoint
): Promise<boolean> {
  if (isWindowsRemoteHost(endpoint.host) || !endpoint.nodePath) {
    return false
  }
  const incumbent = await probeRelayEndpointIncumbent(
    conn,
    endpoint.host,
    endpoint.nodePath,
    endpoint.endpoint
  )
  return incumbent.verdict === 'exited'
}

/**
 * Called once a connect reaches the host's managed server: looks at the relays this target left,
 * so the panes they still run are known before the renderer remounts them on the new server.
 */
export async function startLegacyRelayBridge(targetId: string): Promise<void> {
  if (!hasBridgeableLeases(targetId)) {
    // Leases retired while hung up publish nothing themselves; this connect is the next answer.
    releaseHeldPanes(targetId)
    return
  }
  const bridge = bridgeFor(targetId)
  if (!bridge) {
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    bridge.refresh().catch((error: unknown) => {
      console.warn(`[ssh] Legacy relay bridge could not look at ${targetId}:`, error)
    }),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, START_BUDGET_MS)
    })
  ])
  clearTimeout(timer)
  const live = bridge.livePaneCount()
  if (live > 0) {
    host?.report(targetId, 'connected', live)
  }
}

export function stopLegacyRelayBridge(targetId: string): void {
  const bridge = bridges.get(targetId)
  if (bridge) {
    const held = bridge.snapshot().map((pane) => ({ ...pane, state: 'unverifiable' as const }))
    if (held.length > 0) {
      heldPanes.set(targetId, held)
    }
    bridges.delete(targetId)
    // Disposing publishes the list, now with the held panes instead of the bridge's.
    bridge.dispose()
  }
}

/** The target and its leases are gone, so nothing it served is held any longer. */
export function forgetLegacyRelayTarget(targetId: string): void {
  stopLegacyRelayBridge(targetId)
  releaseHeldPanes(targetId)
}

function releaseHeldPanes(targetId: string): void {
  if (heldPanes.delete(targetId)) {
    host?.onPanesChanged(legacyRelayBridgedPanes())
  }
}

export function legacyRelayBridgedPanes(): LegacyRelayBridgedPane[] {
  return [
    ...[...bridges.values()].flatMap((bridge) => bridge.snapshot()),
    ...[...heldPanes].flatMap(([targetId, panes]) => stillLeased(targetId, panes))
  ]
}

function stillLeased(targetId: string, panes: LegacyRelayBridgedPane[]): LegacyRelayBridgedPane[] {
  const leased = bridgeableLeasesByRelayId(host?.leases(targetId) ?? [])
  return panes.filter((pane) => leased.has(parseAppSshPtyId(pane.ptyId)?.relayPtyId ?? ''))
}

export async function attachLegacyRelayPane(ptyId: string): Promise<LegacyRelayBridgeAttachResult> {
  const targetId = parseAppSshPtyId(ptyId)?.connectionId
  if (!targetId || !host || !hasBridgeableLeases(targetId)) {
    return { status: 'not-bridged' }
  }
  const bridge = bridgeFor(targetId)
  if (!bridge) {
    return { status: 'not-bridged' }
  }
  // A pane can mount before its host's connect finishes; the bridge keeps retrying until it can ask.
  if (!(await waitForConnection(targetId))) {
    void bridge.refresh()
    return { status: 'unverifiable' }
  }
  return bridge.attach(ptyId)
}

async function waitForConnection(targetId: string): Promise<boolean> {
  const deadline = Date.now() + CONNECTION_WAIT_MS
  while (!host?.connection(targetId)) {
    if (Date.now() >= deadline || !host) {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return true
}

function bridgeForPty(ptyId: string): LegacyRelayTargetBridge | undefined {
  const targetId = parseAppSshPtyId(ptyId)?.connectionId
  return targetId ? bridges.get(targetId) : undefined
}

export function writeLegacyRelayPane(ptyId: string, data: string): void {
  bridgeForPty(ptyId)?.write(ptyId, data)
}

export function resizeLegacyRelayPane(ptyId: string, cols: number, rows: number): void {
  bridgeForPty(ptyId)?.resize(ptyId, cols, rows)
}

export function detachLegacyRelayPane(ptyId: string): void {
  bridgeForPty(ptyId)?.detach(ptyId)
}
