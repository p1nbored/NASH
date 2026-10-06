import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as InstallerUtils from '../agent-hooks/installer-utils'
import type * as WindowsHookFiles from './windows-hook-files'

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
