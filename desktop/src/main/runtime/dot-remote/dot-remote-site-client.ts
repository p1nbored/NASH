import type { z } from 'zod'
import {
  DotRemoteAckRequestSchema,
  DotRemoteAckResponseSchema
} from '../../../shared/dot-remote/dot-remote-ack'
import { DOT_REMOTE_DEVICE_CREDENTIAL_HEADER } from '../../../shared/dot-remote/dot-remote-device-credential'
import { DOT_REMOTE_ENDPOINTS } from '../../../shared/dot-remote/dot-remote-endpoints'
import {
  DOT_REMOTE_ENDPOINT_ERROR_CODES,
  DotRemoteEndpointErrorSchema
} from '../../../shared/dot-remote/dot-remote-errors'
import {
  DotRemoteEventBatchResultSchema,
  DotRemoteEventBatchSchema
} from '../../../shared/dot-remote/dot-remote-events'
import {
  DotRemoteLeaseRenewRequestSchema,
  DotRemoteLeaseRenewResponseSchema,
  DotRemoteLeaseRequestSchema,
  DotRemoteLeaseResponseSchema
} from '../../../shared/dot-remote/dot-remote-inbox'
import {
  DOT_REMOTE_SERVICE_AUTH_HEADER,
  DOT_REMOTE_SESSION_HEADER,
  DotRemoteChallengeCreateRequestSchema,
  DotRemoteChallengeSchema,
  DotRemoteRevokeRequestSchema,
  DotRemoteRevokeResponseSchema,
  DotRemoteSessionIssueRequestSchema,
  DotRemoteSessionIssueResponseSchema,
  DotRemoteSessionRefreshRequestSchema,
  DotRemoteSessionRefreshResponseSchema,
  DotRemoteSessionRenewRequestSchema,
  DotRemoteSessionRenewResponseSchema
} from '../../../shared/dot-remote/dot-remote-pairing'
import {
  DotRemoteHeartbeatRequestSchema,
  DotRemoteHeartbeatResponseSchema,
  DotRemoteWorkspaceListRequestSchema,
  DotRemoteWorkspaceListResponseSchema
} from '../../../shared/dot-remote/dot-remote-presence'
import {
  FetchResponseBodyTooLargeError,
  readFetchResponseTextWithinLimit
} from '../../../shared/fetch-response-body'
import type {
  DotRemoteDeviceCredential,
  DotRemoteServiceToken,
  DotRemoteSessionToken
} from './dot-remote-credentials'

// The one HTTP client of remote access (hop B). Every call starts on the PC, is validated against
// R2's generated request schema before it leaves and against the response schema when it returns.
// Tokens travel only in their headers; no failure carries a message, a body or a header back.

export const DOT_REMOTE_SITE_SCHEMAS = {
  'pairing.challenge.create': {
    request: DotRemoteChallengeCreateRequestSchema,
    response: DotRemoteChallengeSchema
  },
  'pairing.session.issue': {
    request: DotRemoteSessionIssueRequestSchema,
    response: DotRemoteSessionIssueResponseSchema
  },
  'pairing.session.renew': {
    request: DotRemoteSessionRenewRequestSchema,
    response: DotRemoteSessionRenewResponseSchema
  },
  'pairing.session.refresh': {
    request: DotRemoteSessionRefreshRequestSchema,
    response: DotRemoteSessionRefreshResponseSchema
  },
  'pairing.revoke': {
    request: DotRemoteRevokeRequestSchema,
    response: DotRemoteRevokeResponseSchema
  },
  'inbox.lease': { request: DotRemoteLeaseRequestSchema, response: DotRemoteLeaseResponseSchema },
  'inbox.renew': {
    request: DotRemoteLeaseRenewRequestSchema,
    response: DotRemoteLeaseRenewResponseSchema
  },
  'inbox.ack': { request: DotRemoteAckRequestSchema, response: DotRemoteAckResponseSchema },
  'events.post': { request: DotRemoteEventBatchSchema, response: DotRemoteEventBatchResultSchema },
  'workspaces.put': {
    request: DotRemoteWorkspaceListRequestSchema,
    response: DotRemoteWorkspaceListResponseSchema
  },
  'heartbeat.post': {
    request: DotRemoteHeartbeatRequestSchema,
    response: DotRemoteHeartbeatResponseSchema
  }
} as const

export type DotRemoteSiteEndpoint = keyof typeof DOT_REMOTE_SITE_SCHEMAS
export type DotRemoteSiteRequest<N extends DotRemoteSiteEndpoint> = z.input<
  (typeof DOT_REMOTE_SITE_SCHEMAS)[N]['request']
>
export type DotRemoteSiteResponse<N extends DotRemoteSiteEndpoint> = z.output<
  (typeof DOT_REMOTE_SITE_SCHEMAS)[N]['response']
>

/** Orca's proxy-aware fetch in production (main HttpClient); an injected fake in every test. */
export type DotRemoteFetch = (url: string, init: RequestInit) => Promise<Response>

export type DotRemoteEndpointErrorCode = (typeof DOT_REMOTE_ENDPOINT_ERROR_CODES)[number]

export type DotRemoteSiteFailure =
  | { kind: 'site_error'; code: DotRemoteEndpointErrorCode }
  /** The platform refused the request before the app saw it (service access). */
  | { kind: 'rejected'; status: 401 | 403 }
  | {
      kind: 'unavailable'
      reason: 'network' | 'timeout' | 'aborted' | 'http_status' | 'invalid_response' | 'too_large'
    }
  /** NASH would have sent something outside the contract; nothing was sent. */
  | { kind: 'invalid_request' }

export type DotRemoteSiteResult<T> = { ok: true; value: T } | ({ ok: false } & DotRemoteSiteFailure)

/** The failure of a refused call, without its result flag. */
export function siteFailureOf(result: { ok: false } & DotRemoteSiteFailure): DotRemoteSiteFailure {
  switch (result.kind) {
    case 'site_error':
      return { kind: 'site_error', code: result.code }
    case 'rejected':
      return { kind: 'rejected', status: result.status }
    case 'unavailable':
      return { kind: 'unavailable', reason: result.reason }
    case 'invalid_request':
      return { kind: 'invalid_request' }
  }
}

export type DotRemoteSiteCredentials = {
  service: DotRemoteServiceToken
  session: DotRemoteSessionToken | null
  /** Only a refresh sends it, in its own header. */
  device?: DotRemoteDeviceCredential | null
}

export type DotRemoteSiteCallOptions = {
  credentials: DotRemoteSiteCredentials
  itemId?: string
  signal?: AbortSignal
}

export type DotRemoteSiteClient = {
  call<N extends DotRemoteSiteEndpoint>(
    name: N,
    body: DotRemoteSiteRequest<N>,
    options: DotRemoteSiteCallOptions
  ): Promise<DotRemoteSiteResult<DotRemoteSiteResponse<N>>>
}

export const DOT_REMOTE_REQUEST_TIMEOUT_MS = 20_000
const RESPONSE_MAX_BYTES = 1024 * 1024
const ITEM_ID = /^[0-9a-f-]{36}$/

type Failure = { ok: false } & DotRemoteSiteFailure

function failure(value: DotRemoteSiteFailure): Failure {
  return { ok: false, ...value }
}

function endpointOf(name: DotRemoteSiteEndpoint) {
  const endpoint = DOT_REMOTE_ENDPOINTS.find((entry) => entry.name === name)
  if (!endpoint) {
    throw new Error(`No remote endpoint ${name}.`)
  }
  return endpoint
}

function isEndpointErrorCode(code: string): code is DotRemoteEndpointErrorCode {
  return DOT_REMOTE_ENDPOINT_ERROR_CODES.some((known) => known === code)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The headers an endpoint's auth names, and no other credential; null when one is missing. */
function headersFor(
  auth: readonly string[],
  credentials: DotRemoteSiteCredentials
): Record<string, string> | null {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    [DOT_REMOTE_SERVICE_AUTH_HEADER]: credentials.service.authorizationHeader()
  }
  const { session, device } = credentials
  if (auth.includes('session') && !session) {
    return null
  }
  if (auth.includes('device_credential') && !device) {
    return null
  }
  return {
    ...headers,
    ...(auth.includes('session') && session
      ? { [DOT_REMOTE_SESSION_HEADER]: session.headerValue() }
      : {}),
    ...(auth.includes('device_credential') && device
      ? { [DOT_REMOTE_DEVICE_CREDENTIAL_HEADER]: device.headerValue() }
      : {})
  }
}

function pathFor(path: string, itemId: string | undefined): string | null {
  if (!path.includes('{itemId}')) {
    return path
  }
  return itemId !== undefined && ITEM_ID.test(itemId)
    ? path.replace('{itemId}', encodeURIComponent(itemId))
    : null
}

function abortFailure(callerSignal: AbortSignal | undefined): Failure {
  return failure({ kind: 'unavailable', reason: callerSignal?.aborted ? 'aborted' : 'timeout' })
}

/** An app error body wins; otherwise a 401 or 403 is the platform refusing the service token. */
function classifyStatus(status: number, body: unknown): Failure {
  const appError = DotRemoteEndpointErrorSchema.safeParse(body)
  if (appError.success && isEndpointErrorCode(appError.data.error.code)) {
    return failure({ kind: 'site_error', code: appError.data.error.code })
  }
  if (status === 401 || status === 403) {
    return failure({ kind: 'rejected', status })
  }
  return failure({ kind: 'unavailable', reason: 'http_status' })
}

async function readBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined
): Promise<{ ok: true; text: string } | Failure> {
  try {
    return { ok: true, text: await readFetchResponseTextWithinLimit(response, maxBytes) }
  } catch (error) {
    if (error instanceof FetchResponseBodyTooLargeError) {
      return failure({ kind: 'unavailable', reason: 'too_large' })
    }
    return signal.aborted
      ? abortFailure(callerSignal)
      : failure({ kind: 'unavailable', reason: 'network' })
  }
}

export function createDotRemoteSiteClient(deps: {
  origin: string
  fetch: DotRemoteFetch
  timeoutMs?: number
  responseMaxBytes?: number
}): DotRemoteSiteClient {
  async function send(
    name: DotRemoteSiteEndpoint,
    body: unknown,
    options: DotRemoteSiteCallOptions
  ): Promise<DotRemoteSiteResult<unknown>> {
    const endpoint = endpointOf(name)
    const schemas = DOT_REMOTE_SITE_SCHEMAS[name]
    const request = schemas.request.safeParse(body)
    const headers = headersFor(endpoint.auth, options.credentials)
    const path = pathFor(endpoint.path, options.itemId)
    if (!request.success || headers === null || path === null) {
      return failure({ kind: 'invalid_request' })
    }
    const timeout = AbortSignal.timeout(deps.timeoutMs ?? DOT_REMOTE_REQUEST_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let response: Response
    try {
      response = await deps.fetch(`${deps.origin}${path}`, {
        method: endpoint.method,
        headers,
        body: JSON.stringify(request.data),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal
      })
    } catch {
      return signal.aborted
        ? abortFailure(options.signal)
        : failure({ kind: 'unavailable', reason: 'network' })
    }
    const text = await readBody(
      response,
      deps.responseMaxBytes ?? RESPONSE_MAX_BYTES,
      signal,
      options.signal
    )
    if (!text.ok) {
      return text
    }
    const parsed = parseJson(text.text)
    if (!response.ok) {
      return classifyStatus(response.status, parsed)
    }
    const value = schemas.response.safeParse(parsed)
    return value.success
      ? { ok: true, value: value.data }
      : failure({ kind: 'unavailable', reason: 'invalid_response' })
  }

  function call<N extends DotRemoteSiteEndpoint>(
    name: N,
    body: DotRemoteSiteRequest<N>,
    options: DotRemoteSiteCallOptions
  ): Promise<DotRemoteSiteResult<DotRemoteSiteResponse<N>>> {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: send parsed the value with DOT_REMOTE_SITE_SCHEMAS[name].response.
    return send(name, body, options) as Promise<DotRemoteSiteResult<DotRemoteSiteResponse<N>>>
  }

  return { call }
}
