import { describe, expect, it } from 'vitest'
import {
  allowsArtifactCloudAuthOverride,
  orcaShareServiceUnavailableMessage,
  resolveArtifactCloudApiUrl
} from './artifact-cloud-config'

// FIXTURE_ONLY: a development origin set in the environment, the only explicit override that counts.
const DEV_ORIGIN = { ORCA_ARTIFACTS_API_URL: 'https://share.onorca.dev' }

describe('resolveArtifactCloudApiUrl', () => {
  it('has no default origin in NASH builds and refuses with a clear message', () => {
    expect(orcaShareServiceUnavailableMessage({})).toBe(
      'Orca artifact and skill sharing is not available in NASH builds.'
    )
    expect(() => resolveArtifactCloudApiUrl(undefined, {}, true)).toThrow(
      'Orca artifact and skill sharing is not available in NASH builds.'
    )
  })

  it('counts only the environment override as explicit, never an --api-url or RPC override', () => {
    expect(
      orcaShareServiceUnavailableMessage({ ORCA_ARTIFACTS_API_URL: 'https://share.onorca.dev' })
    ).toBeNull()
    expect(() => resolveArtifactCloudApiUrl('https://share.onorca.dev', {}, true)).toThrow(
      'Orca artifact and skill sharing is not available in NASH builds.'
    )
    expect(
      resolveArtifactCloudApiUrl(
        'https://share.onorca.dev',
        { ORCA_ARTIFACTS_API_URL: 'https://other.onorca.dev' },
        true
      )
    ).toBe('https://share.onorca.dev')
  })

  it('allows loopback HTTP only in development', () => {
    expect(
      resolveArtifactCloudApiUrl(
        undefined,
        { ORCA_ARTIFACTS_API_URL: 'http://127.0.0.1:45961' },
        false
      )
    ).toBe('http://127.0.0.1:45961')
    expect(() => resolveArtifactCloudApiUrl('http://127.0.0.1:45961', DEV_ORIGIN, true)).toThrow(
      /HTTPS/
    )
  })

  it('rejects origins that could receive an Orca access token', () => {
    expect(() => resolveArtifactCloudApiUrl('https://example.com', DEV_ORIGIN, false)).toThrow(
      /onorca\.dev/
    )
    expect(() =>
      resolveArtifactCloudApiUrl('https://share.onorca.dev/path', DEV_ORIGIN, false)
    ).toThrow(/origin/)
  })

  it('allows auth token overrides only in non-production development builds', () => {
    expect(allowsArtifactCloudAuthOverride({}, false)).toBe(true)
    expect(allowsArtifactCloudAuthOverride({ NODE_ENV: 'production' }, false)).toBe(false)
    expect(allowsArtifactCloudAuthOverride({}, true)).toBe(false)
  })
})
