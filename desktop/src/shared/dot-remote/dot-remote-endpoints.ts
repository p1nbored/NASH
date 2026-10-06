import type { z } from 'zod'
import { DOT_REMOTE_ENVELOPE_FAMILIES } from './dot-remote-envelope-families'
import { DOT_REMOTE_DEVICE_CREDENTIAL_HEADER } from './dot-remote-device-credential'
import type { DOT_REMOTE_ENDPOINT_ERROR_CODES } from './dot-remote-errors'
import { DOT_REMOTE_OWNER_PAGES } from './dot-remote-owner-pages'
import {
  DOT_REMOTE_OWNER_IDENTITY_HEADER,
  DOT_REMOTE_SERVICE_AUTH_HEADER,
  DOT_REMOTE_SESSION_HEADER
} from './dot-remote-pairing'

// The hosted HTTP surface NASH (and the signed-in owner, for approval and revocation) calls. Every call
// starts on the PC; the PC opens no port. Request and response bodies point into the goldens.

type EndpointErrorCode = (typeof DOT_REMOTE_ENDPOINT_ERROR_CODES)[number]
type SchemaRef = { readonly file: string; readonly key: string }

export type DotRemoteEndpoint = {
  readonly name: string
  readonly method: 'POST' | 'PUT'
  readonly path: string
  readonly caller: 'nash' | 'owner'
  readonly auth: readonly ('service' | 'session' | 'device_credential' | 'owner_identity')[]
  readonly request: SchemaRef
  readonly response: SchemaRef
  readonly errors: readonly EndpointErrorCode[]
}

const PAIRING = 'dot-remote-pairing.schema.json'
const INBOX = 'dot-remote-inbox.schema.json'
const ACK = 'dot-remote-ack.schema.json'
const EVENTS = 'dot-remote-events.schema.json'
const PRESENCE = 'dot-remote-presence.schema.json'

const SERVICE_ONLY = ['service'] as const
const SESSION = ['service', 'session'] as const
const SESSION_ERRORS = [
  'unauthorized',
  'payload_invalid',
  'rate_limited',
  'session_expired',
  'generation_revoked'
] as const

function ref(file: string, key: string): SchemaRef {
  return { file, key }
}

export { DOT_REMOTE_OWNER_PAGES }

export const DOT_REMOTE_ENDPOINTS: readonly DotRemoteEndpoint[] = [
  {
    name: 'pairing.challenge.create',
    method: 'POST',
    path: '/nash/v1/pairing/challenges',
    caller: 'nash',
    auth: SERVICE_ONLY,
    request: ref(PAIRING, 'challenge.request'),
    response: ref(PAIRING, 'challenge.response'),
    errors: ['payload_invalid', 'rate_limited']
  },
  {
    name: 'pairing.approve',
    method: 'POST',
    path: '/pairing/approve',
    caller: 'owner',
    auth: ['owner_identity'],
    request: ref(PAIRING, 'approval.request'),
    response: ref(PAIRING, 'approval.response'),
    errors: [
      'unauthorized',
      'payload_invalid',
      'challenge_not_found',
      'challenge_expired',
      'challenge_used'
    ]
  },
  {
    name: 'pairing.session.issue',
    method: 'POST',
    path: '/nash/v1/pairing/session',
    caller: 'nash',
    auth: SERVICE_ONLY,
    request: ref(PAIRING, 'session.issue.request'),
    response: ref(PAIRING, 'session.issue.response'),
    errors: [
      'payload_invalid',
      'rate_limited',
      'challenge_not_found',
      'challenge_expired',
      'challenge_used',
      'challenge_denied'
    ]
  },
  {
    name: 'pairing.session.renew',
    method: 'POST',
    path: '/nash/v1/session/renew',
    caller: 'nash',
    auth: SESSION,
    request: ref(PAIRING, 'session.renew.request'),
    response: ref(PAIRING, 'session.renew.response'),
    errors: [...SESSION_ERRORS, 'pairing_expired']
  },
  {
    name: 'pairing.session.refresh',
    method: 'POST',
    path: '/nash/v1/session/refresh',
    caller: 'nash',
    auth: ['service', 'device_credential'],
    request: ref(PAIRING, 'session.refresh.request'),
    response: ref(PAIRING, 'session.refresh.response'),
    errors: [
      'payload_invalid',
      'rate_limited',
      'device_credential_invalid',
      'device_credential_reused',
      'pairing_expired',
      'generation_revoked'
    ]
  },
  {
    name: 'pairing.revoke',
    method: 'POST',
    path: '/nash/v1/pairing/revoke',
    caller: 'nash',
    auth: SESSION,
    request: ref(PAIRING, 'revoke.request'),
    response: ref(PAIRING, 'revoke.response'),
    errors: SESSION_ERRORS
  },
  {
    name: 'pairing.owner.revoke',
    method: 'POST',
    path: '/pairing/revoke',
    caller: 'owner',
    auth: ['owner_identity'],
    request: ref(PAIRING, 'revoke.request'),
    response: ref(PAIRING, 'revoke.response'),
    errors: ['unauthorized', 'payload_invalid', 'generation_revoked']
  },
  {
    name: 'inbox.lease',
    method: 'POST',
    path: '/nash/v1/inbox/lease',
    caller: 'nash',
    auth: SESSION,
    request: ref(INBOX, 'lease.request'),
    response: ref(INBOX, 'lease.response'),
    errors: SESSION_ERRORS
  },
  {
    name: 'inbox.renew',
    method: 'POST',
    path: '/nash/v1/inbox/{itemId}/renew',
    caller: 'nash',
    auth: SESSION,
    request: ref(INBOX, 'lease.renew.request'),
    response: ref(INBOX, 'lease.renew.response'),
    errors: [...SESSION_ERRORS, 'lease_lost']
  },
  {
    name: 'inbox.ack',
    method: 'POST',
    path: '/nash/v1/inbox/{itemId}/ack',
    caller: 'nash',
    auth: SESSION,
    request: ref(ACK, 'ack.request'),
    response: ref(ACK, 'ack.response'),
    errors: [...SESSION_ERRORS, 'lease_lost', 'ack_conflict']
  },
  {
    name: 'events.post',
    method: 'POST',
    path: '/nash/v1/events',
    caller: 'nash',
    auth: SESSION,
    request: ref(EVENTS, 'events.request'),
    response: ref(EVENTS, 'events.response'),
    errors: SESSION_ERRORS
  },
  {
    name: 'workspaces.put',
    method: 'PUT',
    path: '/nash/v1/workspaces',
    caller: 'nash',
    auth: SESSION,
    request: ref(PRESENCE, 'workspaces.request'),
    response: ref(PRESENCE, 'workspaces.response'),
    errors: SESSION_ERRORS
  },
  {
    name: 'heartbeat.post',
    method: 'POST',
    path: '/nash/v1/heartbeat',
    caller: 'nash',
    auth: SESSION,
    request: ref(PRESENCE, 'heartbeat.request'),
    response: ref(PRESENCE, 'heartbeat.response'),
    errors: SESSION_ERRORS
  }
]

function schemaAt(target: SchemaRef): z.ZodType {
  const schema = DOT_REMOTE_ENVELOPE_FAMILIES[target.file]?.[target.key]
  if (!schema) {
    throw new Error(`No schema ${target.key} in ${target.file}.`)
  }
  return schema
}

export function dotRemoteEndpointSchemas(endpoint: DotRemoteEndpoint): {
  request: z.ZodType
  response: z.ZodType
} {
  return { request: schemaAt(endpoint.request), response: schemaAt(endpoint.response) }
}

export function buildDotRemoteEndpointTable() {
  return {
    tableVersion: 1,
    headers: {
      service: DOT_REMOTE_SERVICE_AUTH_HEADER,
      session: DOT_REMOTE_SESSION_HEADER,
      deviceCredential: DOT_REMOTE_DEVICE_CREDENTIAL_HEADER,
      ownerIdentity: DOT_REMOTE_OWNER_IDENTITY_HEADER
    },
    errorSchema: `${ACK}#/properties/error.endpoint`,
    ownerPages: DOT_REMOTE_OWNER_PAGES,
    endpoints: DOT_REMOTE_ENDPOINTS.map((endpoint) => ({
      ...endpoint,
      request: `${endpoint.request.file}#/properties/${endpoint.request.key}`,
      response: `${endpoint.response.file}#/properties/${endpoint.response.key}`
    }))
  }
}
