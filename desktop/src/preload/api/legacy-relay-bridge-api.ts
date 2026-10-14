/**
 * Terminals an older Orca's relay still runs, reached through main's legacy relay bridge.
 * COMPAT(legacy-relay-bridge): revisit 2027-01-15. Desktop-only; web clients leave it undefined.
 */
import { ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  LEGACY_RELAY_BRIDGE_CHANNELS as CHANNELS,
  type LegacyRelayBridgeAttachResult,
  type LegacyRelayBridgedPane
} from '../../shared/legacy-relay-bridge-contract'

export type LegacyRelayBridgeApi = {
  listPanes: () => Promise<LegacyRelayBridgedPane[]>
  attach: (args: { ptyId: string }) => Promise<LegacyRelayBridgeAttachResult>
  write: (args: { ptyId: string; data: string }) => void
  resize: (args: { ptyId: string; cols: number; rows: number }) => void
  detach: (args: { ptyId: string }) => void
  onPanes: (callback: (panes: LegacyRelayBridgedPane[]) => void) => () => void
  onData: (callback: (event: { ptyId: string; data: string }) => void) => () => void
  onExit: (callback: (event: { ptyId: string; code: number }) => void) => () => void
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

export const legacyRelayBridgeApi: LegacyRelayBridgeApi = {
  listPanes: () => ipcRenderer.invoke(CHANNELS.listPanes),
  attach: (args) => ipcRenderer.invoke(CHANNELS.attach, args),
  write: (args) => ipcRenderer.send(CHANNELS.write, args),
  resize: (args) => ipcRenderer.send(CHANNELS.resize, args),
  detach: (args) => ipcRenderer.send(CHANNELS.detach, args),
  onPanes: (callback) => subscribe(CHANNELS.panes, callback),
  onData: (callback) => subscribe(CHANNELS.data, callback),
  onExit: (callback) => subscribe(CHANNELS.exit, callback)
}
