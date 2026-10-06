import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir(),
    getAppPath: () => tmpdir()
  }
}))

import { CliInstaller } from './cli-installer'
import { makeFixture } from './cli-installer-test-fixtures'
import { buildLegacyAppImageCliWrapper } from './legacy-appimage-cli-wrapper'

// D-017: NASH never shipped a bare `orca` Linux command, so a `~/.local/bin/orca` on the machine
// belongs to a real Orca install (or to GNOME Orca) and the installer must never remove it.
class LegacyCleanupProbe extends CliInstaller {
  runLegacyCleanup(launcherPath: string | null): Promise<void> {
    return this.removeLegacyLinuxCommandIfManaged(launcherPath)
  }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function arrange(): Promise<{
  installer: LegacyCleanupProbe
  legacyCommandPath: string
  launcherPath: string
  wrapper: string
}> {
  const fixture = await makeFixture()
  roots.push(fixture.root)
  const homePath = join(fixture.root, 'home')
  const commandDir = join(homePath, '.local', 'bin')
  const appImagePath = join(fixture.root, 'Orca.AppImage')
  const legacyCommandPath = join(commandDir, 'orca')
  const wrapper = buildLegacyAppImageCliWrapper(appImagePath)
  await mkdir(commandDir, { recursive: true })
  await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
  await writeFile(legacyCommandPath, wrapper, { encoding: 'utf8', mode: 0o755 })
  const installer = new LegacyCleanupProbe({
    platform: 'linux',
    isPackaged: true,
    userDataPath: fixture.userDataPath,
    appPath: fixture.appPath,
    appImagePath,
    appImageCacheRootPath: join(fixture.root, 'cache'),
    homePath,
    processPathEnv: commandDir
  })
  return {
    installer,
    legacyCommandPath,
    launcherPath: join(fixture.root, 'resources', 'bin', 'orca-ide'),
    wrapper
  }
}

describe('Linux installer and a bare `orca` command', () => {
  it('leaves a ~/.local/bin/orca wrapper that names this AppImage untouched', async () => {
    const { installer, legacyCommandPath, launcherPath, wrapper } = await arrange()

    await installer.runLegacyCleanup(launcherPath)

    await expect(readFile(legacyCommandPath, 'utf8')).resolves.toBe(wrapper)
  })

  it('leaves it untouched when no launcher is known', async () => {
    const { installer, legacyCommandPath, wrapper } = await arrange()

    await installer.runLegacyCleanup(null)

    await expect(readFile(legacyCommandPath, 'utf8')).resolves.toBe(wrapper)
  })
})
