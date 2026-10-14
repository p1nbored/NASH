// COMPAT(legacy-relay-bridge): revisit 2027-01-15 with src/main/ssh/legacy-relay-bridge/.

/** A pane whose terminal still runs inside an older Orca's relay and is reached through the bridge. */
export type LegacyRelayBridgedPane = {
  /** The relay-era app PTY id, `ssh:<target>@@<relay id>`. */
  ptyId: string
  targetId: string
  tabId: string
  leafId?: string
  /** `unverifiable` while the relay can't be asked; never read as exited. */
  state: 'live' | 'unverifiable'
}

export type LegacyRelayBridgeAttachResult =
  | { status: 'attached'; replay: string }
  /** The relay answered that the terminal is gone, or no relay for the host can be holding it. */
  | { status: 'exited' }
  /** The bridge serves no such terminal (a Windows host, an unknown id). */
  | { status: 'not-bridged' }
  /** The relay holding it can't be reached right now; the pane stays bound and waits. */
  | { status: 'unverifiable' }

export const LEGACY_RELAY_BRIDGE_CHANNELS = {
  listPanes: 'legacyRelayBridge:listPanes',
  attach: 'legacyRelayBridge:attach',
  write: 'legacyRelayBridge:write',
  resize: 'legacyRelayBridge:resize',
  detach: 'legacyRelayBridge:detach',
  panes: 'legacyRelayBridge:panes',
  data: 'legacyRelayBridge:data',
  exit: 'legacyRelayBridge:exit'
} as const
