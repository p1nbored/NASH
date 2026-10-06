import { describe, expect, it } from 'vitest'
import { isOrcaProfilePath, readInheritedUserDataPath } from './inherited-user-data-path'

// FIXTURE_ONLY: profile folders a real Orca install uses, and ones NASH or a test harness may use.
const ORCA_PROFILES = [
  'C:\\Users\\tester\\AppData\\Roaming\\orca',
  'C:\\Users\\tester\\AppData\\Roaming\\Orca',
  'C:\\Users\\tester\\AppData\\Roaming\\orca-dev',
  'C:/Users/tester/AppData/Roaming/orca',
  '/Users/tester/Library/Application Support/orca',
  '/Users/tester/Library/Application Support/orca-dev',
  '/home/tester/.config/orca',
  '/home/tester/.config/orca/',
  'C:\\Users\\tester\\AppData\\Roaming\\orca\\',
  'orca'
]
const ALLOWED_PROFILES = [
  '/home/tester/.config/nash',
  '/Users/tester/Library/Application Support/nash-dev',
  'C:\\Users\\tester\\AppData\\Roaming\\nash',
  // Test harnesses and smoke scripts point the CLI at a temp profile.
  '/tmp/orca-user-data',
  '/tmp/nash-dev-profile',
  '/home/tester/orca/nash',
  '/home/tester/code/orca/tmp/profile'
]

describe('isOrcaProfilePath', () => {
  it.each(ORCA_PROFILES)('recognizes %s as an Orca profile', (path) => {
    expect(isOrcaProfilePath(path)).toBe(true)
  })

  it.each(ALLOWED_PROFILES)('does not treat %s as an Orca profile', (path) => {
    expect(isOrcaProfilePath(path)).toBe(false)
  })
})

describe('readInheritedUserDataPath', () => {
  it('returns an explicit NASH or temp profile unchanged', () => {
    for (const path of ALLOWED_PROFILES) {
      expect(readInheritedUserDataPath({ ORCA_USER_DATA_PATH: path })).toBe(path)
    }
  })

  it('ignores an inherited Orca profile so the caller falls back to the NASH default', () => {
    for (const path of ORCA_PROFILES) {
      expect(readInheritedUserDataPath({ ORCA_USER_DATA_PATH: path })).toBeUndefined()
    }
  })

  it('treats an unset or empty value as absent', () => {
    expect(readInheritedUserDataPath({})).toBeUndefined()
    expect(readInheritedUserDataPath({ ORCA_USER_DATA_PATH: '' })).toBeUndefined()
    expect(readInheritedUserDataPath({ ORCA_USER_DATA_PATH: '   ' })).toBeUndefined()
  })

  it('reads the process environment by default', () => {
    const previous = process.env.ORCA_USER_DATA_PATH
    try {
      process.env.ORCA_USER_DATA_PATH = '/home/tester/.config/orca'
      expect(readInheritedUserDataPath()).toBeUndefined()
      process.env.ORCA_USER_DATA_PATH = '/home/tester/.config/nash'
      expect(readInheritedUserDataPath()).toBe('/home/tester/.config/nash')
    } finally {
      if (previous === undefined) {
        delete process.env.ORCA_USER_DATA_PATH
      } else {
        process.env.ORCA_USER_DATA_PATH = previous
      }
    }
  })
})
