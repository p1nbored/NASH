import { createHash, timingSafeEqual } from 'node:crypto'
import {
  dotIngressErrorMessage,
  isDotIngressErrorCode
} from '../../../shared/dot-ingress/dot-ingress-errors'

import type { RpcRequest, RpcResponse } from '../rpc/core'
import { errorResponse } from '../rpc/errors'
import { issueDotIngressCaller, type DotIngressCaller } from './dot-ingress-caller'

// Bounds what a response can echo back, since the transport frame cap alone is 1 MB.
const MAX_REQUEST_ID_CHARS = 256
const MAX_METHOD_CHARS = 128

export const DOT_INGRESS_GENERIC_FAILURE_MESSAGE =
  'The dot interface could not complete the request.'

// Why: these transport codes carry fixed or caller-echoed text only; anything else may carry internals.
const TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid_argument',
  'method_not_found',
  'method_not_supported',
  'bad_request',
  'unauthorized',
  'request_too_large'
])

export type DotIngressAdmission =
  | { ok: true; request: RpcRequest; caller: DotIngressCaller }
  | { ok: false; response: RpcResponse }

type DotIngressFrameInput = {
  rawMessage: string
  /** The live ingress token, or null while no endpoint is being served. */
  token: string | null
  runtimeId: string
}

function parseFrame(rawMessage: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawMessage)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  return Object.fromEntries(Object.entries(parsed))
}

// Why: digests make both sides one fixed length, so the comparison leaks neither content nor length.
function tokenMatches(presented: string, expected: string): boolean {
  const presentedDigest = createHash('sha256').update(presented).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(presentedDigest, expectedDigest)
}

/**
 * Parses one frame, proves the ingress token and issues the dot caller. The returned request keeps
 * only id, method and params: the token and every orchestration envelope field are dropped, so
 * nothing a client sends can select an identity.
 */
export function admitDotIngressFrame({
  rawMessage,
  token,
  runtimeId
}: DotIngressFrameInput): DotIngressAdmission {
  const refuse = (id: string, code: string, message: string): DotIngressAdmission => ({
    ok: false,
    response: errorResponse(id, { runtimeId }, code, message)
  })
  // Why: the transport sends an empty message when a client exceeds the frame cap.
  if (!rawMessage) {
    return refuse('unknown', 'request_too_large', 'RPC request exceeds the maximum size')
  }
  const frame = parseFrame(rawMessage)
  if (!frame) {
    return refuse('unknown', 'bad_request', 'Invalid JSON request')
  }
  const { id, method, authToken, params } = frame
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_REQUEST_ID_CHARS) {
    return refuse('unknown', 'bad_request', 'Missing request id')
  }
  if (typeof method !== 'string' || method.length === 0 || method.length > MAX_METHOD_CHARS) {
    return refuse(id, 'bad_request', 'Missing RPC method')
  }
  if (token === null) {
    return refuse(id, 'dot_ingress_disabled', dotIngressErrorMessage('dot_ingress_disabled'))
  }
  if (typeof authToken !== 'string' || authToken.length === 0) {
    return refuse(id, 'unauthorized', 'Missing auth token')
  }
  if (!tokenMatches(authToken, token)) {
    return refuse(id, 'unauthorized', 'Invalid auth token')
  }
  return {
    ok: true,
    request: { id, authToken: '', method, params },
    caller: issueDotIngressCaller()
  }
}

/**
 * Responses become cloud context for the dot, so only contract codes and fixed transport text pass.
 * Any other failure, such as a database message with a path, is replaced by a generic one.
 */
export function sanitizeDotIngressResponse(response: RpcResponse): RpcResponse {
  if (response.ok) {
    return response
  }
  const { code, message } = response.error
  if (isDotIngressErrorCode(code)) {
    return response
  }
  if (TRANSPORT_ERROR_CODES.has(code)) {
    return errorResponse(response.id, response._meta, code, message)
  }
  return errorResponse(
    response.id,
    response._meta,
    'internal_error',
    DOT_INGRESS_GENERIC_FAILURE_MESSAGE
  )
}
