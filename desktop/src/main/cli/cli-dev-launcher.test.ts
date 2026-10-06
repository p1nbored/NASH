import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureDevLauncher } from './cli-dev-launcher'

let root: string
let cliEntryPath: string
let userDataPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nash-dev-launcher-'))
  cliEntryPath = join(root, 'index.js')
  writeFileSync(cliEntryPath, '// fixture cli entry\n')
  userDataPath = join(root, 'nash-dev')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('ensureDevLauncher NASH command names', () => {
  it('writes the nash-dev launcher and keeps in-session orca aliases on POSIX', async () => {
    const launcherPath = await ensureDevLauncher({
      platform: 'linux',
      userDataPath,
      execPath: '/usr/bin/electron',
      cliEntryPath,
      commandName: 'nash-dev'
    })

    expect(launcherPath).toBe(join(userDataPath, 'cli', 'bin', 'nash-dev'))
    const names = readdirSync(join(userDataPath, 'cli', 'bin')).sort()
    // Why: agents inside NASH terminals still call `orca` / `orca-dev`; only the global command is renamed.
    expect(names).toEqual(['nash-dev', 'orca', 'orca-dev'])
    const launcher = readFileSync(launcherPath!, 'utf8')
    expect(readFileSync(join(userDataPath, 'cli', 'bin', 'orca'), 'utf8')).toBe(launcher)
    expect(readFileSync(join(userDataPath, 'cli', 'bin', 'orca-dev'), 'utf8')).toBe(launcher)
  })

  it('writes the nash-dev.cmd launcher on Windows; the dev runner owns the in-session .cmd aliases', async () => {
    const launcherPath = await ensureDevLauncher({
      platform: 'win32',
      userDataPath,
      execPath: 'C:\\electron\\electron.exe',
      cliEntryPath,
      commandName: 'nash-dev'
    })

    expect(launcherPath).toBe(join(userDataPath, 'cli', 'bin', 'nash-dev.cmd'))
    expect(readdirSync(join(userDataPath, 'cli', 'bin'))).toEqual(['nash-dev.cmd'])
  })

  it('does not write aliases for a packaged-style command name', async () => {
    const launcherPath = await ensureDevLauncher({
      platform: 'linux',
      userDataPath,
      execPath: '/usr/bin/electron',
      cliEntryPath,
      commandName: 'nash'
    })

    expect(launcherPath).toBe(join(userDataPath, 'cli', 'bin', 'nash'))
    expect(existsSync(join(userDataPath, 'cli', 'bin', 'orca'))).toBe(false)
    expect(existsSync(join(userDataPath, 'cli', 'bin', 'orca-dev'))).toBe(false)
  })
})
