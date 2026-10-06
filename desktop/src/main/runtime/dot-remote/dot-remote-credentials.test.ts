import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  DOT_REMOTE_REDACTED_TOKEN,
  DotRemoteDeviceCredential,
  DotRemoteServiceToken,
  DotRemoteSessionToken,
  normalizeDotRemoteServiceToken,
  validateDotRemoteServiceTokenShape
} from './dot-remote-credentials'
import { parseDotRemoteOrigin } from './dot-remote-origin'

// FIXTURE_ONLY: obviously fake token values; none is a real credential.
const FAKE_TOKEN = 'FIXTURE_ONLY_sites_service_token_0000000000'
const FAKE_SESSION = 'FIXTURE0session0token0value0000000000000000000'
const FAKE_DEVICE = 'ndc_0123456789abcdef01234567.FIXTUREdeviceCredentialSecret00000000000000000001'

describe('Site origin', () => {
  it.each([
    ['https://fixture-nash.example.test', 'https://fixture-nash.example.test'],
    ['https://fixture-nash.example.test/', 'https://fixture-nash.example.test'],
    ['  https://Fixture-Nash.Example.Test  ', 'https://fixture-nash.example.test'],
    ['https://fixture.example.test:8443', 'https://fixture.example.test:8443']
  ])('accepts the https origin %s', (input, origin) => {
    expect(parseDotRemoteOrigin(input)).toEqual({ ok: true, origin })
  })

  it.each([
    'http://fixture.example.test',
    'fixture.example.test',
    'ftp://fixture.example.test',
    'https://fixture.example.test/mcp',
    'https://fixture.example.test/?a=1',
    'https://fixture.example.test/#x',
    'https://user:pass@fixture.example.test',
    'https://',
    '',
    'https://fixture example.test'
  ])('refuses %j', (input) => {
    expect(parseDotRemoteOrigin(input)).toEqual({ ok: false })
  })
})

describe('Sites service token', () => {
  it('normalizes a pasted token and a pasted Bearer header', () => {
    expect(normalizeDotRemoteServiceToken(`  ${FAKE_TOKEN}\n`)).toBe(FAKE_TOKEN)
    expect(normalizeDotRemoteServiceToken(`Bearer ${FAKE_TOKEN}`)).toBe(FAKE_TOKEN)
  })

  it.each([
    ['', 'token_missing'],
    ['short', 'token_too_short'],
    ['x'.repeat(4097), 'token_too_long'],
    [`${FAKE_TOKEN} with space`, 'token_invalid_characters'],
    [`${FAKE_TOKEN}é`, 'token_invalid_characters']
  ])('refuses a malformed token with a code only', (value, code) => {
    expect(validateDotRemoteServiceTokenShape(value)).toBe(code)
  })

  it('builds the header value and redacts every serialization', () => {
    const token = new DotRemoteServiceToken(FAKE_TOKEN)
    expect(token.authorizationHeader()).toBe(`Bearer ${FAKE_TOKEN}`)
    for (const text of [String(token), JSON.stringify({ token }), inspect(token), `${token}`]) {
      expect(text).not.toContain(FAKE_TOKEN)
      expect(text).toContain(DOT_REMOTE_REDACTED_TOKEN)
    }
  })

  it('refuses to hold a malformed token', () => {
    expect(() => new DotRemoteServiceToken('short')).toThrow(/token_too_short/)
  })

  it('redacts the app session token too', () => {
    const session = new DotRemoteSessionToken(FAKE_SESSION)
    expect(session.headerValue()).toBe(FAKE_SESSION)
    expect(JSON.stringify([session])).not.toContain(FAKE_SESSION)
    expect(inspect({ session })).not.toContain(FAKE_SESSION)
    expect(() => new DotRemoteSessionToken('bad token')).toThrow()
  })
})

describe('device credential', () => {
  it('carries the value only in its header and redacts every serialization', () => {
    const credential = new DotRemoteDeviceCredential(FAKE_DEVICE)
    expect(credential.headerValue()).toBe(FAKE_DEVICE)
    for (const text of [String(credential), JSON.stringify({ credential }), inspect(credential)]) {
      expect(text).not.toContain(FAKE_DEVICE)
      expect(text).not.toContain('FIXTUREdeviceCredentialSecret')
      expect(text).toContain(DOT_REMOTE_REDACTED_TOKEN)
    }
  })

  it.each([
    'ndc_0123.short',
    'ndc_0123456789abcdef01234567',
    'xyz_0123456789abcdef01234567.FIXTUREdeviceCredentialSecret00000000000000000001',
    `${FAKE_DEVICE} `
  ])('refuses to hold a value outside the contract shape, without echoing it', (value) => {
    let message = ''
    try {
      new DotRemoteDeviceCredential(value)
    } catch (error) {
      message = error instanceof Error ? error.message : 'not an error'
    }
    expect(message).toMatch(/malformed/)
    expect(message).not.toContain(value.trim())
  })
})
