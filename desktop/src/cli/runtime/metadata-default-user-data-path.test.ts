import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_IDENTITY } from '../../shared/app-identity-constants'
import {
  ORCA_DEV_USER_DATA_DIR_NAME,
  ORCA_USER_DATA_DIR_NAME,
  USER_DATA_PLATFORM_CASES
} from '../../shared/app-identity-platform-cases.test-fixture'
import { getDefaultUserDataPath } from './metadata'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getDefaultUserDataPath', () => {
  it('resolves the NASH macOS folder', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    expect(getDefaultUserDataPath('darwin', '/Users/tester')).toBe(
      join('/Users/tester', 'Library', 'Application Support', 'nash')
    )
  })

  it('resolves the NASH Windows folder under APPDATA', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    vi.stubEnv('APPDATA', 'C:\\Users\\tester\\AppData\\Roaming')
    expect(getDefaultUserDataPath('win32', 'C:\\Users\\tester')).toBe(
      join('C:\\Users\\tester\\AppData\\Roaming', 'nash')
    )
  })

  it('refuses to guess a Windows folder when APPDATA is unset', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    vi.stubEnv('APPDATA', undefined)
    expect(() => getDefaultUserDataPath('win32', 'C:\\Users\\tester')).toThrow(/APPDATA/)
  })

  it('resolves the NASH Linux folder from XDG_CONFIG_HOME or ~/.config', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    vi.stubEnv('XDG_CONFIG_HOME', '/srv/xdg')
    expect(getDefaultUserDataPath('linux', '/home/tester')).toBe(join('/srv/xdg', 'nash'))
    vi.stubEnv('XDG_CONFIG_HOME', '')
    expect(getDefaultUserDataPath('linux', '/home/tester')).toBe(
      join('/home/tester', '.config', 'nash')
    )
  })

  it('never falls back to an Orca folder on any platform', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    vi.stubEnv('APPDATA', 'C:\\Users\\tester\\AppData\\Roaming')
    vi.stubEnv('XDG_CONFIG_HOME', undefined)
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const resolved = getDefaultUserDataPath(platform, '/home/tester').toLowerCase()
      expect(resolved.endsWith('orca')).toBe(false)
      expect(resolved.endsWith('orca-dev')).toBe(false)
    }
  })

  it.each(USER_DATA_PLATFORM_CASES)(
    'agrees with the app: <appData>/nash, never an Orca folder, on $platform (appData=$appData)',
    ({ platform, home, appData, env }) => {
      vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
      for (const [key, value] of Object.entries(env)) {
        vi.stubEnv(key, value)
      }

      const resolved = getDefaultUserDataPath(platform, home)

      // Why this exact value: configureDevUserDataPath pins the app to the same folder, so the CLI finds its runtime metadata.
      expect(resolved).toBe(join(appData, APP_IDENTITY.userDataDirName))
      expect(resolved.toLowerCase()).not.toBe(join(appData, ORCA_USER_DATA_DIR_NAME).toLowerCase())
      expect(resolved.toLowerCase()).not.toBe(
        join(appData, ORCA_DEV_USER_DATA_DIR_NAME).toLowerCase()
      )
    }
  )

  it('lets an explicit ORCA_USER_DATA_PATH target a specific instance', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', join('/tmp', 'nash-dev-profile'))
    expect(getDefaultUserDataPath('linux', '/home/tester')).toBe(join('/tmp', 'nash-dev-profile'))
  })

  // D-017: a `nash` command started in a real Orca terminal inherits that terminal's profile path.
  describe('a profile inherited from a real Orca terminal', () => {
    it.each(USER_DATA_PLATFORM_CASES)(
      'is ignored and resolves the NASH folder on $platform (appData=$appData)',
      ({ platform, home, appData, env }) => {
        for (const [key, value] of Object.entries(env)) {
          vi.stubEnv(key, value)
        }
        const orcaProfile = join(appData, ORCA_USER_DATA_DIR_NAME)
        const orcaDevProfile = join(appData, ORCA_DEV_USER_DATA_DIR_NAME)

        for (const inherited of [orcaProfile, orcaDevProfile, `${orcaProfile}/`]) {
          vi.stubEnv('ORCA_USER_DATA_PATH', inherited)
          expect(getDefaultUserDataPath(platform, home)).toBe(
            join(appData, APP_IDENTITY.userDataDirName)
          )
        }
      }
    )

    it('is ignored whatever the case of the folder name, since Windows and macOS folders are case-insensitive', () => {
      vi.stubEnv('XDG_CONFIG_HOME', undefined)
      vi.stubEnv('ORCA_USER_DATA_PATH', '/Users/tester/Library/Application Support/Orca')

      expect(getDefaultUserDataPath('darwin', '/Users/tester')).toBe(
        join('/Users/tester', 'Library', 'Application Support', 'nash')
      )
    })

    it('does not block a NASH profile that happens to sit under a folder named orca', () => {
      vi.stubEnv('ORCA_USER_DATA_PATH', '/home/tester/orca/nash-profile')

      expect(getDefaultUserDataPath('linux', '/home/tester')).toBe('/home/tester/orca/nash-profile')
    })
  })
})
