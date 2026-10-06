#!/usr/bin/env node
// Symlinks the nash-dev wrapper into /usr/local/bin so the dev CLI is
// available globally after `pnpm run build:cli`.
import { existsSync, lstatSync, readlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const { devCliCommandName } = createRequire(import.meta.url)(
  '../../src/shared/app-identity-constants.json'
)

const scriptDir = import.meta.dirname
const source = path.join(scriptDir, 'orca-dev.mjs')

const commandPath =
  process.platform === 'darwin' || process.platform === 'linux'
    ? `/usr/local/bin/${devCliCommandName}`
    : null

if (!commandPath) {
  console.log(`[${devCliCommandName}] Skipping global symlink (unsupported platform).`)
  process.exit(0)
}

function isOwnedByUs(target) {
  try {
    if (!lstatSync(target).isSymbolicLink()) {
      return false
    }
    return readlinkSync(target) === source
  } catch {
    return false
  }
}

if (existsSync(commandPath)) {
  if (isOwnedByUs(commandPath)) {
    console.log(`[${devCliCommandName}] ${commandPath} already points to dev CLI.`)
    process.exit(0)
  }
  console.error(
    `[${devCliCommandName}] ${commandPath} exists but is not our symlink. Remove it manually if you want the dev CLI installed globally.`
  )
  process.exit(0)
}

try {
  execFileSync('ln', ['-s', source, commandPath], { stdio: 'inherit' })
  console.log(`[${devCliCommandName}] Symlinked ${commandPath} → ${source}`)
} catch {
  console.log(
    `[${devCliCommandName}] Could not create ${commandPath} (permission denied). Run once with:\n` +
      `  sudo ln -s ${source} ${commandPath}`
  )
}
