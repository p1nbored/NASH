import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOrcaUserDataPath } from './codex-home-paths'

// D-017: the profile that CLI hook commands resolve (offline `hooks status/on/off`) must be NASH's.
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
})

describe('getOrcaUserDataPath', () => {
  it('falls back to the NASH folder in the macOS application support folder', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    setPlatform('darwin')

    expect(getOrcaUserDataPath()).toBe(join(homedir(), 'Library', 'Application Support', 'nash'))
  })

  it('falls back to the NASH folder under APPDATA on Windows', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    vi.stubEnv('APPDATA', join('C:', 'Users', 'tester', 'AppData', 'Roaming'))
    setPlatform('win32')

    expect(getOrcaUserDataPath()).toBe(join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'nash'))
  })

  it('falls back to the NASH folder under XDG_CONFIG_HOME on Linux', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    vi.stubEnv('XDG_CONFIG_HOME', join('/srv', 'xdg'))
    setPlatform('linux')

    expect(getOrcaUserDataPath()).toBe(join('/srv', 'xdg', 'nash'))
  })

  it.each(['darwin', 'win32', 'linux'] as const)(
    'never falls back to an Orca folder on %s',
    (platform) => {
      vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
      vi.stubEnv('APPDATA', join('C:', 'Users', 'tester', 'AppData', 'Roaming'))
      vi.stubEnv('XDG_CONFIG_HOME', undefined)
      setPlatform(platform)

      const resolved = getOrcaUserDataPath().toLowerCase()

      expect(resolved.endsWith('orca')).toBe(false)
      expect(resolved.endsWith('orca-dev')).toBe(false)
    }
  )

  it('uses an explicit non-Orca profile as is', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', join('/tmp', 'nash-dev-profile'))

    expect(getOrcaUserDataPath()).toBe(join('/tmp', 'nash-dev-profile'))
  })

  it('ignores a profile inherited from a real Orca terminal', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', join('/home', 'tester', '.config', 'orca'))
    vi.stubEnv('XDG_CONFIG_HOME', join('/srv', 'xdg'))
    setPlatform('linux')

    expect(getOrcaUserDataPath()).toBe(join('/srv', 'xdg', 'nash'))
  })
})
