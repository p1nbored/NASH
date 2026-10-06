import type { z } from 'zod'
import type { DotRemoteDeviceCredentialGrantSchema } from '../../../shared/dot-remote/dot-remote-device-credential'
import type { DotRemoteSessionSchema } from '../../../shared/dot-remote/dot-remote-pairing'
import type { WorkbenchDotRemotePairingView } from '../../../shared/rpc-contract/workbench-dot-remote-params'
import {
  siteFailureOf,
  type DotRemoteSiteClient,
  type DotRemoteSiteCredentials,
  type DotRemoteSiteFailure
} from './dot-remote-site-client'

// RG4: device-code pairing. NASH asks the Site for a short-lived, single-use challenge and shows its
// user code; the signed-in owner approves that code on the Site; NASH polls until the Site issues a
// session and the pairing's device credential. The device code is a secret: it lives only in this
// closure and never reaches a view.

export type DotRemoteIssuedSession = z.infer<typeof DotRemoteSessionSchema>
/** The pairing's device credential; sealed at once and never kept in this module. */
export type DotRemoteDeviceCredentialGrant = z.infer<typeof DotRemoteDeviceCredentialGrantSchema>

type PairingState = WorkbenchDotRemotePairingView['state']

type Waiting = {
  challengeId: string
  userCode: string
  deviceCode: string
  expiresAtMs: number
  pollMs: number
  nextPollAt: number
}

export type DotRemotePairingPoll =
  | { kind: 'waiting' }
  | {
      kind: 'issued'
      session: DotRemoteIssuedSession
      deviceCredential: DotRemoteDeviceCredentialGrant
    }
  | { kind: 'ended' }
  | { kind: 'failure'; failure: DotRemoteSiteFailure }

const ENDED_BY_CODE: Readonly<Record<string, PairingState>> = {
  challenge_denied: 'denied',
  challenge_expired: 'expired',
  challenge_used: 'failed',
  challenge_not_found: 'failed'
}

export function createDotRemotePairing(deps: { now: () => number; appVersion: string }) {
  let state: PairingState = 'idle'
  let waiting: Waiting | null = null

  function end(next: PairingState): DotRemotePairingPoll {
    state = next
    waiting = null
    return { kind: 'ended' }
  }

  function view(): WorkbenchDotRemotePairingView {
    return waiting
      ? {
          state,
          userCode: waiting.userCode,
          expiresAt: new Date(waiting.expiresAtMs).toISOString()
        }
      : { state, userCode: null, expiresAt: null }
  }

  async function start(
    site: DotRemoteSiteClient,
    credentials: DotRemoteSiteCredentials
  ): Promise<{ ok: true } | { ok: false; failure: DotRemoteSiteFailure }> {
    const result = await site.call(
      'pairing.challenge.create',
      { appVersion: deps.appVersion },
      { credentials }
    )
    if (!result.ok) {
      return { ok: false, failure: siteFailureOf(result) }
    }
    const challenge = result.value
    const pollMs = challenge.pollIntervalSeconds * 1000
    state = 'waiting_for_approval'
    waiting = {
      challengeId: challenge.challengeId,
      userCode: challenge.userCode,
      deviceCode: challenge.deviceCode,
      expiresAtMs: Date.parse(challenge.expiresAt),
      pollMs,
      nextPollAt: deps.now() + pollMs
    }
    return { ok: true }
  }

  async function poll(
    site: DotRemoteSiteClient,
    credentials: DotRemoteSiteCredentials,
    signal?: AbortSignal
  ): Promise<DotRemotePairingPoll> {
    const current = waiting
    if (!current) {
      return { kind: 'ended' }
    }
    if (deps.now() >= current.expiresAtMs) {
      return end('expired')
    }
    if (deps.now() < current.nextPollAt) {
      return { kind: 'waiting' }
    }
    const result = await site.call(
      'pairing.session.issue',
      { challengeId: current.challengeId, deviceCode: current.deviceCode },
      { credentials, signal }
    )
    if (waiting !== current) {
      return { kind: 'ended' }
    }
    if (!result.ok) {
      const ended = result.kind === 'site_error' ? ENDED_BY_CODE[result.code] : undefined
      return ended ? end(ended) : { kind: 'failure', failure: siteFailureOf(result) }
    }
    if (result.value.state === 'pending') {
      waiting = { ...current, nextPollAt: deps.now() + result.value.pollIntervalSeconds * 1000 }
      return { kind: 'waiting' }
    }
    end('paired')
    return {
      kind: 'issued',
      session: result.value.session,
      deviceCredential: result.value.deviceCredential
    }
  }

  return {
    view,
    start,
    poll,
    isWaiting: () => waiting !== null,
    /** How long until the next approval check is due. */
    nextPollDelay: () => Math.max(0, (waiting?.nextPollAt ?? deps.now()) - deps.now()),
    cancel: () => {
      waiting = null
      state = 'idle'
    }
  }
}

export type DotRemotePairing = ReturnType<typeof createDotRemotePairing>
