import { describe, expect, it } from 'vitest'
import { APP_IDENTITY } from './app-identity-constants'

// FIXTURE_ONLY: the upstream Orca identity that NASH must never share (decision D-017).
const ORCA_IDENTITY = {
  appId: 'com.stablyai.orca',
  productName: 'Orca',
  devProductName: 'Orca Dev',
  userDataDirName: 'orca',
  devUserDataDirName: 'orca-dev',
  windowsExecutableBaseName: 'Orca',
  localAppDataRootName: 'Orca',
  cliCommandName: 'orca',
  devCliCommandName: 'orca-dev',
  documentProgIdPrefix: 'Orca',
  urlScheme: 'orca'
} as const

describe('NASH app identity constants', () => {
  it('pins the NASH identity values', () => {
    expect(APP_IDENTITY).toEqual({
      appId: 'com.pinbored.nash',
      productName: 'NASH',
      devProductName: 'NASH Dev',
      userDataDirName: 'nash',
      devUserDataDirName: 'nash-dev',
      windowsExecutableBaseName: 'NASH',
      localAppDataRootName: 'NASH',
      cliCommandName: 'nash',
      devCliCommandName: 'nash-dev',
      documentProgIdPrefix: 'NASH',
      urlScheme: 'nash',
      releaseRepository: { owner: 'p1nbored', repo: 'NASH' },
      updateFeed: { owner: 'p1nbored', repo: 'NASH', whatsNew: null, devChannels: false }
    })
  })

  it('uses a reverse-DNS app id that is not the Orca one', () => {
    expect(APP_IDENTITY.appId).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/)
    expect(APP_IDENTITY.appId).not.toBe(ORCA_IDENTITY.appId)
    expect(APP_IDENTITY.appId.startsWith(`${ORCA_IDENTITY.appId}.`)).toBe(false)
  })

  it('never reuses an Orca identity value, ignoring case because Windows and macOS folders are case-insensitive', () => {
    for (const key of Object.keys(ORCA_IDENTITY) as (keyof typeof ORCA_IDENTITY)[]) {
      expect(APP_IDENTITY[key].toLowerCase(), key).not.toBe(ORCA_IDENTITY[key].toLowerCase())
    }
  })

  it('uses its own release repository for updates', () => {
    expect(APP_IDENTITY.updateFeed).toMatchObject(APP_IDENTITY.releaseRepository)
  })

  it('traces issues and source to the NASH repository, not Orca (D-036)', () => {
    expect(APP_IDENTITY.releaseRepository).toEqual({ owner: 'p1nbored', repo: 'NASH' })
    expect(APP_IDENTITY.releaseRepository.owner.toLowerCase()).not.toBe('stablyai')
  })

  it('uses a URL scheme that is a valid lowercase scheme and not the Orca one', () => {
    expect(APP_IDENTITY.urlScheme).toMatch(/^[a-z][a-z0-9+.-]*$/)
    expect(APP_IDENTITY.urlScheme).not.toBe(ORCA_IDENTITY.urlScheme)
  })

  it('keeps dev data and dev command distinct from the packaged ones', () => {
    expect(APP_IDENTITY.devUserDataDirName).not.toBe(APP_IDENTITY.userDataDirName)
    expect(APP_IDENTITY.devCliCommandName).not.toBe(APP_IDENTITY.cliCommandName)
    expect(APP_IDENTITY.devUserDataDirName).toBe(`${APP_IDENTITY.userDataDirName}-dev`)
    expect(APP_IDENTITY.devCliCommandName).toBe(`${APP_IDENTITY.cliCommandName}-dev`)
  })
})
