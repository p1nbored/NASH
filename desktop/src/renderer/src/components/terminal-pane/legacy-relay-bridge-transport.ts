/**
 * A runtime pane whose terminal still runs inside an older Orca's relay: it reattaches through
 * main's legacy relay bridge, and hands every other connect to the managed server's transport.
 * COMPAT(legacy-relay-bridge): revisit 2027-01-15, with src/main/ssh/legacy-relay-bridge/.
 *
 * When the bridge answers that the terminal is gone, the pane gets the host's "session expired"
 * error, which retires its binding and starts a fresh shell on the managed server. When the relay
 * can't be reached, the pane stays bound and reattaches once it can: loss of contact is never exit.
 */
import type { PtyConnectResult, PtyTransport } from './pty-transport-types'
import { SSH_SESSION_EXPIRED_ERROR } from './pty-connection/pty-connect-limits'
import {
  legacyRelayBridgedPane,
  onLegacyRelayBridgedPanesChanged
} from './legacy-relay-bridge-panes'

type Callbacks = Parameters<PtyTransport['connect']>[0]['callbacks']

const UNREACHABLE_MESSAGE =
  'This terminal is still running on the host under an older version of Orca. Reconnecting to it…'

export function createLegacyRelayBridgeTransport(ptyId: string, inner: PtyTransport): PtyTransport {
  const api = window.api.legacyRelayBridge
  let mode: 'pending' | 'bridge' | 'inner' = 'pending'
  let attached = false
  let callbacks: Callbacks | null = null
  let unsubscribe: (() => void)[] = []
  let reattaching = false
  let reattachQueued = false
  let showingUnreachable = false
  let lastState: 'live' | 'unverifiable' | null = null

  const release = (): void => {
    unsubscribe.forEach((dispose) => dispose())
    unsubscribe = []
    if (attached) {
      api?.detach({ ptyId })
    }
    attached = false
  }

  const showUnreachable = (): void => {
    if (!showingUnreachable) {
      showingUnreachable = true
      callbacks?.onError?.(UNREACHABLE_MESSAGE)
    }
  }

  const clearUnreachable = (): void => {
    if (showingUnreachable) {
      showingUnreachable = false
      callbacks?.onErrorCleared?.(UNREACHABLE_MESSAGE)
    }
  }

  const reattach = async (): Promise<void> => {
    if (!api || mode !== 'bridge') {
      return
    }
    if (reattaching) {
      // The ask in flight may reach a bridge that was replaced since; ask again once it answers.
      reattachQueued = true
      return
    }
    reattaching = true
    try {
      const result = await api.attach({ ptyId })
      if (mode !== 'bridge') {
        return
      }
      if (result.status === 'attached') {
        attached = true
        clearUnreachable()
        callbacks?.onReplayData?.(result.replay, { clearBeforeReplay: true })
      } else if (result.status === 'exited' || result.status === 'not-bridged') {
        clearUnreachable()
        callbacks?.onExit?.(-1)
      }
    } finally {
      reattaching = false
      if (reattachQueued) {
        reattachQueued = false
        if (!attached) {
          void reattach()
        }
      }
    }
  }

  const subscribe = (): void => {
    if (!api || unsubscribe.length > 0) {
      return
    }
    unsubscribe = [
      api.onData((event) => {
        if (mode === 'bridge' && event.ptyId === ptyId) {
          callbacks?.onData?.(event.data)
        }
      }),
      api.onExit((event) => {
        if (mode === 'bridge' && event.ptyId === ptyId) {
          clearUnreachable()
          release()
          callbacks?.onExit?.(event.code)
        }
      }),
      onLegacyRelayBridgedPanesChanged(() => {
        const pane = legacyRelayBridgedPane(ptyId)
        if (mode !== 'bridge') {
          return
        }
        if (!pane) {
          lastState = null
          // A disconnect hangs the bridge up without an exit, and the next bridge serves only panes
          // that attach to it. Ask again; it answers exited once the terminal is proven gone.
          attached = false
          void reattach()
          return
        }
        const previous = lastState
        lastState = pane.state
        if (pane.state === 'unverifiable') {
          attached = false
          showUnreachable()
        } else if (!attached && previous !== 'live') {
          // Only on the change to live: a terminal that refuses to attach waits for the next one.
          void reattach()
        }
      })
    ]
  }

  const connectBridged = async (next: Callbacks): Promise<PtyConnectResult | undefined> => {
    callbacks = next
    if (!api) {
      next.onError?.(`${SSH_SESSION_EXPIRED_ERROR}: legacy relay bridge unavailable`)
      return undefined
    }
    mode = 'bridge'
    subscribe()
    const result = await api.attach({ ptyId })
    if (mode !== 'bridge') {
      return undefined
    }
    if (result.status === 'exited' || result.status === 'not-bridged') {
      release()
      mode = 'pending'
      next.onError?.(`${SSH_SESSION_EXPIRED_ERROR}: the older relay no longer runs this terminal`)
      return undefined
    }
    next.onConnect?.()
    lastState = result.status === 'attached' ? 'live' : 'unverifiable'
    if (result.status === 'unverifiable') {
      showUnreachable()
      return { id: ptyId, isReattach: true, replay: '' }
    }
    attached = true
    return { id: ptyId, isReattach: true, replay: result.replay }
  }

  const bridged = (): boolean => mode === 'bridge'
  const innerRecoveryState = inner.getRecoveryState?.bind(inner)
  const innerSnapshotOutcome = inner.serializeBufferOutcome?.bind(inner)

  return {
    ...(innerRecoveryState
      ? {
          getRecoveryState: () =>
            bridged()
              ? { phase: attached ? 'connected' : 'recovering', epoch: 0, attempt: 0 }
              : innerRecoveryState()
        }
      : {}),
    ...(innerSnapshotOutcome
      ? {
          serializeBufferOutcome: (opts?: { scrollbackRows?: number }) =>
            bridged()
              ? Promise.resolve({
                  availability: { kind: 'unknown-legacy-host' as const },
                  snapshot: null
                })
              : innerSnapshotOutcome(opts)
        }
      : {}),
    getConnectionId: () => (bridged() ? null : inner.getConnectionId?.()),
    ownsRecovery: () => (bridged() ? false : (inner.ownsRecovery?.() ?? false)),
    retryRecovery: () => (bridged() ? false : (inner.retryRecovery?.() ?? false)),
    setOutputPaused: (paused) => (bridged() ? false : (inner.setOutputPaused?.(paused) ?? false)),
    connect: (options) => {
      if (options.sessionId === ptyId) {
        return connectBridged(options.callbacks)
      }
      mode = 'inner'
      release()
      return inner.connect(options)
    },
    attach: (options) => {
      if (options.existingPtyId === ptyId) {
        void connectBridged(options.callbacks)
        return
      }
      mode = 'inner'
      inner.attach(options)
    },
    disconnect: () => {
      if (bridged()) {
        release()
        callbacks?.onDisconnect?.()
        return
      }
      inner.disconnect()
    },
    sendInput: (data, inputKind) => {
      if (bridged()) {
        api?.write({ ptyId, data })
        return attached
      }
      return inner.sendInput(data, inputKind)
    },
    sendInputImmediate: (data) => {
      if (bridged()) {
        api?.write({ ptyId, data })
        return attached
      }
      return inner.sendInputImmediate(data)
    },
    sendInputAccepted: async (data, inputKind, options) => {
      if (bridged()) {
        api?.write({ ptyId, data })
        return attached
      }
      return inner.sendInputAccepted
        ? inner.sendInputAccepted(data, inputKind, options)
        : inner.sendInput(data, inputKind)
    },
    resize: (cols, rows, meta) => {
      if (bridged()) {
        api?.resize({ ptyId, cols, rows })
        return attached
      }
      return inner.resize(cols, rows, meta)
    },
    isConnected: () => (bridged() ? attached : inner.isConnected()),
    getPtyId: () => (bridged() ? ptyId : inner.getPtyId()),
    isConnectPending: () => (bridged() ? false : (inner.isConnectPending?.() ?? false)),
    getRuntimeEnvironmentId: () => (bridged() ? null : (inner.getRuntimeEnvironmentId?.() ?? null)),
    getExecutionHostId: () => (bridged() ? null : (inner.getExecutionHostId?.() ?? null)),
    getRemotePlatform: () => (bridged() ? null : (inner.getRemotePlatform?.() ?? null)),
    claimViewport: (cols, rows) =>
      bridged() ? false : (inner.claimViewport?.(cols, rows) ?? false),
    serializeBuffer: async (opts) => (bridged() ? null : (inner.serializeBuffer?.(opts) ?? null)),
    preserve: () => {
      if (!bridged()) {
        inner.preserve?.()
      }
    },
    detach: (options) => {
      if (bridged()) {
        release()
        return
      }
      inner.detach?.(options)
    },
    destroy: (options) => {
      if (bridged() || mode === 'pending') {
        release()
        mode = 'pending'
        return
      }
      return inner.destroy?.(options)
    },
    abandonPreconnectInput: () => inner.abandonPreconnectInput?.(),
    notifyErrorSurfaceDismissed: () => inner.notifyErrorSurfaceDismissed?.()
  }
}
