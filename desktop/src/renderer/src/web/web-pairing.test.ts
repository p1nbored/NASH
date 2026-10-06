import { describe, expect, it } from 'vitest'
import { APP_IDENTITY } from '../../../shared/app-identity-constants'
import { decideWebPairingStartup, parseWebPairingInput, type WebPairingOffer } from './web-pairing'

const SCHEME = APP_IDENTITY.urlScheme

describe('web pairing input', () => {
  const offer: WebPairingOffer = {
    v: 2,
    endpoint: 'ws://127.0.0.1:6768',
    deviceToken: 'token',
    publicKeyB64: 'public-key'
  }

  function encodeOffer(overrides: Record<string, unknown> = {}) {
    return Buffer.from(JSON.stringify({ ...offer, ...overrides }), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  it('parses query-form pairing URLs', () => {
    expect(parseWebPairingInput(`${SCHEME}://pair?code=${encodeOffer()}`)).toEqual(offer)
  })

  it('still parses legacy hash-form pairing URLs', () => {
    expect(parseWebPairingInput(`${SCHEME}://pair#${encodeOffer()}`)).toEqual(offer)
  })

  it('preserves optional device scope metadata', () => {
    expect(
      parseWebPairingInput(`${SCHEME}://pair?code=${encodeOffer({ scope: 'mobile' })}`)
    ).toEqual({
      ...offer,
      scope: 'mobile'
    })
  })

  it('preserves optional paired device identity', () => {
    expect(
      parseWebPairingInput(
        `${SCHEME}://pair?code=${encodeOffer({ pairedDeviceId: 'paired-device-a' })}`
      )
    ).toEqual({
      ...offer,
      pairedDeviceId: 'paired-device-a'
    })
  })

  it.each([
    ['wss://proxy.example:443/orca/runtime', 'wss://proxy.example:443/orca/runtime'],
    ['https://proxy.example/orca/runtime', 'wss://proxy.example/orca/runtime'],
    ['http://proxy.example:8080/orca/runtime', 'ws://proxy.example:8080/orca/runtime']
  ])('preserves reverse-proxy endpoint routing for %s', (endpoint, expected) => {
    expect(parseWebPairingInput(encodeOffer({ endpoint }))).toMatchObject({ endpoint: expected })
  })

  it('treats invalid device scope metadata as unknown', () => {
    expect(
      parseWebPairingInput(`${SCHEME}://pair?code=${encodeOffer({ scope: 'admin' })}`)
    ).toEqual(offer)
  })

  it('pairs through the NASH scheme', () => {
    expect(SCHEME).toBe('nash')
  })

  it('rejects the orca:// scheme, which the OS routes to a real Orca install (D-017)', () => {
    expect(parseWebPairingInput(`orca://pair?code=${encodeOffer()}`)).toBeNull()
    expect(parseWebPairingInput(`ORCA://pair?code=${encodeOffer()}`)).toBeNull()
  })

  it('rejects app-scheme URLs outside the exact pairing route', () => {
    expect(parseWebPairingInput(`${SCHEME}://pairing?code=${encodeOffer()}`)).toBeNull()
    expect(parseWebPairingInput(`${SCHEME}://pair-extra?code=${encodeOffer()}`)).toBeNull()
  })

  it('auto-saves scoped runtime offers during web startup', () => {
    const input = `${SCHEME}://pair?code=${encodeOffer({ scope: 'runtime' })}`
    expect(
      decideWebPairingStartup({ initialPairingInput: input, hasStoredEnvironment: false })
    ).toEqual({
      kind: 'auto-save-runtime-offer',
      offer: { ...offer, scope: 'runtime' }
    })
  })

  it('shows the connect screen for mobile-scope and legacy unknown-scope offers', () => {
    const mobileInput = `${SCHEME}://pair?code=${encodeOffer({ scope: 'mobile' })}`
    const legacyInput = `${SCHEME}://pair?code=${encodeOffer()}`

    expect(
      decideWebPairingStartup({ initialPairingInput: mobileInput, hasStoredEnvironment: true })
    ).toEqual({ kind: 'show-connect', initialPairingInput: mobileInput })
    expect(
      decideWebPairingStartup({ initialPairingInput: legacyInput, hasStoredEnvironment: true })
    ).toEqual({ kind: 'show-connect', initialPairingInput: legacyInput })
  })

  it('uses a stored environment when no fresh valid pairing offer is present', () => {
    expect(
      decideWebPairingStartup({ initialPairingInput: null, hasStoredEnvironment: true })
    ).toEqual({
      kind: 'use-stored-environment'
    })
    expect(
      decideWebPairingStartup({ initialPairingInput: 'not a code', hasStoredEnvironment: true })
    ).toEqual({
      kind: 'use-stored-environment'
    })
  })
})
