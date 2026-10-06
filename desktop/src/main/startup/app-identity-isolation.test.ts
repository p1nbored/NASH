import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_IDENTITY } from '../../shared/app-identity-constants'
import {
  ORCA_DEV_USER_DATA_DIR_NAME,
  ORCA_USER_DATA_DIR_NAME,
  USER_DATA_PLATFORM_CASES
} from '../../shared/app-identity-platform-cases.test-fixture'

const appDataPath = vi.hoisted(() => ({ value: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'appData' ? appDataPath.value : '')),
    setPath: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    isPackaged: false,
    commandLine: { appendSwitch: vi.fn(), getSwitchValue: vi.fn(() => '') }
  }
}))

function stubEnv(env: Record<string, string | undefined>): void {
  const ambient = ['ORCA_USER_DATA_PATH', 'ORCA_DEV_USER_DATA_PATH', 'ORCA_E2E_USER_DATA_DIR']
  for (const key of ambient) {
    vi.stubEnv(key, undefined)
  }
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value)
  }
}

describe('NASH user-data isolation from Orca (D-017), app side', () => {
  beforeEach(async () => {
    const { app } = await import('electron')
    vi.mocked(app.setPath).mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(USER_DATA_PLATFORM_CASES)(
    'pins the packaged userData folder to <appData>/nash on $platform (appData=$appData)',
    async ({ appData, env }) => {
      const { app } = await import('electron')
      const { configureDevUserDataPath } = await import('./configure-process')
      stubEnv(env)
      appDataPath.value = appData

      configureDevUserDataPath(false)

      // Why this exact value: the CLI resolves the same folder (see metadata-default-user-data-path.test.ts).
      expect(app.setPath).toHaveBeenLastCalledWith(
        'userData',
        join(appData, APP_IDENTITY.userDataDirName)
      )
    }
  )

  it.each(USER_DATA_PLATFORM_CASES)(
    'never resolves a NASH userData folder equal to an Orca one on $platform (appData=$appData)',
    async ({ appData, env }) => {
      const { app } = await import('electron')
      const { configureDevUserDataPath } = await import('./configure-process')
      stubEnv(env)
      appDataPath.value = appData

      configureDevUserDataPath(false)
      configureDevUserDataPath(true)

      const packaged = vi.mocked(app.setPath).mock.calls[0]?.[1]
      const dev = vi.mocked(app.setPath).mock.calls[1]?.[1]
      const orcaPackaged = join(appData, ORCA_USER_DATA_DIR_NAME)
      const orcaDev = join(appData, ORCA_DEV_USER_DATA_DIR_NAME)
      // Why lower-cased: Windows and macOS file systems are case-insensitive, so Orca and orca are one folder.
      for (const nashPath of [packaged, dev]) {
        expect(nashPath?.toLowerCase()).not.toBe(orcaPackaged.toLowerCase())
        expect(nashPath?.toLowerCase()).not.toBe(orcaDev.toLowerCase())
      }
      // Why: Electron derives the single-instance lock from userData, so distinct folders mean distinct locks.
      expect(packaged).not.toBe(dev)
      expect(dev).toBe(join(appData, APP_IDENTITY.devUserDataDirName))
    }
  )

  it('lets an explicit dev override win and never touches an Orca folder', async () => {
    const { app } = await import('electron')
    const { configureDevUserDataPath } = await import('./configure-process')
    stubEnv({ ORCA_DEV_USER_DATA_PATH: join('/tmp', 'nash-isolated-profile') })
    appDataPath.value = '/home/tester/.config'

    configureDevUserDataPath(true)

    expect(app.setPath).toHaveBeenCalledWith('userData', join('/tmp', 'nash-isolated-profile'))
  })
})
