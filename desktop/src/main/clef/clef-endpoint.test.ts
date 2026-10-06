import { describe, expect, it } from 'vitest'
import {
  CLEF_API_ORIGIN,
  CLEF_BODY_MODEL,
  CLEF_MODEL_PATH,
  CLEF_PATH_TEMPLATE,
  CLEF_PROXY_PROBE_URL,
  CLEF_URL_TEMPLATE,
  buildClefRunUrl,
  isPinnedClefModel,
  isPinnedClefRequestBody
} from './clef-endpoint'

// FIXTURE_ONLY: fake account id shaped like a real one so the URL builder sees the real format.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'

function handleWithAccountPath(accountPath: () => string): { accountPath(): string } {
  return { accountPath }
}

describe('clef endpoint pins', () => {
  it('pins the Cloudflare origin, run path and body model in code', () => {
    expect(CLEF_API_ORIGIN).toBe('https://api.cloudflare.com')
    expect(CLEF_MODEL_PATH).toBe('@cf/cloudflare/clef')
    expect(CLEF_BODY_MODEL).toBe('clef')
    expect(CLEF_PATH_TEMPLATE).toBe('/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/clef')
    expect(CLEF_URL_TEMPLATE).toBe(
      'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/clef'
    )
  })

  it('probes the proxy with the origin only', () => {
    expect(CLEF_PROXY_PROBE_URL).toBe('https://api.cloudflare.com/')
    expect(new URL(CLEF_PROXY_PROBE_URL).pathname).toBe('/')
  })

  it('accepts only the pinned model path and body model together', () => {
    expect(isPinnedClefModel('@cf/cloudflare/clef', 'clef')).toBe(true)
    expect(isPinnedClefModel('@cf/cloudflare/clef-flash', 'clef')).toBe(false)
    expect(isPinnedClefModel('@cf/cloudflare/clef', 'clef-flash')).toBe(false)
    expect(isPinnedClefModel('@cf/meta/llama-3', 'clef')).toBe(false)
    expect(isPinnedClefModel('@cf/cloudflare/clef', 'CLEF')).toBe(false)
    expect(isPinnedClefModel(undefined, 'clef')).toBe(false)
    expect(isPinnedClefModel('@cf/cloudflare/clef', null)).toBe(false)
  })
})

describe('buildClefRunUrl', () => {
  it('substitutes a bare account id into the pinned template', () => {
    const result = buildClefRunUrl(handleWithAccountPath(() => FIXTURE_ONLY_ACCOUNT_ID))
    expect(result).toEqual({
      ok: true,
      url: `https://api.cloudflare.com/client/v4/accounts/${FIXTURE_ONLY_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`,
      accountId: FIXTURE_ONLY_ACCOUNT_ID
    })
  })

  it.each([
    `accounts/${FIXTURE_ONLY_ACCOUNT_ID}`,
    `/accounts/${FIXTURE_ONLY_ACCOUNT_ID}/`,
    `/client/v4/accounts/${FIXTURE_ONLY_ACCOUNT_ID}`
  ])('accepts the account path form %s', (accountPath) => {
    const result = buildClefRunUrl(handleWithAccountPath(() => accountPath))
    expect(result.ok && new URL(result.url).pathname).toBe(
      `/client/v4/accounts/${FIXTURE_ONLY_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`
    )
  })

  it('keeps the concrete URL on the pinned origin', () => {
    const result = buildClefRunUrl(handleWithAccountPath(() => FIXTURE_ONLY_ACCOUNT_ID))
    expect(result.ok && new URL(result.url).origin).toBe(CLEF_API_ORIGIN)
  })

  it.each([
    '',
    '0123456789ABCDEF0123456789ABCDEF',
    '0123456789abcdef0123456789abcde',
    '0123456789abcdef0123456789abcdef0',
    `${FIXTURE_ONLY_ACCOUNT_ID}/../../other`,
    `${FIXTURE_ONLY_ACCOUNT_ID}?x=1`,
    `evil.example.com/accounts/${FIXTURE_ONLY_ACCOUNT_ID}`,
    `//evil.example.com/${FIXTURE_ONLY_ACCOUNT_ID}`,
    `${FIXTURE_ONLY_ACCOUNT_ID}\n`
  ])('rejects a malformed account path %j without echoing it', (accountPath) => {
    const result = buildClefRunUrl(handleWithAccountPath(() => accountPath))
    expect(result).toEqual({ ok: false })
  })

  it('fails closed when the credential handle throws', () => {
    const result = buildClefRunUrl(
      handleWithAccountPath(() => {
        throw new Error('credentials cleared')
      })
    )
    expect(result).toEqual({ ok: false })
  })
})

describe('isPinnedClefRequestBody', () => {
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

  it('accepts a body that names the pinned model', () => {
    expect(isPinnedClefRequestBody(encode({ model: 'clef', state: {}, questions: {} }))).toBe(true)
  })

  it.each([
    ['another model', { model: 'clef-flash', state: {}, questions: {} }],
    ['no model', { state: {}, questions: {} }],
    ['images', { model: 'clef', state: {}, questions: {}, images: [] }],
    ['options', { model: 'clef', state: {}, questions: {}, options: {} }],
    ['an array', [{ model: 'clef' }]],
    ['null', null]
  ])('rejects a body with %s', (_label, body) => {
    expect(isPinnedClefRequestBody(encode(body))).toBe(false)
  })

  it('rejects bytes that are not UTF-8 JSON', () => {
    expect(isPinnedClefRequestBody(new TextEncoder().encode('{"model":"clef"'))).toBe(false)
    expect(isPinnedClefRequestBody(new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]))).toBe(false)
  })
})
