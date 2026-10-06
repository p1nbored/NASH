import {
  dotRemoteStateOfReason,
  WorkbenchDotRemoteStatusViewSchema,
  type DotRemoteConnectionState,
  type WorkbenchDotRemoteStatusView,
  type WorkbenchDotRemoteSyncFailure
} from '../../../shared/rpc-contract/workbench-dot-remote-params'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { DotRemoteSessionHolder } from './dot-remote-agent-session'
import type { DotRemoteCredentialSource, DotRemoteTokenProtection } from './dot-remote-credentials'
import type { DotRemoteLocalEndpoint } from './dot-remote-local-endpoint'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { getDotRemoteSettingsStore } from './dot-remote-settings-store'

// The status view the desktop shows (UI-7): connection state, the switch, the origin, the token's
// protection (never its value), the pairing and how long it lasts (never its device credential), the
// local endpoint, the last sync time and polls that keep throwing.

type StatusInput = {
  readonly owner: OrchestrationDb
  readonly credentials: DotRemoteCredentialSource
  readonly endpoint: DotRemoteLocalEndpoint
  readonly sessions: DotRemoteSessionHolder
  readonly pairingWaiting: boolean
  readonly syncFailure: WorkbenchDotRemoteSyncFailure | null
}

function protectionOf(credentials: DotRemoteCredentialSource): DotRemoteTokenProtection {
  try {
    return credentials.status().protection
  } catch {
    return 'sealing_unavailable'
  }
}

function endpointReady(endpoint: DotRemoteLocalEndpoint): boolean {
  try {
    return endpoint.ready()
  } catch {
    return false
  }
}

function stateOf(enabled: boolean, input: StatusInput): DotRemoteConnectionState {
  const { sessions } = input
  if (!enabled) {
    return 'off'
  }
  const reason = sessions.reconnectReason()
  if (reason !== null) {
    return dotRemoteStateOfReason(reason)
  }
  if (input.pairingWaiting) {
    return 'pairing'
  }
  if (sessions.hasSession()) {
    return sessions.isOffline() ? 'offline' : 'connected'
  }
  // Why offline: paired, and the next poll refreshes the session with the device credential.
  return sessions.resumable() ? 'offline' : 'unpaired'
}

export function buildDotRemoteStatus(input: StatusInput): WorkbenchDotRemoteStatusView {
  const store = getDotRemoteSettingsStore(input.owner)
  const settings = store.getSettings()
  const record = store.getPairing()
  const state = stateOf(settings.enabled, input)
  const live = record && record.revokedAt === null ? record : null
  return WorkbenchDotRemoteStatusViewSchema.parse({
    state,
    enabled: settings.enabled,
    origin: settings.origin,
    serviceToken: protectionOf(input.credentials),
    reconnectReason:
      state === 'reconnect_needed' || state === 'pair_again'
        ? input.sessions.reconnectReason()
        : null,
    pairing: live
      ? {
          deviceId: live.deviceId,
          generation: live.generation,
          pairedAt: live.pairedAt,
          pairedUntil: live.lifetimeEndsAt
        }
      : null,
    localEndpoint: endpointReady(input.endpoint) ? 'ready' : 'unavailable',
    lastSyncAt: settings.lastSyncAt,
    pendingEvents: getDotRemoteOutboxStore(input.owner).countPending(),
    syncFailure: settings.enabled ? input.syncFailure : null
  })
}
