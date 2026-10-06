import {
  dotRemoteStateOfReason,
  type DotRemoteReconnectReason,
  type WorkbenchDotRemotePairingView,
  type WorkbenchDotRemoteStatusView
} from '../../../../shared/rpc-contract/workbench-dot-remote-params'

// FIXTURE_ONLY remote access answers for tests and the design harness. The origin is a reserved test
// domain and the token an obviously fake value; nothing here reaches a network or a real Site.

export const FIXTURE_REMOTE_ORIGIN = 'https://fixture-nash.example.test'
export const FIXTURE_REMOTE_TOKEN = 'FIXTURE_ONLY_sites_service_token_0000000000'
export const FIXTURE_REMOTE_USER_CODE = 'BCDF-GHJK'
export const FIXTURE_REMOTE_PAIRED_AT = '2026-10-05T09:12:00.000Z'
/** The pairing's absolute end on the Site, 30 days after approval. */
export const FIXTURE_REMOTE_PAIRED_UNTIL = '2026-11-04T09:12:00.000Z'
export const FIXTURE_REMOTE_LAST_SYNC_AT = '2026-10-05T09:29:30.000Z'

type Status = WorkbenchDotRemoteStatusView
type Pairing = WorkbenchDotRemotePairingView

/** Remote access off, with no origin, no token and no pairing, unless overridden. */
export function fixtureRemoteStatus(overrides: Partial<Status> = {}): Status {
  return {
    state: 'off',
    enabled: false,
    origin: null,
    serviceToken: 'absent',
    reconnectReason: null,
    pairing: null,
    localEndpoint: 'ready',
    lastSyncAt: null,
    pendingEvents: 0,
    ...overrides
  }
}

/** Switched on, origin and sealed token saved, not paired yet. */
export function fixtureConfiguredRemoteStatus(overrides: Partial<Status> = {}): Status {
  return fixtureRemoteStatus({
    state: 'unpaired',
    enabled: true,
    origin: FIXTURE_REMOTE_ORIGIN,
    serviceToken: 'sealed',
    ...overrides
  })
}

export function fixtureConnectedRemoteStatus(overrides: Partial<Status> = {}): Status {
  return fixtureConfiguredRemoteStatus({
    state: 'connected',
    pairing: {
      deviceId: 'dev_0123456789abcdef01234567',
      generation: 1,
      pairedAt: FIXTURE_REMOTE_PAIRED_AT,
      pairedUntil: FIXTURE_REMOTE_PAIRED_UNTIL
    },
    lastSyncAt: FIXTURE_REMOTE_LAST_SYNC_AT,
    ...overrides
  })
}

/** A refused token keeps the pairing; every other stop fences it, so a new pairing is needed. */
export function fixtureReconnectRemoteStatus(reason: DotRemoteReconnectReason): Status {
  const state = dotRemoteStateOfReason(reason)
  return fixtureConnectedRemoteStatus({
    state,
    reconnectReason: reason,
    ...(state === 'pair_again' ? { pairing: null } : {})
  })
}

export function fixtureWaitingPairing(expiresAt: string): Pairing {
  return { state: 'waiting_for_approval', userCode: FIXTURE_REMOTE_USER_CODE, expiresAt }
}

export function fixtureEndedPairing(
  state: Exclude<Pairing['state'], 'waiting_for_approval'>
): Pairing {
  return { state, userCode: null, expiresAt: null }
}
