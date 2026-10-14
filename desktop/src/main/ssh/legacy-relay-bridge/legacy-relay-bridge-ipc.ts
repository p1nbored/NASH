/**
 * The bridge's own IPC channels, and the live collaborators it runs with.
 * COMPAT(legacy-relay-bridge): revisit 2027-01-15.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { LEGACY_RELAY_BRIDGE_CHANNELS as CHANNELS } from '../../../shared/legacy-relay-bridge-contract'
import type { Store } from '../../persistence'
import { track } from '../../telemetry/client'
import type { SshConnection } from '../ssh-connection'
import { knownSshHostPlatform } from '../ssh-host-platform-memo'
import { hostProps } from '../ssh-host-server-telemetry'
import {
  attachLegacyRelayPane,
  detachLegacyRelayPane,
  installLegacyRelayBridge,
  legacyRelayBridgedPanes,
  resizeLegacyRelayPane,
  terminalsBucket,
  writeLegacyRelayPane
} from './legacy-relay-bridge-registry'

const PtyIdSchema = z.string().min(1).max(4096)
const SizeSchema = z.number().int().positive().max(10_000)
const PaneArgsSchema = z.object({ ptyId: PtyIdSchema })
const WriteArgsSchema = z.object({ ptyId: PtyIdSchema, data: z.string() })
const ResizeArgsSchema = z.object({ ptyId: PtyIdSchema, cols: SizeSchema, rows: SizeSchema })

export function registerLegacyRelayBridgeIpc(args: {
  store: Pick<Store, 'getSshRemotePtyLeases' | 'markSshRemotePtyLease'>
  getMainWindow: () => BrowserWindow | null
  connection: (targetId: string) => SshConnection | null
}): void {
  const send = (channel: string, payload: unknown): void => {
    const contents = args.getMainWindow()?.webContents
    if (contents && !contents.isDestroyed()) {
      contents.send(channel, payload)
    }
  }
  installLegacyRelayBridge({
    leases: (targetId) => args.store.getSshRemotePtyLeases(targetId),
    retireLease: (targetId, relayPtyId) =>
      args.store.markSshRemotePtyLease(targetId, relayPtyId, 'terminated'),
    connection: args.connection,
    onPanesChanged: (panes) => send(CHANNELS.panes, panes),
    onData: (ptyId, data) => send(CHANNELS.data, { ptyId, data }),
    onExit: (ptyId, code) => send(CHANNELS.exit, { ptyId, code }),
    report: (targetId, phase, terminals) => {
      try {
        track('ssh_host_server_legacy_relay_bridge', {
          phase,
          terminals: terminalsBucket(terminals),
          ...hostProps(knownSshHostPlatform(targetId))
        })
      } catch {
        // Telemetry never costs a terminal.
      }
    }
  })
  ipcMain.removeHandler(CHANNELS.listPanes)
  ipcMain.removeHandler(CHANNELS.attach)
  for (const channel of [CHANNELS.write, CHANNELS.resize, CHANNELS.detach]) {
    ipcMain.removeAllListeners(channel)
  }
  ipcMain.handle(CHANNELS.listPanes, () => legacyRelayBridgedPanes())
  ipcMain.handle(CHANNELS.attach, async (_event, payload: unknown) => {
    const args = PaneArgsSchema.safeParse(payload)
    return args.success ? attachLegacyRelayPane(args.data.ptyId) : { status: 'not-bridged' }
  })
  ipcMain.on(CHANNELS.write, (_event, payload: unknown) => {
    const args = WriteArgsSchema.safeParse(payload)
    if (args.success) {
      writeLegacyRelayPane(args.data.ptyId, args.data.data)
    }
  })
  ipcMain.on(CHANNELS.resize, (_event, payload: unknown) => {
    const args = ResizeArgsSchema.safeParse(payload)
    if (args.success) {
      resizeLegacyRelayPane(args.data.ptyId, args.data.cols, args.data.rows)
    }
  })
  ipcMain.on(CHANNELS.detach, (_event, payload: unknown) => {
    const args = PaneArgsSchema.safeParse(payload)
    if (args.success) {
      detachLegacyRelayPane(args.data.ptyId)
    }
  })
}
