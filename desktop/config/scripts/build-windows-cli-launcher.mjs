#!/usr/bin/env node

import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { compileWindowsRustExecutable } from './windows-rust-executable-build.mjs'

const { cliCommandName } = createRequire(import.meta.url)(
  '../../src/shared/app-identity-constants.json'
)

function readArg(name) {
  const index = process.argv.indexOf(name)
  return index !== -1 ? process.argv[index + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = resolve(import.meta.dirname, '../..')
  const crateRoot = join(repoRoot, 'native', 'windows-cli-launcher')
  const iconPath = join(repoRoot, 'resources', 'build', 'icon.ico')
  const output = readArg('--output') ?? join(crateRoot, '.build', `${cliCommandName}.exe`)
  for (const binName of [cliCommandName, 'orca-administrator-restart']) {
    compileWindowsRustExecutable({
      repoRoot,
      crateRoot,
      binName,
      label:
        binName === cliCommandName
          ? 'Windows CLI launcher'
          : 'Windows administrator restart launcher',
      fingerprintInputs: [
        join(crateRoot, 'src', 'administrator_status.rs'),
        join(crateRoot, 'src', 'administrator_restart.rs'),
        join(crateRoot, 'src', 'administrator_launcher.rs'),
        iconPath,
        join(repoRoot, 'config/scripts/build-windows-cli-launcher.mjs')
      ],
      arch: readArg('--arch'),
      outputPath: binName === cliCommandName ? output : join(dirname(output), `${binName}.exe`),
      buildEnv: (version) => ({
        ORCA_LAUNCHER_VERSION: version,
        ORCA_LAUNCHER_ICON: iconPath,
        ORCA_LAUNCHER_FILENAME: `${binName}.exe`
      })
    })
  }
}
