import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_IDENTITY } from '../../shared/app-identity-constants'
import { getBundledLauncherPath, getSessionAliasBinDir } from './bundled-cli-launcher-path'
import { DEFAULT_MAC_COMMAND_PATH, DEV_COMMAND_NAME } from './cli-install-constants'

const RESOURCES = join('/opt', 'NASH', 'resources')

describe('NASH globally installed CLI command (D-017)', () => {
  it('names the global command nash and the dev command nash-dev', () => {
    expect(DEV_COMMAND_NAME).toBe('nash-dev')
    expect(DEV_COMMAND_NAME).toBe(APP_IDENTITY.devCliCommandName)
    expect(DEFAULT_MAC_COMMAND_PATH).toBe('/usr/local/bin/nash')
    expect(basename(DEFAULT_MAC_COMMAND_PATH)).toBe(APP_IDENTITY.cliCommandName)
  })

  it('ships the packaged macOS and Windows launchers under the NASH command name', () => {
    expect(getBundledLauncherPath('darwin', RESOURCES)).toBe(join(RESOURCES, 'bin', 'nash'))
    expect(getBundledLauncherPath('win32', RESOURCES)).toBe(join(RESOURCES, 'bin', 'nash.exe'))
  })

  it('never puts an orca-named launcher in the directory registered on the global PATH', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const launcher = getBundledLauncherPath(platform, RESOURCES)
      expect(basename(launcher ?? '').toLowerCase()).not.toMatch(/^orca/)
    }
    expect(DEV_COMMAND_NAME).not.toMatch(/^orca/)
    expect(basename(DEFAULT_MAC_COMMAND_PATH)).not.toMatch(/^orca/)
  })

  it('keeps the in-session orca alias in a directory the global registration never adds', () => {
    const aliasDir = getSessionAliasBinDir(RESOURCES)
    expect(aliasDir).toBe(join(RESOURCES, 'session-bin'))
    expect(aliasDir).not.toBe(join(RESOURCES, 'bin'))
  })
})
