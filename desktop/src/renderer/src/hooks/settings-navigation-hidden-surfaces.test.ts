import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'

const flags = vi.hoisted(() => ({ orcaAccountAndMobileUi: false }))

vi.mock('../../../shared/nash-build-flags', () => ({
  get ORCA_ACCOUNT_AND_MOBILE_UI_ENABLED() {
    return flags.orcaAccountAndMobileUi
  },
  RSI_NAVIGATION_ENABLED: false,
  ORCA_STAR_PROMPT_ENABLED: false
}))

import { buildSettingsNavigationMetadata } from './useSettingsNavigationMetadata'

const repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 0
} satisfies Repo

function ids(isWebClient = false): string[] {
  return buildSettingsNavigationMetadata({
    isMac: false,
    isWindows: false,
    isWebClient,
    repos: [repo]
  }).map((section) => section.id)
}

describe('Orca Account and Mobile settings behind their build flag (D-038)', () => {
  afterEach(() => {
    flags.orcaAccountAndMobileUi = false
  })

  it('keeps both categories out of Settings and search while the flag is off', () => {
    expect(ids()).not.toContain('orca-account')
    expect(ids()).not.toContain('mobile')
  })

  it('restores both desktop categories under Set Up when the flag is on', () => {
    flags.orcaAccountAndMobileUi = true
    const desktopIds = ids()

    expect(desktopIds).toContain('orca-account')
    expect(desktopIds).toContain('mobile')
    expect(ids(true)).not.toContain('orca-account')
    expect(ids(true)).not.toContain('mobile')
  })
})
