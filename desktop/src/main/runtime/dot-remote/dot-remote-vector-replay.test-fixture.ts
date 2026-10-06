// FIXTURE_ONLY: replays R2's conformance vectors as the Site, through the injected fetch. Each NASH
// step of this device is one scripted exchange: the agent's request is recorded for an exact body
// comparison and answered with the vector's expectation. No port, no network, no real credential.
import { canonicalJson } from '../../../shared/canonical-json'
import { DOT_REMOTE_DEVICE_CREDENTIAL_HEADER } from '../../../shared/dot-remote/dot-remote-device-credential'
import { DOT_REMOTE_ENDPOINTS } from '../../../shared/dot-remote/dot-remote-endpoints'
import {
  DOT_REMOTE_SERVICE_AUTH_HEADER,
  DOT_REMOTE_SESSION_HEADER
} from '../../../shared/dot-remote/dot-remote-pairing'
import {
  DEVICE,
  decisionView,
  type DotRemoteVector
} from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import type { DotRemoteEndpointStep } from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { submittedView } from './dot-remote-agent.test-fixture'
import type { DotRemoteLocalEndpoint, DotRemoteLocalResult } from './dot-remote-local-endpoint'
import type { DotRemoteFetch } from './dot-remote-site-client'

export type ReplayMatch = {
  readonly step: DotRemoteEndpointStep
  readonly sent: unknown
  readonly pathItemId: string | null
  readonly headers: {
    readonly service: boolean
    readonly session: boolean
    /** The Nash-Device-Credential value sent, or null. */
    readonly device: string | null
  }
}

export type ReplaySkip = { readonly step: DotRemoteEndpointStep; readonly reason: string }

type LeasedItem = { itemId: string; kind: string; payload: Record<string, unknown> }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOwnCaller(caller: DotRemoteEndpointStep['caller']): boolean {
  return (
    ('deviceId' in caller && caller.deviceId === DEVICE) ||
    'serviceOnly' in caller ||
    'deviceCredential' in caller
  )
}

/** The NASH steps this device makes; another device's steps belong to the Site's own tests. */
export function ownSteps(vector: DotRemoteVector): DotRemoteEndpointStep[] {
  return vector.steps.flatMap((step) =>
    step.actor === 'nash' && isOwnCaller(step.caller) ? [step] : []
  )
}

/** A vector that pairs NASH (challenge, issue, refresh) rather than using a paired session. */
export function isPairingVector(vector: DotRemoteVector): boolean {
  return ownSteps(vector).some((step) => step.endpoint.startsWith('pairing.session.'))
}

function endpointOf(url: string, method: string | undefined) {
  const path = new URL(url).pathname
  for (const endpoint of DOT_REMOTE_ENDPOINTS) {
    const pattern = new RegExp(`^${endpoint.path.replace('{itemId}', '([^/]+)')}$`)
    const found = pattern.exec(path)
    if (found && endpoint.method === method) {
      return { name: endpoint.name, itemId: found[1] ? decodeURIComponent(found[1]) : null }
    }
  }
  return null
}

function leasedItemsOf(step: DotRemoteEndpointStep): LeasedItem[] {
  const result = 'result' in step.expect ? step.expect.result : null
  const items = isRecord(result) && Array.isArray(result.items) ? result.items : []
  return items.flatMap((item) =>
    isRecord(item) &&
    typeof item.itemId === 'string' &&
    typeof item.kind === 'string' &&
    isRecord(item.payload)
      ? [{ itemId: item.itemId, kind: item.kind, payload: item.payload }]
      : []
  )
}

/** Presence calls a vector does not script are answered as stored; they are not under test there. */
function presenceDefault(name: string, at: string): Response | null {
  if (name === 'heartbeat.post') {
    return json(200, { serverTime: at })
  }
  return name === 'workspaces.put' ? json(200, { storedAt: at }) : null
}

/** `settle: false` moves the clock only through next(), for steps the whole agent drives. */
export function createVectorReplay(vector: DotRemoteVector, options: { settle?: boolean } = {}) {
  const steps = ownSteps(vector)
  let cursor = 0
  let nowMs = Date.parse(steps[0]?.at ?? '2026-10-05T12:00:00.000Z')
  const outstanding = new Set<string>()
  const leased = new Map<string, LeasedItem>()
  const matched: ReplayMatch[] = []
  const skipped: ReplaySkip[] = []
  const unscripted: string[] = []

  /** One consumer holds its leased items until it acks them; it never polls in between (RG5). */
  function skipPolls(): void {
    while (steps[cursor]?.endpoint === 'inbox.lease' && outstanding.size > 0) {
      skipped.push({ step: steps[cursor], reason: 'poll_while_holding_items' })
      cursor += 1
    }
  }

  function settleClock(): void {
    if (options.settle === false) {
      return
    }
    skipPolls()
    const next = steps[cursor]
    if (next) {
      nowMs = Date.parse(next.at)
    }
  }

  const fetch: DotRemoteFetch = async (url, init) => {
    const target = endpointOf(url, init.method)
    const body: unknown = JSON.parse(String(init.body))
    const headers = new Headers(init.headers)
    skipPolls()
    const step = steps[cursor]
    if (!target || !step || step.endpoint !== target.name) {
      unscripted.push(target?.name ?? 'unknown')
      return presenceDefault(target?.name ?? '', new Date(nowMs).toISOString()) ?? json(503, {})
    }
    matched.push({
      step,
      sent: body,
      pathItemId: target.itemId,
      headers: {
        service: headers.has(DOT_REMOTE_SERVICE_AUTH_HEADER),
        session: headers.has(DOT_REMOTE_SESSION_HEADER),
        device: headers.get(DOT_REMOTE_DEVICE_CREDENTIAL_HEADER)
      }
    })
    cursor += 1
    for (const item of leasedItemsOf(step)) {
      outstanding.add(item.itemId)
      leased.set(canonicalJson(item.payload), item)
    }
    if (step.endpoint === 'inbox.ack' && isRecord(body) && typeof body.itemId === 'string') {
      outstanding.delete(body.itemId)
    }
    settleClock()
    return 'result' in step.expect ? json(200, step.expect.result) : json(409, step.expect)
  }

  /** The local dot endpoint answers so that NASH reaches the outcome the vector's ack records. */
  const endpoint: DotRemoteLocalEndpoint = {
    ready: () => true,
    call: async (_method, params): Promise<DotRemoteLocalResult> => {
      const item = leased.get(canonicalJson(params))
      const ack = item
        ? steps.find((step) => step.endpoint === 'inbox.ack' && step.itemId === item.itemId)
        : undefined
      return item && ack ? localAnswer(item, ack.body) : { ok: false, kind: 'unavailable' }
    }
  }

  return {
    steps,
    fetch,
    endpoint,
    matched,
    skipped,
    unscripted,
    now: () => nowMs,
    /** The next scripted step the agent has not made yet, after skipped polls. */
    next: (): DotRemoteEndpointStep | null => {
      skipPolls()
      const step = steps[cursor] ?? null
      if (step) {
        nowMs = Math.max(nowMs, Date.parse(step.at))
      }
      return step
    },
    position: () => cursor,
    skip: (reason: string) => {
      const step = steps[cursor]
      if (step) {
        skipped.push({ step, reason })
        cursor += 1
      }
    }
  }
}

function localAnswer(item: LeasedItem, ack: Record<string, unknown>): DotRemoteLocalResult {
  const refusal = isRecord(ack.refusal) ? ack.refusal : null
  if (ack.outcome === 'refused' && refusal?.by === 'nash' && typeof refusal.code === 'string') {
    return { ok: false, kind: 'refused', code: refusal.code }
  }
  const dotRequestId = typeof ack.dotRequestId === 'string' ? ack.dotRequestId : null
  if (dotRequestId === null || (ack.outcome !== 'accepted' && ack.outcome !== 'duplicate')) {
    return { ok: false, kind: 'unavailable' }
  }
  const duplicate = ack.outcome === 'duplicate'
  const request = { ...submittedView(), dotRequestId }
  switch (item.kind) {
    case 'submit':
      return { ok: true, result: { contractVersion: 3, request, duplicate } }
    case 'cancel':
      return { ok: true, result: { contractVersion: 3, request, changed: true } }
    case 'permission_answer': {
      const decision = decisionView('Bash', 'Bash: git status', 0, false, {
        status: 'denied',
        by: 'dot',
        at: 2
      })
      return {
        ok: true,
        result: { contractVersion: 3, outcome: 'decided', decision: { ...decision, dotRequestId } }
      }
    }
    case 'validation_decision':
      return {
        ok: true,
        result: {
          contractVersion: 3,
          decisionId: item.payload.decisionId,
          validationId: item.payload.validationId,
          dotRequestId,
          outcome: 'decided',
          decidedAt: '2026-10-05T12:00:12.000Z',
          duplicate
        }
      }
    default:
      return {
        ok: true,
        result: {
          contractVersion: 3,
          dotRequestId,
          messageId: item.payload.messageId,
          outcome: 'delivered',
          reason: null,
          duplicate
        }
      }
  }
}
