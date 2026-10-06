// FIXTURE_ONLY: synthetic owners, devices, ids and nonces for the dot remote conformance vectors.
// No value here is a real identity or credential.
import { DOT_REQUEST_STATUS_TEXT } from '../dot-ingress/dot-ingress-status-text'
import { DOT_REMOTE_SUBMIT_TTL_MINUTES } from './dot-remote-defaults'
import { dotRemoteError, type DotRemoteErrorCode } from './dot-remote-errors'
import { DOT_REMOTE_LEASE_SECONDS } from './dot-remote-limits'
import {
  dotRemoteInboxPayload,
  dotRemotePayloadSha256,
  type DotRemoteItemKind
} from './dot-remote-payload'

import type {
  DotRemoteEndpointStep,
  DotRemoteToolStep,
  DotRemoteVector,
  DotRemoteVectorExpect,
  DotRemoteVectorStep
} from './dot-remote-vector-types.test-fixture'

export type {
  DotRemoteEndpointStep,
  DotRemotePairingGenerated,
  DotRemoteToolStep,
  DotRemoteVector,
  DotRemoteVectorBinding,
  DotRemoteVectorExpect,
  DotRemoteVectorStep
} from './dot-remote-vector-types.test-fixture'

const T0_MS = Date.parse('2026-10-05T12:00:00.000Z')
export const TTL_SECONDS = DOT_REMOTE_SUBMIT_TTL_MINUTES * 60
export const OWNER = 'owner-fixture-0001'
export const OTHER_OWNER = 'owner-fixture-0002'
export const DEVICE = 'dev_0123456789abcdef01234567'
export const OTHER_DEVICE = 'dev_fedcba9876543210fedcba98'
export const WORKSPACE = 'dws_0123456789abcdef01234567'
export const BINDING = {
  ownerId: OWNER,
  deviceId: DEVICE,
  dotIdentity: { source: 'sites_mcp_identity', subject: OWNER },
  generation: 1
} as const

export function at(seconds: number): string {
  return new Date(T0_MS + seconds * 1000).toISOString()
}

function fixtureId(prefix: number, n: number): string {
  return `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}
export const itemId = (n: number) => fixtureId(1, n)
export const keyId = (n: number) => fixtureId(2, n)
export const requestId = (n: number) => fixtureId(3, n)
export const decisionId = (n: number) => fixtureId(4, n)
export const messageId = (n: number) => fixtureId(5, n)
export const eventId = (n: number) => fixtureId(6, n)
export const nonce = (n: number) => `FIXTURElease0nonce${String(n).padStart(12, '0')}`

const count = (n: number, make: (index: number) => string) =>
  Array.from({ length: n }, (_, index) => make(index + 1))

export function makeVector(
  id: string,
  covers: string,
  description: string,
  generated: { items: number; nonces: number },
  steps: DotRemoteVectorStep[]
): DotRemoteVector {
  const category = id.startsWith('accepted.')
    ? 'accepted'
    : id.startsWith('pairing.')
      ? 'pairing'
      : id.startsWith('race.')
        ? 'race'
        : 'error'
  const ids = {
    itemIds: count(generated.items, itemId),
    leaseNonces: count(generated.nonces, nonce)
  }
  return { id, category, covers, description, binding: BINDING, generated: ids, steps }
}

export const ok = (result: unknown): DotRemoteVectorExpect => ({ result })
export const fail = (code: DotRemoteErrorCode): DotRemoteVectorExpect => dotRemoteError(code)

export function dot(
  seconds: number,
  tool: string,
  args: Record<string, unknown>,
  expect: DotRemoteVectorExpect,
  ownerId = OWNER
): DotRemoteToolStep {
  return { actor: 'dot', at: at(seconds), caller: { ownerId }, tool, arguments: args, expect }
}

export function nash(
  seconds: number,
  endpoint: string,
  body: Record<string, unknown>,
  expect: DotRemoteVectorExpect,
  options: { itemId?: string; deviceId?: string; generation?: number } = {}
): DotRemoteEndpointStep {
  const caller = { deviceId: options.deviceId ?? DEVICE, generation: options.generation ?? 1 }
  const path = options.itemId === undefined ? {} : { itemId: options.itemId }
  return { actor: 'nash', at: at(seconds), caller, endpoint, ...path, body, expect }
}

const OBJECTIVES = [
  'List the open issues in the "docs" folder and summarize each in one sentence.',
  'Check which pages in the "guide" folder have broken links.',
  'Count the TODO comments in the `src` folder.'
]

export function submitArgs(
  n: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    workspaceRef: WORKSPACE,
    objective: OBJECTIVES[(n - 1) % OBJECTIVES.length],
    idempotencyKey: keyId(n),
    ...overrides
  }
}

export function payloadOf(
  kind: DotRemoteItemKind,
  input: Record<string, unknown>
): Record<string, unknown> {
  return dotRemoteInboxPayload(kind, input)
}

type ReceiptSpec = {
  readonly item: number
  readonly kind: DotRemoteItemKind
  readonly state: string
  readonly created: number
  readonly updated: number
  readonly payload: Record<string, unknown> | null
  readonly dependsOn?: number
  readonly request?: number
  readonly expires?: number
  readonly extra?: Record<string, unknown>
}

export function receipt(spec: ReceiptSpec): Record<string, unknown> {
  return {
    itemId: itemId(spec.item),
    kind: spec.kind,
    state: spec.state,
    payloadSha256: spec.payload === null ? null : dotRemotePayloadSha256(spec.payload),
    dependsOnItemId: spec.dependsOn === undefined ? null : itemId(spec.dependsOn),
    dotRequestId: spec.request === undefined ? null : requestId(spec.request),
    createdAt: at(spec.created),
    expiresAt: at(spec.expires ?? spec.created + TTL_SECONDS),
    updatedAt: at(spec.updated),
    ...spec.extra
  }
}

type LeasedSpec = {
  readonly item: number
  readonly kind: DotRemoteItemKind
  readonly payload: Record<string, unknown>
  readonly created: number
  readonly leased: number
  readonly nonce: number
  readonly dependsOn?: number
  readonly expires?: number
}

export function leased(spec: LeasedSpec): Record<string, unknown> {
  return {
    itemId: itemId(spec.item),
    kind: spec.kind,
    payload: spec.payload,
    payloadSha256: dotRemotePayloadSha256(spec.payload),
    dependsOnItemId: spec.dependsOn === undefined ? null : itemId(spec.dependsOn),
    createdAt: at(spec.created),
    expiresAt: at(spec.expires ?? spec.created + TTL_SECONDS),
    lease: {
      leaseNonce: nonce(spec.nonce),
      generation: 1,
      leaseExpiresAt: at(spec.leased + DOT_REMOTE_LEASE_SECONDS)
    }
  }
}

export function leaseStep(
  seconds: number,
  items: Record<string, unknown>[],
  options = {}
): DotRemoteEndpointStep {
  return nash(
    seconds,
    'inbox.lease',
    { generation: 1, maxItems: 10 },
    ok({ generation: 1, serverTime: at(seconds), items }),
    options
  )
}

export function ackStep(
  seconds: number,
  item: number,
  leaseNonce: number,
  payload: Record<string, unknown>,
  outcome: Record<string, unknown>,
  receiptState: string
): DotRemoteEndpointStep {
  const body = {
    itemId: itemId(item),
    leaseNonce: nonce(leaseNonce),
    generation: 1,
    payloadSha256: dotRemotePayloadSha256(payload),
    ackedAt: at(seconds),
    ...outcome
  }
  return nash(
    seconds,
    'inbox.ack',
    body,
    ok({ itemId: itemId(item), recorded: 'applied', receiptState }),
    { itemId: itemId(item) }
  )
}

export function statusEvent(
  n: number,
  revision: number,
  seconds: number,
  run: string | null
): Record<string, unknown> {
  const data =
    run === null
      ? { state: 'canceled', statusText: DOT_REQUEST_STATUS_TEXT.canceled, run: null }
      : {
          state: 'submitted',
          statusText: DOT_REQUEST_STATUS_TEXT.submitted,
          run: { state: run, blocker: null }
        }
  return {
    eventId: eventId(n),
    kind: 'request_status',
    dotRequestId: requestId(1),
    sourceRevision: revision,
    at: at(seconds),
    data
  }
}

export function decisionView(
  tool: string,
  summary: string,
  opened: number,
  dotMayAllow: boolean,
  decided?: { status: string; by: string; at: number }
) {
  return {
    decisionId: decisionId(1),
    dotRequestId: requestId(1),
    toolName: tool,
    agentId: null,
    summary,
    status: decided?.status ?? 'pending',
    decidedBy: decided?.by ?? null,
    createdAt: at(opened),
    deadlineAt: at(opened + 240),
    decidedAt: decided === undefined ? null : at(decided.at),
    dotMayAllow
  }
}

export function event(
  n: number,
  kind: string,
  revision: number,
  seconds: number,
  data: unknown
): Record<string, unknown> {
  return {
    eventId: eventId(n),
    kind,
    dotRequestId: requestId(1),
    sourceRevision: revision,
    at: at(seconds),
    data
  }
}
