import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as InstallerUtils from '../agent-hooks/installer-utils'
import type * as WindowsHookFiles from './windows-hook-files'
import type * as NodePath from 'node:path'

// Why: production only reaches its win32 branch on Windows, where node:path is path.win32; keep
// that pairing when a POSIX host stubs the platform.
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof NodePath>()
  return {
    ...actual,
    basename: (...args: Parameters<typeof actual.basename>) =>
      (process.platform === 'win32' ? actual.win32 : actual).basename(...args)
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/userData'
  }
}))

// Why: record script writes instead of making them, so this test never puts a .cmd file on disk.
const scriptWrites = vi.hoisted(() => {
  const paths: string[] = []
  return { paths }
})
vi.mock('./windows-hook-files', async (importOriginal) => ({
  ...(await importOriginal<typeof WindowsHookFiles>()),
  installWindowsClaudeHookFiles: (scriptPath: string) => {
    scriptWrites.paths.push(scriptPath)
  }
}))
vi.mock('../agent-hooks/installer-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallerUtils>()),
  writeManagedScript: (scriptPath: string) => {
    scriptWrites.paths.push(scriptPath)
  }
}))

import { ClaudeHookService } from './hook-service'
import { getManagedCommand } from './hook-settings'
import { getManagedStatusLineCommand } from './statusline-script'

const USER_STATUS_LINE = { type: 'command', command: '/usr/local/bin/my-statusline' }
const STATUSLINE_SCRIPT_FILE_NAME =
  process.platform === 'win32' ? 'claude-statusline.cmd' : 'claude-statusline.sh'
const EARLIER_NASH_STATUS_LINE = {
  type: 'command',
  command: `"\${HOME-}/.nash/agent-hooks/${STATUSLINE_SCRIPT_FILE_NAME}"`
}

// Why (G8, user decision of 2026-10-06): NASH's Claude usage comes from the primary sessions' own
// relay, so no Claude version leads NASH to write the user-global statusLine slot.
describe('Claude statusLine by resolved version', () => {
  let tmpHome: string
  let settingsPath: string

  beforeEach(() => {
    scriptWrites.paths.length = 0
    tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-version-'))
    settingsPath = join(tmpHome, '.claude', 'settings.json')
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(tmpHome, { recursive: true, force: true })
  })

  const readSettings = () => JSON.parse(readFileSync(settingsPath, 'utf-8'))
  const seed = (settings: unknown) => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(settings))
  }

  it('writes no statusLine for a Claude whose settings schema rejects it', () => {
    new ClaudeHookService().install({ claudeVersion: '1.0.63' })
    expect(readSettings().statusLine).toBeUndefined()
    expect(readSettings().hooks.SessionStart).toBeDefined()
  })

  it.each([['2.1.261'], ['1.0.64'], [undefined]])(
    'writes no statusLine and no statusline script for Claude %s',
    (claudeVersion) => {
      new ClaudeHookService().install({ claudeVersion })
      expect(readSettings().statusLine).toBeUndefined()
      expect(readSettings().hooks.SessionStart).toBeDefined()
      expect(scriptWrites.paths.map((path) => basename(path))).not.toContain(
        STATUSLINE_SCRIPT_FILE_NAME
      )
      expect(scriptWrites.paths.length).toBeGreaterThan(0)
      expect(existsSync(join(tmpHome, '.nash', 'agent-hooks', STATUSLINE_SCRIPT_FILE_NAME))).toBe(
        false
      )
    }
  )

  it('removes an earlier NASH statusLine for an old and for a current Claude', () => {
    seed({ statusLine: EARLIER_NASH_STATUS_LINE })
    new ClaudeHookService().install({ claudeVersion: '1.0.63' })
    expect(readSettings().statusLine).toBeUndefined()

    seed({ statusLine: EARLIER_NASH_STATUS_LINE })
    new ClaudeHookService().install({ claudeVersion: '2.1.261' })
    expect(readSettings().statusLine).toBeUndefined()
  })

  it.each([['1.0.63'], ['2.1.261'], [undefined]])(
    'never removes or replaces a user statusLine for Claude %s',
    (claudeVersion) => {
      seed({ statusLine: USER_STATUS_LINE })
      new ClaudeHookService().install({ claudeVersion })
      expect(readSettings().statusLine).toEqual(USER_STATUS_LINE)
    }
  )
})

describe('Claude statusLine on Windows', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const CURRENT_CLAUDE = { claudeVersion: '2.1.261' }
  let tmpHome: string
  let settingsPath: string
  let scriptPath: string

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-win-'))
    settingsPath = join(tmpHome, '.claude', 'settings.json')
    scriptPath = join(tmpHome, '.nash', 'agent-hooks', 'claude-statusline.cmd')
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs()
    rmSync(tmpHome, { recursive: true, force: true })
  })

  const readSettings = () => JSON.parse(readFileSync(settingsPath, 'utf-8'))
  const seedStatusLine = (command: string) => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command } }))
  }

  it('registers a cmd-safe script bare, which Windows PowerShell can run', () => {
    expect(
      getManagedStatusLineCommand('C:\\Users\\alice\\.nash\\agent-hooks\\claude-statusline.cmd')
    ).toBe('C:/Users/alice/.nash/agent-hooks/claude-statusline.cmd')
  })

  it('keeps the runtime-home form for an unsafe path rather than an encoded PowerShell launcher', () => {
    const spaced = 'C:\\Users\\John Smith\\.nash\\agent-hooks\\claude-statusline.cmd'
    // Why: the encoded launcher would start a hidden PowerShell on every statusline tick.
    expect(getManagedStatusLineCommand(spaced)).toBe(getManagedCommand(spaced))
  })

  it.each([
    ['the runtime-home form', () => getManagedCommand(scriptPath)],
    ['a stale bare path', () => 'C:/Users/someone-else/.nash/agent-hooks/claude-statusline.cmd']
  ])('retires %s as NASH-owned', (_name, command) => {
    seedStatusLine(command())
    // Why: the marker from an earlier install must not read as the user's opt-out.
    mkdirSync(join(tmpHome, '.nash', 'agent-hooks'), { recursive: true })
    writeFileSync(join(tmpHome, '.nash', 'agent-hooks', 'claude-statusline.installed'), '')

    new ClaudeHookService().install(CURRENT_CLAUDE)
    expect(readSettings().statusLine).toBeUndefined()
  })

  it.each(['C:/tools/my-statusline.cmd', 'powershell -NoProfile -File C:\\tools\\statusline.ps1'])(
    'never overwrites or removes a user statusLine: %s',
    (command) => {
      seedStatusLine(command)
      new ClaudeHookService().install(CURRENT_CLAUDE)
      expect(readSettings().statusLine).toEqual({ type: 'command', command })
      new ClaudeHookService().remove()
      expect(readSettings().statusLine).toEqual({ type: 'command', command })
    }
  )
})
