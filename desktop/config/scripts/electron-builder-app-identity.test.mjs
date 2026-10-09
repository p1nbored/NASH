import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const identity = require('../../src/shared/app-identity-constants.json')
const config = require('../electron-builder.config.cjs')
const installerHooks = readFileSync(
  join(import.meta.dirname, '..', 'nsis', 'orca-installer-hooks.nsh'),
  'utf8'
)

// FIXTURE_ONLY: the Orca identity strings NASH must never ship (decision D-017).
const ORCA_APP_ID = 'com.stablyai.orca'

function resourceTargets(resources) {
  return resources.map((resource) => resource.to.replaceAll('\\', '/'))
}

describe('electron-builder NASH identity', () => {
  it('uses the NASH app id, product name and Windows executable name', () => {
    expect(config.appId).toBe('com.pinbored.nash')
    expect(config.appId).toBe(identity.appId)
    expect(config.appId).not.toBe(ORCA_APP_ID)
    expect(config.productName).toBe('NASH')
    expect(config.productName).toBe(identity.productName)
    expect(config.win.executableName).toBe('NASH')
    expect(config.win.executableName).toBe(identity.windowsExecutableBaseName)
  })

  it('names the installer and shortcuts after NASH', () => {
    expect(config.nsis.artifactName).toBe('nash-windows-setup.${ext}')
    expect(config.nsis.shortcutName).toBe('${productName}')
    expect(config.nsis.uninstallDisplayName).toBe('${productName}')
    expect(config.dmg.artifactName).toBe('nash-macos-${arch}.${ext}')
  })

  it('ships the Windows global launcher as nash and keeps orca out of the global bin directory', () => {
    const targets = resourceTargets(config.win.extraResources)
    expect(targets).toEqual(expect.arrayContaining(['bin/nash.cmd', 'bin/nash.exe']))
    expect(targets.filter((target) => /^bin\/orca/i.test(target))).toEqual([])
  })

  it('ships the macOS global launcher as nash and keeps orca out of the global bin directory', () => {
    const targets = resourceTargets(config.mac.extraResources)
    expect(targets).toContain('bin/nash')
    expect(targets.filter((target) => /^bin\/orca/i.test(target))).toEqual([])
  })

  it('provides the in-session orca alias only in a directory the global PATH registration never adds', () => {
    expect(resourceTargets(config.win.extraResources)).toContain('session-bin/orca.exe')
    expect(resourceTargets(config.mac.extraResources)).toContain('session-bin/orca')
  })

  it('builds the Windows launcher under the NASH name', () => {
    const launcher = config.win.extraResources.find((resource) => resource.to === 'bin/nash.exe')
    expect(launcher.from).toBe('native/windows-cli-launcher/.build/nash.exe')
  })
})

describe('electron-builder update feed and URL scheme', () => {
  it('generates updater metadata for the NASH release repository', () => {
    expect(config.publish).toEqual({
      provider: 'github',
      owner: 'p1nbored',
      repo: 'NASH',
      releaseType: 'draft'
    })
    for (const platform of [config.mac, config.win, config.linux, config.nsis, config.dmg]) {
      expect(platform.publish).toBeUndefined()
    }
  })

  it('does not claim an upstream Windows signing identity for unsigned NASH builds', () => {
    expect(config.win.signtoolOptions?.publisherName).toBeUndefined()
    expect(config.win.verifyUpdateCodeSignature).toBeUndefined()
  })

  it('keeps every Orca release repository out of the whole config', () => {
    expect(JSON.stringify(config)).not.toMatch(/stablyai\/orca|"owner":"stablyai"|"repo":"orca/)
  })

  it('has no dev updater config that names a release feed', () => {
    const devConfigPath = join(import.meta.dirname, '..', 'dev-app-update.yml')
    expect(existsSync(devConfigPath)).toBe(false)
  })

  it('registers the NASH URL scheme and never the Orca one', () => {
    expect(identity.urlScheme).toBe('nash')
    expect(config.protocols).toEqual([
      { name: identity.productName, schemes: [identity.urlScheme] }
    ])
    expect(config.protocols.flatMap((protocol) => protocol.schemes)).not.toContain('orca')
  })
})

describe('NSIS installer hooks NASH identity', () => {
  it('removes only the NASH relocated daemon host on a real uninstall', () => {
    expect(installerHooks).toContain(
      `RMDir /r "$LOCALAPPDATA\\${identity.localAppDataRootName}\\daemon-host"`
    )
    expect(installerHooks).not.toMatch(/\$LOCALAPPDATA\\Orca\\/)
  })

  it('never kills an Orca-named daemon image on uninstall', () => {
    expect(installerHooks).not.toContain('orca-terminal-daemon.exe')
  })

  it('registers NASH-owned document ProgIDs instead of the Orca ones', () => {
    expect(installerHooks).toContain(
      `!define MARKDOWN_PROGID "${identity.documentProgIdPrefix}.Markdown"`
    )
    expect(installerHooks).toContain(
      `!define TABULAR_PROGID "${identity.documentProgIdPrefix}.Tabular"`
    )
    expect(installerHooks).not.toMatch(/"Orca\.(Markdown|Tabular)"/)
  })
})
