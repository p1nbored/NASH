// FIXTURE_ONLY: an in-process fake of the hosted mailbox, reached only through the injected fetch.
// It implements just enough of R2's rules (service access, pairing, sessions, generations, leases,
// acks, events, presence) to drive the sync agent; it opens no port and stores nothing on disk.
import { DotRemoteAckRequestSchema } from '../../../shared/dot-remote/dot-remote-ack'
import {
  dotRemoteError,
  type DotRemoteErrorCode
} from '../../../shared/dot-remote/dot-remote-errors'
import { DotRemoteLeaseRenewRequestSchema } from '../../../shared/dot-remote/dot-remote-inbox'
import {
  dotRemotePayloadSha256,
  type DotRemoteItemKind
} from '../../../shared/dot-remote/dot-remote-payload'
import {
  DotRemoteHeartbeatRequestSchema,
  DotRemoteWorkspaceListRequestSchema
} from '../../../shared/dot-remote/dot-remote-presence'
import { createFakeDeviceCredentials } from './dot-remote-fake-site-credentials.test-fixture'
import { createFakeEventFold } from './dot-remote-fake-site-events.test-fixture'
import type { DotRemoteFetch } from './dot-remote-site-client'
import { FIXTURE_DEVICE, FIXTURE_SERVICE_VALUE } from './dot-remote.test-fixture'

const SESSION_TTL_MS = 15 * 60_000
const RENEW_AFTER_MS = 10 * 60_000
const LEASE_MS = 60_000
const USER_CODE = 'BCDF-GHJK'

type Item = {
  itemId: string
  kind: DotRemoteItemKind
  payload: Record<string, unknown>
  dependsOnItemId: string | null
  createdAt: string
  expiresAt: string
  state: 'queued' | 'claimed' | 'acked'
  lease: { leaseNonce: string; generation: number; leaseExpiresAt: string } | null
}

type Handler = (body: unknown, request: { itemId: string | null }) => Response

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const appError = (status: number, code: DotRemoteErrorCode) => json(status, dotRemoteError(code))

export function createFakeSite(now: () => number) {
  const iso = (ms = now()) => new Date(ms).toISOString()
  let serviceAccepted = true
  let generation = 1
  let challenge: { challengeId: string; deviceCode: string; approved: boolean | null } | null = null
  let session: { token: string; expiresAt: number; generation: number } | null = null
  let sequence = 0
  let items: Item[] = []
  const acks: unknown[] = []
  const fold = createFakeEventFold()
  const heartbeats: unknown[] = []
  const workspaceLists: unknown[] = []
  const calls: string[] = []
  const failures = new Map<string, Response[]>()
  const devices = createFakeDeviceCredentials(now)

  const next = (prefix: number) =>
    `${prefix}0000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  const token = () => `FIXTURE0session0${String(++sequence).padStart(4, '0')}${'0'.repeat(27)}`

  /** Session times are capped at the pairing's lifetime end, as R2's rule says. */
  function issueSession() {
    const end = devices.lifetimeEndsAt()
    session = { token: token(), expiresAt: Math.min(now() + SESSION_TTL_MS, end), generation }
    return {
      sessionToken: session.token,
      expiresAt: iso(session.expiresAt),
      renewAfter: iso(Math.min(now() + RENEW_AFTER_MS, end)),
      deviceId: FIXTURE_DEVICE,
      generation
    }
  }

  /** The session check of every NASH endpoint but pairing; null when the call may proceed. */
  function sessionRefusal(headers: Headers, bodyGeneration: unknown): Response | null {
    if (!session || headers.get('nash-session') !== session.token) {
      return appError(401, 'unauthorized')
    }
    if (session.generation !== generation || bodyGeneration !== generation) {
      return appError(409, 'generation_revoked')
    }
    return now() >= session.expiresAt ? appError(401, 'session_expired') : null
  }

  function lease(): Response {
    const at = now()
    items = items.map((item) =>
      item.state === 'claimed' && item.lease && Date.parse(item.lease.leaseExpiresAt) <= at
        ? { ...item, state: 'queued', lease: null }
        : item
    )
    const leased = items
      .filter((item) => item.state === 'queued')
      .slice(0, 10)
      .map((item) => ({
        ...item,
        state: 'claimed' as const,
        lease: {
          leaseNonce: `FIXTURElease0nonce${String(++sequence).padStart(12, '0')}`,
          generation,
          leaseExpiresAt: iso(at + LEASE_MS)
        }
      }))
    items = items.map((item) => leased.find((entry) => entry.itemId === item.itemId) ?? item)
    return json(200, {
      generation,
      serverTime: iso(at),
      items: leased.map(({ state: _state, lease: itemLease, ...rest }) => ({
        ...rest,
        payloadSha256: dotRemotePayloadSha256(rest.payload),
        lease: itemLease
      }))
    })
  }

  function ack(body: unknown, itemId: string | null): Response {
    const ackBody = DotRemoteAckRequestSchema.parse(body)
    const item = items.find((entry) => entry.itemId === itemId)
    if (!item || item.lease?.leaseNonce !== ackBody.leaseNonce) {
      return appError(409, 'lease_lost')
    }
    acks.push(ackBody)
    items = items.map((entry) => (entry.itemId === itemId ? { ...entry, state: 'acked' } : entry))
    return json(200, {
      itemId,
      recorded: 'applied',
      receiptState:
        ackBody.outcome === 'expired'
          ? 'expired'
          : ackBody.outcome === 'refused'
            ? 'refused'
            : 'accepted'
    })
  }

  const SESSION_ROUTES: Record<string, Handler> = {
    'POST /nash/v1/session/renew': () =>
      devices.expired() ? appError(401, 'pairing_expired') : json(200, { session: issueSession() }),
    'POST /nash/v1/pairing/revoke': () => {
      const revokedGeneration = generation
      generation += 1
      session = null
      return json(200, { revokedGeneration })
    },
    'POST /nash/v1/inbox/lease': () => lease(),
    'POST /nash/v1/inbox/ack': (body, request) => ack(body, request.itemId),
    'POST /nash/v1/inbox/renew': (body) => {
      const { itemId, leaseNonce } = DotRemoteLeaseRenewRequestSchema.parse(body)
      return json(200, { itemId, leaseNonce, leaseExpiresAt: iso(now() + LEASE_MS) })
    },
    'POST /nash/v1/events': (body) => json(200, fold.post(body)),
    'PUT /nash/v1/workspaces': (body) => {
      workspaceLists.push(DotRemoteWorkspaceListRequestSchema.parse(body))
      return json(200, { storedAt: iso() })
    },
    'POST /nash/v1/heartbeat': (body) => {
      heartbeats.push(DotRemoteHeartbeatRequestSchema.parse(body))
      return json(200, { serverTime: iso() })
    }
  }

  function pairingRoute(route: string, body: Record<string, unknown>): Response {
    if (route === 'POST /nash/v1/pairing/challenges') {
      challenge = { challengeId: next(7), deviceCode: 'D'.repeat(43), approved: null }
      const { challengeId, deviceCode } = challenge
      return json(200, {
        challengeId,
        userCode: USER_CODE,
        deviceCode,
        expiresAt: iso(now() + 600_000),
        pollIntervalSeconds: 5
      })
    }
    if (
      !challenge ||
      body.challengeId !== challenge.challengeId ||
      body.deviceCode !== challenge.deviceCode
    ) {
      return appError(404, 'challenge_not_found')
    }
    if (challenge.approved === null) {
      return json(200, { state: 'pending', pollIntervalSeconds: 5 })
    }
    if (!challenge.approved) {
      return appError(403, 'challenge_denied')
    }
    challenge = null
    const deviceCredential = devices.issue()
    return json(200, { state: 'issued', session: issueSession(), deviceCredential })
  }

  function refresh(headers: Headers, bodyGeneration: unknown): Response {
    const outcome = devices.refresh(
      headers.get('nash-device-credential'),
      bodyGeneration === generation
    )
    if (outcome.kind === 'error') {
      if (outcome.revoke) {
        generation += 1
        session = null
      }
      return appError(409, outcome.code)
    }
    const deviceCredential = { credential: outcome.credential, expiresAt: devices.expiresAt() }
    return json(200, { session: issueSession(), deviceCredential })
  }

  function route(
    method: string,
    url: URL,
    headers: Headers,
    body: Record<string, unknown>
  ): Response {
    const itemMatch = /^\/nash\/v1\/inbox\/([0-9a-f-]{36})\/(ack|renew)$/.exec(url.pathname)
    const path = itemMatch ? `/nash/v1/inbox/${itemMatch[2]}` : url.pathname
    const key = `${method} ${path}`
    calls.push(key)
    const queued = failures.get(key)
    if (queued && queued.length > 0) {
      return queued.shift() ?? json(500, {})
    }
    if (
      !serviceAccepted ||
      headers.get('oai-sites-authorization') !== `Bearer ${FIXTURE_SERVICE_VALUE}`
    ) {
      return new Response('Forbidden', { status: 403 })
    }
    if (key === 'POST /nash/v1/session/refresh') {
      return headers.get('nash-session') ? json(400, {}) : refresh(headers, body.generation)
    }
    if (
      key.startsWith('POST /nash/v1/pairing/challenges') ||
      key === 'POST /nash/v1/pairing/session'
    ) {
      return headers.get('nash-session') ? json(400, {}) : pairingRoute(key, body)
    }
    const handler = SESSION_ROUTES[key]
    if (!handler) {
      return json(404, {})
    }
    return (
      sessionRefusal(headers, body.generation) ?? handler(body, { itemId: itemMatch?.[1] ?? null })
    )
  }

  const fetch: DotRemoteFetch = async (url, init) => {
    init.signal?.throwIfAborted()
    const parsed: unknown = JSON.parse(String(init.body ?? '{}'))
    const body =
      parsed !== null && typeof parsed === 'object'
        ? Object.fromEntries(Object.entries(parsed))
        : {}
    return route(String(init.method), new URL(url), new Headers(init.headers), body)
  }

  return {
    fetch,
    calls,
    devices,
    acks,
    events: fold.events,
    heartbeats,
    workspaceLists,
    approve: (approved = true) => {
      if (challenge) {
        challenge = { ...challenge, approved }
      }
    },
    enqueue: (
      kind: DotRemoteItemKind,
      payload: Record<string, unknown>,
      options: { dependsOnItemId?: string; ttlMs?: number } = {}
    ) => {
      const item: Item = {
        itemId: next(1),
        kind,
        payload,
        dependsOnItemId: options.dependsOnItemId ?? null,
        createdAt: iso(),
        expiresAt: iso(now() + (options.ttlMs ?? 30 * 60_000)),
        state: 'queued',
        lease: null
      }
      items = [...items, item]
      return item.itemId
    },
    revokeOnSite: () => {
      generation += 1
    },
    rejectServiceToken: () => {
      serviceAccepted = false
    },
    failNext: (key: string, response: Response) => {
      failures.set(key, [...(failures.get(key) ?? []), response])
    },
    generation: () => generation
  }
}

export type FakeSite = ReturnType<typeof createFakeSite>
