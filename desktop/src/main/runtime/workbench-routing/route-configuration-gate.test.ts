import { describe, expect, it } from 'vitest'
import type { ClefVerifiedProfileRecord } from '../../clef/clef-verified-profile'
import { readClefConfigurationGate, type RouteConfigurationDeps } from './route-configuration-gate'
import { FIXTURE_ONLY_SEALED_STATUS, fixtureProfileRecord } from './workbench-routing.test-fixture'

function deps(overrides: {
  status?: Partial<ReturnType<RouteConfigurationDeps['credentials']['status']>>
  profile?: ClefVerifiedProfileRecord | null
}): RouteConfigurationDeps {
  const profile = overrides.profile === undefined ? fixtureProfileRecord() : overrides.profile
  return {
    credentials: { status: () => ({ ...FIXTURE_ONLY_SEALED_STATUS, ...overrides.status }) },
    verifiedProfile: { read: () => profile }
  }
}

function blockerOf(overrides: Parameters<typeof deps>[0]) {
  const result = readClefConfigurationGate(deps(overrides))
  return result.passed ? null : { blocker: result.blocker, status: result.routingStatus }
}

describe('readClefConfigurationGate (G0)', () => {
  it('passes with sealed credentials and a verified, pinned profile; it reads no spend cap', () => {
    expect(readClefConfigurationGate(deps({}))).toEqual({ passed: true })
  })

  it.each([
    ['nothing stored', { tokenPresent: false, accountPresent: false, protection: 'absent' }],
    ['a plaintext value that is refused', { protection: 'plaintext_refused' }],
    ['only the token', { accountPresent: false }],
    ['only the account id', { tokenPresent: false }]
  ] as const)('blocks as not_configured when credentials are %s', (_label, status) => {
    expect(blockerOf({ status })).toEqual({
      blocker: { reason: 'classifier_unavailable', detail: 'not_configured' },
      status: 'not_configured'
    })
  })

  it('reports an unusable keyring as sealing_unavailable', () => {
    expect(blockerOf({ status: { protection: 'sealing_unavailable' } })).toEqual({
      blocker: { reason: 'classifier_unavailable', detail: 'not_configured' },
      status: 'sealing_unavailable'
    })
  })

  it('blocks as contract_unverified when no verified profile is pinned', () => {
    expect(blockerOf({ profile: null })).toEqual({
      blocker: { reason: 'classifier_unavailable', detail: 'contract_unverified' },
      status: 'contract_unverified'
    })
  })

  it('blocks as clef_identity_unpinned when the response model is not pinned', () => {
    expect(blockerOf({ profile: fixtureProfileRecord({ expectedResponseModel: null }) })).toEqual({
      blocker: { reason: 'classifier_unavailable', detail: 'clef_identity_unpinned' },
      status: 'identity_unpinned'
    })
  })

  it('blocks a profile record that fails the response-profile schema as contract_unverified', () => {
    const malformed = fixtureProfileRecord()
    const broken: ClefVerifiedProfileRecord = JSON.parse(
      JSON.stringify({ ...malformed, profile: { ...malformed.profile, envelopeMode: 'other' } })
    )
    expect(blockerOf({ profile: broken })?.blocker.detail).toBe('contract_unverified')
  })

  it('reports the first failing gate in G0 order', () => {
    expect(
      blockerOf({
        status: { protection: 'absent', tokenPresent: false, accountPresent: false },
        profile: null
      })?.blocker.detail
    ).toBe('not_configured')
    expect(blockerOf({ profile: null })?.blocker.detail).toBe('contract_unverified')
  })
})
