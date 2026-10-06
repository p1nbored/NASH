import { describe, expect, it } from 'vitest'
import { APP_IDENTITY } from './app-identity-constants'
import { APP_COMPUTER_USE_BUNDLE_ID, APP_TCC_RESPONSIBLE_BUNDLE_IDS } from './app-identity-bundle-ids'

// FIXTURE_ONLY: bundle ids a real Orca install uses (decision D-017).
const ORCA_BUNDLE_IDS = [
  'com.stablyai.orca',
  'com.stablyai.orca.helper',
  'com.stablyai.orca.dev',
  'com.stablyai.orca.dev.helper',
  'com.stablyai.orca.local',
  'com.stablyai.orca.local.helper',
  'com.stablyai.orca.computer-use'
]

describe('NASH macOS bundle ids', () => {
  it('derives the computer-use helper bundle id from the app id', () => {
    expect(APP_COMPUTER_USE_BUNDLE_ID).toBe(`${APP_IDENTITY.appId}.computer-use`)
  })

  it('lists the app, its helper and its dev and local channel bundles as TCC responsible identities', () => {
    const appId = APP_IDENTITY.appId

    expect([...APP_TCC_RESPONSIBLE_BUNDLE_IDS].sort()).toEqual(
      [
        appId,
        `${appId}.helper`,
        `${appId}.dev`,
        `${appId}.dev.helper`,
        `${appId}.local`,
        `${appId}.local.helper`
      ].sort()
    )
  })

  it('never includes a bundle id a real Orca install uses', () => {
    const ours = [APP_COMPUTER_USE_BUNDLE_ID, ...APP_TCC_RESPONSIBLE_BUNDLE_IDS]

    for (const orcaBundleId of ORCA_BUNDLE_IDS) {
      expect(ours).not.toContain(orcaBundleId)
    }
  })
})
