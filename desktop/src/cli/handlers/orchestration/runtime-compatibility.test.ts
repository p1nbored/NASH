import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDevCliInvocation } from './runtime-compatibility'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isDevCliInvocation', () => {
  it('treats the NASH dev userData folder as a dev invocation', () => {
    vi.stubEnv('ORCA_DEV_CLI_INVOCATION', undefined)
    vi.stubEnv('ORCA_USER_DATA_PATH', 'C:\\Users\\tester\\AppData\\Roaming\\nash-dev')
    expect(isDevCliInvocation()).toBe(true)
  })

  it('treats the packaged NASH userData folder as a non-dev invocation', () => {
    vi.stubEnv('ORCA_DEV_CLI_INVOCATION', undefined)
    vi.stubEnv('ORCA_USER_DATA_PATH', 'C:\\Users\\tester\\AppData\\Roaming\\nash')
    expect(isDevCliInvocation()).toBe(false)
  })

  it('honours explicit dev provenance for a custom profile path', () => {
    vi.stubEnv('ORCA_DEV_CLI_INVOCATION', '1')
    vi.stubEnv('ORCA_USER_DATA_PATH', '/tmp/custom-profile')
    expect(isDevCliInvocation()).toBe(true)
  })

  it('does not treat an unset profile as dev', () => {
    vi.stubEnv('ORCA_DEV_CLI_INVOCATION', undefined)
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    expect(isDevCliInvocation()).toBe(false)
  })
})
