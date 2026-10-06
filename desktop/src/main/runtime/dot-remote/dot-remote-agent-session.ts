import type {
  DotRemotePairAgainReason,
  DotRemoteReconnectReason,
  DotRemoteTokenReconnectReason
} from '../../../shared/rpc-contract/workbench-dot-remote-params'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { DotRemoteBinding } from './dot-remote-consumer'
import {
  DotRemoteSessionToken,
  type DotRemoteCredentialSource,
  type DotRemoteDeviceCredential,
  type DotRemoteServiceToken
} from './dot-remote-credentials'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import type { DotRemoteDeviceCredentialGrant, DotRemoteIssuedSession } from './dot-remote-pairing'
import { getDotRemoteRequestStore } from './dot-remote-request-store'
import { resumeDotRemoteSession } from './dot-remote-session-resume'
import { getDotRemoteSettingsStore, type DotRemotePairingRecord } from './dot-remote-settings-store'
import {
  siteFailureOf,
  type DotRemoteSiteClient,
  type DotRemoteSiteFailure
} from './dot-remote-site-client'

// The app session and the pairing generation it belongs to. The session token lives only here, in
// memory; the pairing's device credential is sealed, so after a restart or a lost session the agent
// refreshes instead of asking the owner again. Fencing a generation (revocation, an ended pairing, an
// origin change) stops every later lease, ack and event of it at once and deletes its credential.

type LiveSession = {
  token: DotRemoteSessionToken
  expiresAtMs: number
  renewAfterMs: number
  deviceId: string
  generation: number
}

const TOKEN_REASONS: ReadonlySet<DotRemoteReconnectReason> = new Set([
  'service_token_missing',
  'service_token_rejected'
])

export function createDotRemoteSessionHolder(deps: {
  readonly owner: OrchestrationDb
  readonly credentials: DotRemoteCredentialSource
  readonly site: DotRemoteSiteClient
  readonly now: () => number
}) {
  const settings = getDotRemoteSettingsStore(deps.owner)
  const outbox = getDotRemoteOutboxStore(deps.owner)
  const requests = getDotRemoteRequestStore(deps.owner)
  const iso = (): string => new Date(deps.now()).toISOString()
  let session: LiveSession | null = null
  let offline = false
  let reason: DotRemoteReconnectReason | null = null
  // Why: a session the Site refuses right after a refresh must not start a refresh loop.
  let unprovenRefresh = false

  function serviceToken(): DotRemoteServiceToken | null {
    try {
      return deps.credentials.read()
    } catch {
      return null
    }
  }

  function deviceCredential(): DotRemoteDeviceCredential | null {
    try {
      return deps.credentials.readDevice()
    } catch {
      return null
    }
  }

  function requireReconnect(next: DotRemoteTokenReconnectReason): void {
    session = null
    offline = false
    reason = next
  }

  /** The live pairing of the current origin, when nothing stops the agent and no session is held. */
  function resumableRecord(): DotRemotePairingRecord | null {
    const record = settings.getPairing()
    const origin = settings.getSettings().origin
    const live = record !== null && record.revokedAt === null && record.origin === origin
    return live && reason === null && session === null ? record : null
  }

  function binding(): DotRemoteBinding | null {
    if (reason !== null || !session) {
      return null
    }
    if (deps.now() >= session.expiresAtMs) {
      // Why no reason: the device credential refreshes an expired session on the next poll.
      session = null
      return null
    }
    const service = serviceToken()
    if (!service) {
      requireReconnect('service_token_missing')
      return null
    }
    return { credentials: { service, session: session.token }, generation: session.generation }
  }

  function adopt(issued: DotRemoteIssuedSession): void {
    session = {
      token: new DotRemoteSessionToken(issued.sessionToken),
      expiresAtMs: Date.parse(issued.expiresAt),
      renewAfterMs: Date.parse(issued.renewAfter),
      deviceId: issued.deviceId,
      generation: issued.generation
    }
    reason = null
    offline = false
  }

  /** Fences the live generation on the PC and deletes its device credential. */
  function fence(next: DotRemotePairAgainReason | null): void {
    const record = settings.getPairing()
    const generation =
      session?.generation ?? (record && record.revokedAt === null ? record.generation : null)
    session = null
    offline = false
    unprovenRefresh = false
    reason = next
    deps.credentials.clearDevice()
    if (generation === null) {
      return
    }
    const timestamp = iso()
    settings.markRevoked(generation, timestamp)
    outbox.fenceGeneration(generation, timestamp)
    requests.closeGeneration(generation, timestamp)
  }

  /** A new pairing: its credential is sealed before the session is used, or the pairing is dropped. */
  function install(
    issued: DotRemoteIssuedSession,
    grant: DotRemoteDeviceCredentialGrant,
    origin: string | null
  ): boolean {
    if (origin === null) {
      return false
    }
    const timestamp = iso()
    const { deviceId, generation } = issued
    settings.recordPairing({
      origin,
      deviceId,
      generation,
      lifetimeEndsAt: grant.expiresAt,
      timestamp
    })
    outbox.fenceOtherGenerations(generation, timestamp)
    requests.closeOtherGenerations(generation, timestamp)
    session = null
    if (!deps.credentials.saveDevice(grant.credential).ok) {
      fence('device_credential_unsaved')
      return false
    }
    adopt(issued)
    unprovenRefresh = false
    return true
  }

  /** Renewal carries the generation only; the session token travels in its header. */
  async function renewIfDue(signal?: AbortSignal): Promise<DotRemoteSiteFailure | null> {
    const current = binding()
    if (!current || !session || deps.now() < session.renewAfterMs) {
      return null
    }
    const result = await deps.site.call(
      'pairing.session.renew',
      { generation: current.generation },
      { credentials: current.credentials, signal }
    )
    if (!result.ok) {
      return siteFailureOf(result)
    }
    const renewed = result.value.session
    if (
      !session ||
      renewed.generation !== session.generation ||
      renewed.deviceId !== session.deviceId
    ) {
      return { kind: 'site_error', code: 'generation_revoked' }
    }
    session = {
      ...session,
      token: new DotRemoteSessionToken(renewed.sessionToken),
      expiresAtMs: Date.parse(renewed.expiresAt),
      renewAfterMs: Date.parse(renewed.renewAfter)
    }
    return null
  }

  /** Refreshes a resumable pairing; runs to its end even when polling stops meanwhile. */
  async function resume(): Promise<DotRemoteSiteFailure | null> {
    const outcome = await resumeDotRemoteSession({
      site: deps.site,
      record: resumableRecord(),
      service: serviceToken,
      device: deviceCredential,
      stillResumable: (record) => {
        const now = resumableRecord()
        return now !== null && now.generation === record.generation
      },
      save: (credential) => deps.credentials.saveDevice(credential).ok
    })
    switch (outcome.kind) {
      case 'idle':
        return null
      case 'failure':
        return outcome.failure
      case 'no_service_token':
        requireReconnect('service_token_missing')
        return null
      case 'ended':
        fence(outcome.reason)
        return null
      case 'resumed':
        adopt(outcome.session)
        unprovenRefresh = true
        return null
    }
  }

  async function revokeOnSite(): Promise<boolean> {
    const current = binding()
    if (!current) {
      return false
    }
    const result = await deps.site.call(
      'pairing.revoke',
      { generation: current.generation },
      { credentials: current.credentials }
    )
    return result.ok
  }

  return {
    reconnectReason: () => reason,
    requireReconnect,
    clearReconnect: () => {
      reason = null
    },
    /** A newly pasted token answers only the reasons the old token caused. */
    clearTokenReconnect: () => {
      reason = reason !== null && TOKEN_REASONS.has(reason) ? null : reason
    },
    serviceToken,
    binding,
    install,
    renewIfDue,
    resume,
    resumable: () => resumableRecord() !== null,
    /** The Site refused the session: resume it, unless a fresh refresh was refused already. */
    sessionLost: () => {
      if (unprovenRefresh) {
        fence('session_rejected')
        return
      }
      session = null
    },
    /** A full poll succeeded with the current session. */
    markHealthy: () => {
      unprovenRefresh = false
      offline = false
    },
    fence,
    revokeOnSite,
    generation: () => session?.generation ?? null,
    hasSession: () => session !== null,
    isOffline: () => offline,
    setOffline: (value: boolean) => {
      offline = value
    }
  }
}

export type DotRemoteSessionHolder = ReturnType<typeof createDotRemoteSessionHolder>
