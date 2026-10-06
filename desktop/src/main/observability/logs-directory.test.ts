import type * as NodeOs from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ platform: 'win32', home: '/home/tester' }))

vi.mock('../../shared/app-environment', () => ({
  hasAppEnvironment: () => false,
  getAppEnvironment: () => {
    throw new Error('no app environment in this test')
  }
}))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOs>()
  return { ...actual, platform: () => host.platform, homedir: () => host.home }
})

import { getLogsDirectory } from './logs-directory'

beforeEach(() => {
  host.home = join('/home', 'tester')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getLogsDirectory without an app environment', () => {
  it('falls back to the NASH Windows userData folder, never the Orca one', () => {
    host.platform = 'win32'
    vi.stubEnv('APPDATA', join('/roaming'))
    expect(getLogsDirectory()).toBe(join('/roaming', 'nash', 'logs'))
  })

  it('falls back to the NASH macOS userData folder', () => {
    host.platform = 'darwin'
    expect(getLogsDirectory()).toBe(
      join(host.home, 'Library', 'Application Support', 'nash', 'logs')
    )
  })

  it('falls back to the NASH Linux userData folder', () => {
    host.platform = 'linux'
    expect(getLogsDirectory()).toBe(join(host.home, '.config', 'nash', 'logs'))
  })
})
