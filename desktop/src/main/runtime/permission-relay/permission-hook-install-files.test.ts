import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPermissionHooks } from './permission-hook-install'
import { getPermissionHookCommand } from './permission-hook-command'
import type * as HooksRead from '../../agent-hooks/hooks-json-read'

const routing = vi.hoisted(() => {
  type Router = {
    systemDefaultHome(): string
    selectedHome(): string | null
    accountHomes(): string[]
  }
  const state: { router: Router | undefined } = { router: undefined }
  return state
})
const readBoundary = vi.hoisted(() => ({ beforeRead: (_path: string) => {} }))

vi.mock('../../claude-accounts/claude-profile-installed-router', () => ({
  getClaudeProfileRouter: () => routing.router
}))
vi.mock('../../agent-hooks/hooks-json-read', async (importOriginal) => {
  const actual = await importOriginal<typeof HooksRead>()
  return {
    ...actual,
    readHooksJsonWithRaw: (path: string) => {
      readBoundary.beforeRead(path)
      return actual.readHooksJsonWithRaw(path)
    }
  }
})

describe('permission hook files on the local execution host', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nash-permission-hooks-'))
    routing.router = undefined
    readBoundary.beforeRead = () => {}
    vi.stubEnv('CLAUDE_CONFIG_DIR', '')
    vi.stubEnv('ORCA_CLAUDE_INJECTED_CONFIG_DIR', '')
    vi.stubEnv('ORCA_CLAUDE_USER_CONFIG_DIR', '')
  })

  afterEach(() => {
    routing.router = undefined
    readBoundary.beforeRead = () => {}
    vi.unstubAllEnvs()
    if (!home.startsWith(join(tmpdir(), 'nash-permission-hooks-'))) {
      throw new Error('Unexpected fixture directory')
    }
    rmSync(home, { recursive: true, force: true })
  })

  function write(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  function expectGate(path: string, provider: 'claude' | 'codex' | 'agy'): void {
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      [provider === 'agy' ? 'nash-permission-relay' : 'hooks']: {
        [provider === 'agy' ? 'PreToolUse' : 'PermissionRequest']: [
          { hooks: [{ command: getPermissionHookCommand(provider, home) }] }
        ]
      }
    })
  }

  it('writes all provider gates and preserves existing settings without adding Codex trust', () => {
    const claude = join(home, '.claude', 'settings.json')
    write(
      claude,
      JSON.stringify({ permissions: { deny: ['Bash(rm *)'] }, env: { FIXTURE: 'keep' } })
    )
    installPermissionHooks('nash', home)

    expect(JSON.parse(readFileSync(claude, 'utf8'))).toMatchObject({
      permissions: { deny: ['Bash(rm *)'] },
      env: { FIXTURE: 'keep' }
    })
    expectGate(claude, 'claude')
    expectGate(join(home, '.codex', 'hooks.json'), 'codex')
    expectGate(join(home, '.gemini', 'config', 'hooks.json'), 'agy')
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false)

    const before = readFileSync(claude, 'utf8')
    const backup = readFileSync(`${claude}.bak`, 'utf8')
    installPermissionHooks('nash', home)
    expect(readFileSync(claude, 'utf8')).toBe(before)
    expect(readFileSync(`${claude}.bak`, 'utf8')).toBe(backup)
  })

  it('uses the inherited Claude config directory rather than creating another default', () => {
    const configured = join(home, 'inherited-claude')
    vi.stubEnv('CLAUDE_CONFIG_DIR', configured)

    installPermissionHooks('nash', home)

    expectGate(join(configured, 'settings.json'), 'claude')
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false)
  })

  it('follows the installed account router for selected and other existing local profiles', () => {
    const system = join(home, 'shell-default')
    const selected = join(home, 'account-one')
    const other = join(home, 'account-two')
    routing.router = {
      systemDefaultHome: () => system,
      selectedHome: () => selected,
      accountHomes: () => [selected, other]
    }

    installPermissionHooks('nash', home)

    for (const configHome of [system, selected, other]) {
      expectGate(join(configHome, 'settings.json'), 'claude')
    }
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false)
  })

  it('does not replace a missing selected profile with the default account', () => {
    routing.router = {
      systemDefaultHome: () => join(home, '.claude'),
      selectedHome: () => {
        throw new Error('Selected account unavailable')
      },
      accountHomes: () => []
    }

    expect(installPermissionHooks('nash', home)).toEqual({
      installed: ['codex', 'agy'],
      failures: [{ provider: 'claude', code: 'profile_unavailable' }]
    })
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false)
  })

  it('leaves malformed settings untouched', () => {
    const file = join(home, '.claude', 'settings.json')
    write(file, '{broken')

    expect(installPermissionHooks('nash', home)).toEqual({
      installed: ['codex', 'agy'],
      failures: [{ provider: 'claude', code: 'config_unreadable' }]
    })
    expect(readFileSync(file, 'utf8')).toBe('{broken')
    expect(existsSync(`${file}.bak`)).toBe(false)
  })

  it('preserves an external edit detected before the atomic write', () => {
    const file = join(home, '.claude', 'settings.json')
    const external = JSON.stringify({ permissions: { deny: ['Read(private/**)'] } })
    write(file, '{}')
    let reads = 0
    readBoundary.beforeRead = (path) => {
      if (path === file && ++reads === 2) {
        write(file, external)
      }
    }

    expect(installPermissionHooks('nash', home)).toEqual({
      installed: ['codex', 'agy'],
      failures: [{ provider: 'claude', code: 'config_changed' }]
    })
    expect(readFileSync(file, 'utf8')).toBe(external)
    expect(existsSync(`${file}.bak`)).toBe(false)
  })

  it('continues other providers when an unused provider has an invalid hook collection', () => {
    const file = join(home, '.codex', 'hooks.json')
    const malformed = JSON.stringify({ hooks: { PermissionRequest: 'do not overwrite' } })
    write(file, malformed)

    expect(installPermissionHooks('nash', home)).toEqual({
      installed: ['claude', 'agy'],
      failures: [{ provider: 'codex', code: 'config_invalid' }]
    })
    expect(readFileSync(file, 'utf8')).toBe(malformed)
    expectGate(join(home, '.gemini', 'config', 'hooks.json'), 'agy')
  })
})
