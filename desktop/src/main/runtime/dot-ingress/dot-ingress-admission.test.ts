import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import {
  DOT_INGRESS_ERROR_CODES,
  DOT_INGRESS_ERROR_MESSAGES
} from '../../../shared/dot-ingress/dot-ingress-errors'
import type { RpcResponse } from '../rpc/core'
import { requireDotIngressCaller } from './dot-ingress-caller'
import {
  DOT_INGRESS_GENERIC_FAILURE_MESSAGE,
  admitDotIngressFrame,
  sanitizeDotIngressResponse
} from './dot-ingress-admission'
import {
  FIXTURE_CLI_TOKEN,
  FIXTURE_INGRESS_TOKEN,
  FIXTURE_RUNTIME_ID
} from './dot-ingress-transport.test-fixture'

const admit = (rawMessage: string, token: string | null = FIXTURE_INGRESS_TOKEN) =>
  admitDotIngressFrame({ rawMessage, token, runtimeId: FIXTURE_RUNTIME_ID })

const frame = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'req-1',
    authToken: FIXTURE_INGRESS_TOKEN,
    method: 'dotIngress.hello',
    params: { contractVersion: 1 },
    ...overrides
  })

function refusal(rawMessage: string, token?: string | null) {
  const admission = admit(rawMessage, token)
  if (admission.ok) {
    throw new Error('expected the frame to be refused')
  }
  return admission.response
}

describe('dot ingress frame admission', () => {
  it('admits a frame with the ingress token and issues the dot caller', () => {
    const admission = admit(frame())

    if (!admission.ok) {
      throw new Error('expected the frame to be admitted')
    }
    expect(admission.request).toEqual({
      id: 'req-1',
      authToken: '',
      method: 'dotIngress.hello',
      params: { contractVersion: 1 }
    })
    expect(requireDotIngressCaller(admission.caller)).toBe(admission.caller)
  })

  it('drops the presented token and every orchestration envelope field from the request', () => {
    const admission = admit(
      frame({
        orchestrationContractVersion: 99,
        orchestrationRequestId: 'x',
        compatibilityInvocationId: 'y',
        orchestrationCompatibilityEvidence: { agentSessionId: 'session-1' },
        workbenchCaller: { principalId: 'local-desktop-ui', source: 'desktop_ui' },
        dotIngressCaller: { principalId: 'dot-ingress', source: 'dot_ingress' }
      })
    )

    if (!admission.ok) {
      throw new Error('expected the frame to be admitted')
    }
    expect(Object.keys(admission.request).sort()).toEqual(['authToken', 'id', 'method', 'params'])
    expect(JSON.stringify(admission.request)).not.toContain(FIXTURE_INGRESS_TOKEN)
  })

  it('reports an oversized frame, which the transport hands over as an empty message', () => {
    expect(refusal('')).toMatchObject({
      id: 'unknown',
      ok: false,
      error: { code: 'request_too_large' },
      _meta: { runtimeId: FIXTURE_RUNTIME_ID }
    })
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON null', 'null'],
    ['a JSON array', '[1,2]'],
    ['a JSON string', '"text"'],
    ['a JSON number', '42']
  ])('refuses %s as a bad request with no request id', (_name, raw) => {
    expect(refusal(raw)).toMatchObject({
      id: 'unknown',
      ok: false,
      error: { code: 'bad_request' }
    })
  })

  it.each([
    ['no id', { id: undefined }],
    ['an empty id', { id: '' }],
    ['a numeric id', { id: 7 }],
    ['an over-long id', { id: 'x'.repeat(257) }]
  ])('refuses a frame with %s before looking at the token', (_name, overrides) => {
    expect(refusal(frame(overrides), null)).toMatchObject({
      id: 'unknown',
      ok: false,
      error: { code: 'bad_request' }
    })
  })

  it('refuses a missing, empty or over-long method with the request id', () => {
    expect(refusal(frame({ method: undefined }))).toMatchObject({
      id: 'req-1',
      error: { code: 'bad_request' }
    })
    expect(refusal(frame({ method: '' }))).toMatchObject({ error: { code: 'bad_request' } })
    expect(refusal(frame({ method: 'm'.repeat(129) }))).toMatchObject({
      id: 'req-1',
      error: { code: 'bad_request' }
    })
  })

  it.each([
    ['no token', undefined],
    ['an empty token', ''],
    ['a numeric token', 12]
  ])('refuses %s as unauthorized', (_name, authToken) => {
    expect(refusal(frame({ authToken }))).toMatchObject({
      id: 'req-1',
      error: { code: 'unauthorized', message: 'Missing auth token' }
    })
  })

  it.each([
    ['the CLI token', FIXTURE_CLI_TOKEN],
    ['a shorter prefix of the token', FIXTURE_INGRESS_TOKEN.slice(0, 63)],
    ['the token with an extra character', `${FIXTURE_INGRESS_TOKEN}0`],
    ['the token with one wrong character', `${FIXTURE_INGRESS_TOKEN.slice(0, 63)}0`],
    ['the token in upper case', FIXTURE_INGRESS_TOKEN.toUpperCase()],
    ['a very long token', 'a'.repeat(100_000)]
  ])('refuses %s without throwing and without echoing it', (_name, authToken) => {
    const response = refusal(frame({ authToken }))

    expect(response).toMatchObject({
      id: 'req-1',
      error: { code: 'unauthorized', message: 'Invalid auth token' }
    })
    expect(JSON.stringify(response)).not.toContain(authToken)
  })

  it('answers dot_ingress_disabled when no token is active, whatever the frame carries', () => {
    expect(refusal(frame(), null)).toMatchObject({
      id: 'req-1',
      error: {
        code: 'dot_ingress_disabled',
        message: DOT_INGRESS_ERROR_MESSAGES.dot_ingress_disabled
      }
    })
  })

  it('does not reveal whether a method exists before the token is proven', () => {
    const unknown = refusal(frame({ authToken: FIXTURE_CLI_TOKEN, method: 'no.such.method' }))
    const known = refusal(frame({ authToken: FIXTURE_CLI_TOKEN, method: 'dotIngress.hello' }))

    expect(unknown).toEqual(known)
  })
})

describe('dot ingress response sanitizing', () => {
  const meta = { runtimeId: FIXTURE_RUNTIME_ID }
  const failure = (code: string, message: string, data?: unknown): RpcResponse => ({
    id: 'req-1',
    ok: false,
    error: data === undefined ? { code, message } : { code, message, data },
    _meta: meta
  })

  it('passes a success response through untouched', () => {
    const success: RpcResponse = { id: 'req-1', ok: true, result: { value: 1 }, _meta: meta }

    expect(sanitizeDotIngressResponse(success)).toBe(success)
  })

  it.each([
    'invalid_argument',
    'method_not_found',
    'method_not_supported',
    'bad_request',
    'unauthorized',
    'request_too_large'
  ])('keeps the transport code %s with its message', (code) => {
    const response = failure(code, 'fixture message')

    expect(sanitizeDotIngressResponse(response)).toEqual(response)
  })

  it('keeps every contract error code with its message and coarse data', () => {
    for (const code of DOT_INGRESS_ERROR_CODES) {
      const response = failure(code, DOT_INGRESS_ERROR_MESSAGES[code], { window: 'minute' })

      expect(sanitizeDotIngressResponse(response)).toEqual(response)
    }
  })

  it.each([
    ['an unmapped runtime error', 'runtime_error'],
    ['an internal error that carries text', 'internal_error'],
    ['a desktop-only Workbench code', 'workbench_forbidden'],
    ['a lineage code', 'LINEAGE_FIXTURE'],
    ['a code outside the contract', 'dot_made_up_code']
  ])('replaces %s with a generic failure that carries no text or data', (_name, code) => {
    const leaked =
      'unable to open C:\\Users\\leaked-marker\\orchestration.db: table dot_ingress_requests'
    const response = sanitizeDotIngressResponse(
      failure(code, leaked, { path: 'C:\\leaked-marker' })
    )

    expect(response).toEqual({
      id: 'req-1',
      ok: false,
      error: { code: 'internal_error', message: DOT_INGRESS_GENERIC_FAILURE_MESSAGE },
      _meta: meta
    })
    expect(JSON.stringify(response)).not.toContain('leaked-marker')
  })

  it('writes every framework message in English', () => {
    expect(isEnglishText(DOT_INGRESS_GENERIC_FAILURE_MESSAGE)).toBe(true)
  })
})
