import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDevUserDataPath } from './dev-user-data-path.mjs'

const identity = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', '..', 'src', 'shared', 'app-identity-constants.json'),
    'utf8'
  )
)

describe('getDevUserDataPath', () => {
  it('resolves nash-dev under the macOS Application Support folder', () => {
    expect(getDevUserDataPath({ platform: 'darwin', env: { HOME: '/Users/tester' } })).toBe(
      path.join('/Users/tester', 'Library', 'Application Support', 'nash-dev')
    )
  })

  it('resolves nash-dev under APPDATA on Windows and falls back to the profile Roaming folder', () => {
    expect(getDevUserDataPath({ platform: 'win32', env: { APPDATA: 'C:\\Roaming' } })).toBe(
      path.join('C:\\Roaming', 'nash-dev')
    )
    expect(
      getDevUserDataPath({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\tester' } })
    ).toBe(path.join('C:\\Users\\tester', 'AppData', 'Roaming', 'nash-dev'))
  })

  it('resolves nash-dev under XDG_CONFIG_HOME or ~/.config on Linux', () => {
    expect(getDevUserDataPath({ platform: 'linux', env: { XDG_CONFIG_HOME: '/srv/xdg' } })).toBe(
      path.join('/srv/xdg', 'nash-dev')
    )
    expect(getDevUserDataPath({ platform: 'linux', env: { HOME: '/home/tester' } })).toBe(
      path.join('/home/tester', '.config', 'nash-dev')
    )
  })

  it('lets ORCA_DEV_USER_DATA_PATH select an isolated profile', () => {
    expect(
      getDevUserDataPath({
        platform: 'linux',
        env: { ORCA_DEV_USER_DATA_PATH: '/tmp/isolated', HOME: '/home/tester' }
      })
    ).toBe('/tmp/isolated')
  })

  it('reads the folder name from the shared identity and never falls back to orca-dev', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const resolved = getDevUserDataPath({
        platform,
        env: { HOME: '/home/tester', APPDATA: 'C:\\Roaming' }
      })
      expect(path.basename(resolved)).toBe(identity.devUserDataDirName)
      expect(path.basename(resolved).toLowerCase()).not.toBe('orca-dev')
    }
  })
})
