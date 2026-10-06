import { describe, expect, it, vi } from 'vitest'
import {
  DOT_REMOTE_ENDPOINTS,
  dotRemoteEndpointSchemas
} from '../../../shared/dot-remote/dot-remote-endpoints'
import { dotRemoteError } from '../../../shared/dot-remote/dot-remote-errors'
import {
  DotRemoteDeviceCredential,
  DotRemoteServiceToken,
  DotRemoteSessionToken
} from './dot-remote-credentials'
import {
  DOT_REMOTE_SITE_SCHEMAS,
  createDotRemoteSiteClient,
  type DotRemoteFetch
} from './dot-remote-site-client'

// FIXTURE_ONLY: obviously fake tokens and origin; the injected fetch never reaches a network.
const ORIGIN = 'https://fixture-nash.example.test'
const SERVICE_VALUE = 'FIXTURE_ONLY_sites_service_token_0000000000'
const SESSION_VALUE = 'FIXTURE0session0token0value0000000000000000000'
const ITEM = '10000000-0000-4000-8000-000000000001'
const DEVICE_VALUE =
  'ndc_0123456789abcdef01234567.FIXTUREdeviceCredentialSecret00000000000000000001'
const ROTATED_VALUE =
  'ndc_89abcdef0123456789abcdef.FIXTUREdeviceCredentialSecret00000000000000000002'
const credentials = {
  service: new DotRemoteServiceToken(SERVICE_VALUE),
  session: new DotRemoteSessionToken(SESSION_VALUE)
}
const device = new DotRemoteDeviceCredential(DEVICE_VALUE)

type Captured = { url: string; init: RequestInit }

function fakeFetch(respond: (call: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = []
  const fetch: DotRemoteFetch = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init }
    calls.push(call)
    return respond(call)
  })
  return { fetch, calls }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function headersOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries())
}

describe('dot remote Site client', () => {
  it('uses the generated R2 schemas for every NASH endpoint', () => {
    for (const endpoint of DOT_REMOTE_ENDPOINTS.filter((entry) => entry.caller === 'nash')) {
      const generated = dotRemoteEndpointSchemas(endpoint)
      const ours = DOT_REMOTE_SITE_SCHEMAS[endpoint.name as keyof typeof DOT_REMOTE_SITE_SCHEMAS]
      expect(ours?.request, endpoint.name).toBe(generated.request)
      expect(ours?.response, endpoint.name).toBe(generated.response)
    }
    expect(Object.keys(DOT_REMOTE_SITE_SCHEMAS).sort()).toEqual(
      DOT_REMOTE_ENDPOINTS.filter((entry) => entry.caller === 'nash')
        .map((entry) => entry.name)
        .sort()
    )
  })

  it('sends a session call with both headers and the token in no body', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { serverTime: '2026-10-05T12:00:00.000Z' }))
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    const body = {
      generation: 1,
      appVersion: '1.4.0',
      contractVersion: 3 as const,
      sentAt: '2026-10-05T12:00:00.000Z'
    }
    const result = await client.call('heartbeat.post', body, { credentials })
    expect(result).toEqual({ ok: true, value: { serverTime: '2026-10-05T12:00:00.000Z' } })
    expect(calls[0]?.url).toBe(`${ORIGIN}/nash/v1/heartbeat`)
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store'
    })
    expect(headersOf(calls[0]!.init)).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'oai-sites-authorization': `Bearer ${SERVICE_VALUE}`,
      'nash-session': SESSION_VALUE
    })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(body)
    expect(String(calls[0]?.init.body)).not.toContain(SERVICE_VALUE)
    expect(String(calls[0]?.init.body)).not.toContain(SESSION_VALUE)
  })

  it('never sends the session header on a service-only pairing call', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, { state: 'pending', pollIntervalSeconds: 5 })
    )
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    await client.call(
      'pairing.session.issue',
      { challengeId: ITEM, deviceCode: 'D'.repeat(43) },
      { credentials }
    )
    expect(headersOf(calls[0]!.init)['nash-session']).toBeUndefined()
    expect(headersOf(calls[0]!.init)['oai-sites-authorization']).toBe(`Bearer ${SERVICE_VALUE}`)
  })

  it('fills the item path parameter and uses PUT where the table says so', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, { itemId: ITEM, recorded: 'applied', receiptState: 'expired' })
    )
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    await client.call(
      'inbox.ack',
      {
        itemId: ITEM,
        leaseNonce: 'FIXTURElease0nonce000000000001',
        generation: 1,
        payloadSha256: 'a'.repeat(64),
        ackedAt: '2026-10-05T12:00:00.000Z',
        outcome: 'expired'
      },
      { credentials, itemId: ITEM }
    )
    expect(calls[0]?.url).toBe(`${ORIGIN}/nash/v1/inbox/${ITEM}/ack`)
    const put = fakeFetch(() => json(200, { storedAt: '2026-10-05T12:00:00.000Z' }))
    await createDotRemoteSiteClient({ origin: ORIGIN, fetch: put.fetch }).call(
      'workspaces.put',
      { generation: 1, publishedAt: '2026-10-05T12:00:00.000Z', workspaces: [] },
      { credentials }
    )
    expect(put.calls[0]?.init.method).toBe('PUT')
  })

  it('refuses to send a body outside the contract', async () => {
    const { fetch } = fakeFetch(() => json(200, {}))
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    const result = await client.call(
      'heartbeat.post',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: deliberately malformed input under test.
      { generation: 0 } as never,
      { credentials }
    )
    expect(result).toEqual({ ok: false, kind: 'invalid_request' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a session call without a session, before any request', async () => {
    const { fetch } = fakeFetch(() => json(200, {}))
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    const result = await client.call(
      'pairing.revoke',
      { generation: 1 },
      { credentials: { service: credentials.service, session: null } }
    )
    expect(result).toEqual({ ok: false, kind: 'invalid_request' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends the device credential only in its header on refresh, with no session header', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, {
        session: {
          sessionToken: SESSION_VALUE,
          expiresAt: '2026-10-05T12:15:00.000Z',
          renewAfter: '2026-10-05T12:10:00.000Z',
          deviceId: 'dev_0123456789abcdef01234567',
          generation: 1
        },
        deviceCredential: { credential: ROTATED_VALUE, expiresAt: '2026-11-04T12:00:00.000Z' }
      })
    )
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    const result = await client.call(
      'pairing.session.refresh',
      { generation: 1 },
      { credentials: { service: credentials.service, session: null, device } }
    )
    expect(result.ok).toBe(true)
    expect(calls[0]?.url).toBe(`${ORIGIN}/nash/v1/session/refresh`)
    expect(headersOf(calls[0]!.init)).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'oai-sites-authorization': `Bearer ${SERVICE_VALUE}`,
      'nash-device-credential': DEVICE_VALUE
    })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ generation: 1 })
    expect(String(calls[0]?.init.body)).not.toContain('FIXTUREdeviceCredentialSecret')
  })

  it('refuses a refresh without a device credential, before any request', async () => {
    const { fetch } = fakeFetch(() => json(200, {}))
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    const result = await client.call(
      'pairing.session.refresh',
      { generation: 1 },
      { credentials: { service: credentials.service, session: null } }
    )
    expect(result).toEqual({ ok: false, kind: 'invalid_request' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never sends the device credential on any other call', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { serverTime: '2026-10-05T12:00:00.000Z' }))
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    await client.call(
      'heartbeat.post',
      {
        generation: 1,
        appVersion: '1.4.0',
        contractVersion: 3,
        sentAt: '2026-10-05T12:00:00.000Z'
      },
      { credentials: { ...credentials, device } }
    )
    expect(headersOf(calls[0]!.init)['nash-device-credential']).toBeUndefined()
  })

  it.each([
    [
      'an app error body',
      () => json(409, dotRemoteError('generation_revoked')),
      { kind: 'site_error', code: 'generation_revoked' }
    ],
    [
      'a platform 401',
      () => new Response('denied', { status: 401 }),
      { kind: 'rejected', status: 401 }
    ],
    [
      'a platform 403',
      () => new Response('<html/>', { status: 403 }),
      { kind: 'rejected', status: 403 }
    ],
    [
      'a server error',
      () => new Response('oops', { status: 502 }),
      { kind: 'unavailable', reason: 'http_status' }
    ],
    [
      'a response outside the contract',
      () => json(200, { serverTime: 'yesterday' }),
      { kind: 'unavailable', reason: 'invalid_response' }
    ],
    [
      'a body that is not JSON',
      () => new Response('not json', { status: 200 }),
      { kind: 'unavailable', reason: 'invalid_response' }
    ]
  ])('classifies %s', async (_name, respond, expected) => {
    const { fetch } = fakeFetch(respond)
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch })
    const result = await client.call('pairing.revoke', { generation: 1 }, { credentials })
    expect(result).toEqual({ ok: false, ...expected })
  })

  it('reports a network failure without its message', async () => {
    const fetch: DotRemoteFetch = vi.fn(async () => {
      throw new Error(`connect failed for ${SERVICE_VALUE}`)
    })
    const result = await createDotRemoteSiteClient({ origin: ORIGIN, fetch }).call(
      'pairing.revoke',
      { generation: 1 },
      { credentials }
    )
    expect(result).toEqual({ ok: false, kind: 'unavailable', reason: 'network' })
    expect(JSON.stringify(result)).not.toContain(SERVICE_VALUE)
  })

  it('reports a caller abort as aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch: DotRemoteFetch = vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.throwIfAborted()
      return json(200, {})
    })
    const result = await createDotRemoteSiteClient({ origin: ORIGIN, fetch }).call(
      'pairing.revoke',
      { generation: 1 },
      { credentials, signal: controller.signal }
    )
    expect(result).toEqual({ ok: false, kind: 'unavailable', reason: 'aborted' })
  })

  it('bounds the response body it reads', async () => {
    const { fetch } = fakeFetch(() => new Response('x'.repeat(4096), { status: 200 }))
    const client = createDotRemoteSiteClient({ origin: ORIGIN, fetch, responseMaxBytes: 1024 })
    const result = await client.call('pairing.revoke', { generation: 1 }, { credentials })
    expect(result).toEqual({ ok: false, kind: 'unavailable', reason: 'too_large' })
  })
})
