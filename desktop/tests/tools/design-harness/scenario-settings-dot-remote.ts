import { DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS } from '../../../src/shared/dot-remote/dot-remote-defaults'
import {
  DOT_REMOTE_RPC_ERROR_CODES,
  dotRemoteStateOfReason,
  type WorkbenchDotRemotePairingView,
  type WorkbenchDotRemoteStatusView
} from '../../../src/shared/rpc-contract/workbench-dot-remote-params'
import {
  fixtureConfiguredRemoteStatus,
  fixtureConnectedRemoteStatus,
  fixtureEndedPairing,
  fixtureReconnectRemoteStatus,
  fixtureRemoteStatus,
  fixtureWaitingPairing
} from '../../../src/renderer/src/components/settings/dot-remote-access.test-fixture'
import { checkDotRemoteOrigin } from '../../../src/renderer/src/components/settings/dot-remote-origin-check'
import type { SettingsFixtureReply } from './scenario-settings-routing-table'

// FIXTURE_ONLY remote access answers (`?dotRemote=`). No Site, token or network is involved: the
// pairing code, origin and token are synthetic, and this state lives in the page until reload.
export const DOT_REMOTE_FIXTURE_VARIANTS = [
  'off',
  'unpaired',
  'configured',
  'pairing',
  'pairingApproves',
  'pairingExpired',
  'pairingDenied',
  'connected',
  'offline',
  'reconnectToken',
  'pairAgainRestart',
  'pairAgainLifetime',
  'endpointClosed',
  'sealingUnavailable',
  'refusals',
  'notConnected'
] as const
export type DotRemoteFixtureVariant = (typeof DOT_REMOTE_FIXTURE_VARIANTS)[number]

type Status = WorkbenchDotRemoteStatusView
type Pairing = WorkbenchDotRemotePairingView

const PAIRING_TTL_MS = 10 * 60_000
const PAIRING_LIFETIME_MS = DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS * 24 * 60 * 60_000
const POLLS_BEFORE_APPROVAL = 2

const INITIAL_STATUS: Readonly<Record<DotRemoteFixtureVariant, () => Status>> = {
  off: () => fixtureRemoteStatus(),
  notConnected: () => fixtureRemoteStatus(),
  unpaired: () => fixtureRemoteStatus({ state: 'unpaired', enabled: true }),
  configured: () => fixtureConfiguredRemoteStatus(),
  pairing: () => fixtureConfiguredRemoteStatus({ state: 'pairing' }),
  pairingApproves: () => fixtureConfiguredRemoteStatus(),
  pairingExpired: () => fixtureConfiguredRemoteStatus(),
  pairingDenied: () => fixtureConfiguredRemoteStatus(),
  refusals: () => fixtureConfiguredRemoteStatus(),
  connected: () => fixtureConnectedRemoteStatus(),
  offline: () => fixtureConnectedRemoteStatus({ state: 'offline', pendingEvents: 2 }),
  endpointClosed: () =>
    fixtureConnectedRemoteStatus({ localEndpoint: 'unavailable', pendingEvents: 3 }),
  sealingUnavailable: () =>
    fixtureRemoteStatus({ state: 'unpaired', enabled: true, serviceToken: 'sealing_unavailable' }),
  reconnectToken: () => fixtureReconnectRemoteStatus('service_token_rejected'),
  pairAgainRestart: () => fixtureReconnectRemoteStatus('session_ended'),
  pairAgainLifetime: () => fixtureReconnectRemoteStatus('pairing_expired')
}

export function readDotRemoteFixtureVariant(search: string): DotRemoteFixtureVariant {
  const value = new URLSearchParams(search).get('dotRemote')
  return DOT_REMOTE_FIXTURE_VARIANTS.find((variant) => variant === value) ?? 'off'
}

/** The state the real status builder would report for these fields. */
function withState(status: Status, waiting: boolean): Status {
  if (!status.enabled) {
    return { ...status, state: 'off', reconnectReason: null }
  }
  if (status.reconnectReason !== null) {
    return { ...status, state: dotRemoteStateOfReason(status.reconnectReason) }
  }
  if (waiting) {
    return { ...status, state: 'pairing' }
  }
  return { ...status, state: status.pairing === null ? 'unpaired' : 'connected' }
}

function refused(code: string): SettingsFixtureReply {
  return { ok: false, code, message: `FIXTURE_ONLY ${code}` }
}

function originOf(params: unknown): string | null {
  const origin =
    typeof params === 'object' && params !== null
      ? Object.entries(params).find(([key]) => key === 'origin')?.[1]
      : undefined
  if (typeof origin !== 'string') {
    return null
  }
  const checked = checkDotRemoteOrigin(origin)
  return checked.ok ? checked.origin : null
}

function nextPoll(variant: DotRemoteFixtureVariant, polls: number, waiting: Pairing): Pairing {
  if (variant === 'pairingExpired') {
    return fixtureEndedPairing('expired')
  }
  if (variant === 'pairingDenied') {
    return fixtureEndedPairing('denied')
  }
  return variant === 'pairingApproves' && polls > POLLS_BEFORE_APPROVAL
    ? fixtureEndedPairing('paired')
    : waiting
}

export function createDotRemoteFixture(
  variant: DotRemoteFixtureVariant
): (method: string, params: unknown) => SettingsFixtureReply | null {
  let pairing: Pairing =
    variant === 'pairing'
      ? fixtureWaitingPairing(new Date(Date.now() + PAIRING_TTL_MS).toISOString())
      : fixtureEndedPairing('idle')
  let status = INITIAL_STATUS[variant]()
  let polls = 0
  const isWaiting = (): boolean => pairing.state === 'waiting_for_approval'
  const view = (): SettingsFixtureReply => ({ ok: true, result: status })

  function pollPairing(): SettingsFixtureReply {
    if (!isWaiting()) {
      return { ok: true, result: pairing }
    }
    polls += 1
    pairing = nextPoll(variant, polls, pairing)
    if (pairing.state === 'paired') {
      const now = Date.now()
      const pairedAt = new Date(now).toISOString()
      const pairedUntil = new Date(now + PAIRING_LIFETIME_MS).toISOString()
      status = withState(
        {
          ...status,
          pairing: {
            deviceId: 'dev_0123456789abcdef01234567',
            generation: 1,
            pairedAt,
            pairedUntil
          },
          lastSyncAt: pairedAt
        },
        false
      )
    } else if (!isWaiting()) {
      status = withState(status, false)
    }
    return { ok: true, result: pairing }
  }

  function setConnection(params: unknown): SettingsFixtureReply {
    if (variant === 'refusals') {
      return refused(DOT_REMOTE_RPC_ERROR_CODES.tokenInvalid)
    }
    if (variant === 'sealingUnavailable') {
      return refused(DOT_REMOTE_RPC_ERROR_CODES.sealingUnavailable)
    }
    const origin = originOf(params)
    if (origin === null) {
      return refused(DOT_REMOTE_RPC_ERROR_CODES.originInvalid)
    }
    // Why: a newly saved token answers only the token stops, as the real agent does.
    const reason = status.reconnectReason
    const tokenStop = reason !== null && dotRemoteStateOfReason(reason) === 'reconnect_needed'
    status = withState(
      { ...status, origin, serviceToken: 'sealed', reconnectReason: tokenStop ? null : reason },
      isWaiting()
    )
    return view()
  }

  function startPairing(): SettingsFixtureReply {
    if (variant === 'refusals') {
      return refused(DOT_REMOTE_RPC_ERROR_CODES.siteUnreachable)
    }
    polls = 0
    pairing = fixtureWaitingPairing(new Date(Date.now() + PAIRING_TTL_MS).toISOString())
    status = withState({ ...status, reconnectReason: null }, true)
    return { ok: true, result: { pairing, status } }
  }

  function revoke(): SettingsFixtureReply {
    pairing = fixtureEndedPairing('idle')
    status = withState({ ...status, pairing: null, reconnectReason: null }, false)
    return { ok: true, result: { siteConfirmed: variant !== 'offline', status } }
  }

  return (method, params) => {
    if (!method.startsWith('workbench.dotRemote.')) {
      return null
    }
    if (variant === 'notConnected') {
      return refused('method_not_found')
    }
    switch (method) {
      case 'workbench.dotRemote.status':
        return view()
      case 'workbench.dotRemote.enable':
        status = withState({ ...status, enabled: true }, isWaiting())
        return view()
      case 'workbench.dotRemote.disable':
        pairing = fixtureEndedPairing('idle')
        status = withState({ ...status, enabled: false }, false)
        return view()
      case 'workbench.dotRemote.setConnection':
        return setConnection(params)
      case 'workbench.dotRemote.pairing.start':
        return startPairing()
      case 'workbench.dotRemote.pairing.status':
        return pollPairing()
      case 'workbench.dotRemote.revoke':
        return revoke()
      default:
        return refused('method_not_found')
    }
  }
}
