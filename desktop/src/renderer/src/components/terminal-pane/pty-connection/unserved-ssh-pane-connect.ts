import { useAppStore } from '@/store'
import { isRuntimeOwnedSshTargetId } from '../../../../../shared/execution-host'
import { isSshConnectInFlight, trackSshConnect } from '@/ssh/ssh-connect-in-flight'
import type { ConnectPanePtySession } from './connect-pane-pty-session'
import type { PtyTransport } from '../pty-transport-types'
import { createUnresolvedOwnerPtyTransport } from '../unresolved-owner-pty-transport'

/** Inert: the reconnect overlay and the host's conversion own this pane, so input never remounts it. */
export function createUnservedSshPaneTransport(): PtyTransport {
  return {
    ...createUnresolvedOwnerPtyTransport(
      'SSH connection is not active. Use the reconnect dialog or Settings to connect.'
    ),
    ownsRecovery: () => true
  }
}

/**
 * A pane on a relay-era `ssh:` row never spawns: the reconnect overlay owns it, and the connect
 * converts the host to its managed runtime, whose row remounts the pane. Mounting still dials,
 * as the relay-era pane did, except for passphrase targets, which wait for the user.
 */
export function connectUnservedSshPaneTarget(
  session: ConnectPanePtySession,
  targetId: string
): void {
  // Runtime-owned targets are dialed by the runtime layer; a removed target can never connect.
  const state = useAppStore.getState()
  if (
    isRuntimeOwnedSshTargetId(targetId) ||
    (state.sshTargetLabels instanceof Map && !state.sshTargetLabels.has(targetId))
  ) {
    return
  }
  const isConnected = (): boolean =>
    useAppStore.getState().sshConnectionStates.get(targetId)?.status === 'connected'
  if (isConnected()) {
    return
  }
  void (async () => {
    let needsPrompt = false
    try {
      needsPrompt = await window.api.ssh.needsPassphrasePrompt({ targetId })
    } catch (err) {
      // Why: a stuck tab is worse than a surprising prompt.
      console.warn('[pty-connection] needsPassphrasePrompt probe failed:', err)
    }
    if (session.disposed || needsPrompt || isConnected() || isSshConnectInFlight(targetId)) {
      return
    }
    try {
      await trackSshConnect(targetId, window.api.ssh.connect({ targetId, automatic: true }))
    } catch (err) {
      console.warn(`[pty-connection] SSH connect failed for ${targetId}:`, err)
      session.reportError(
        `SSH connection failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })()
}
