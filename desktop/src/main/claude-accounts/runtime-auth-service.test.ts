import { homedir } from 'node:os'
import { join } from 'node:path'
import type * as NodeFs from 'node:fs'
import type * as NodeFsPromises from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fsWrites, keychainWrites, wslHomes, FS_WRITE_NAMES, FS_PROMISE_WRITE_NAMES } = vi.hoisted(
  () => ({
    fsWrites: [] as string[],
    keychainWrites: [] as string[],
    wslHomes: new Map<string, string | null>(),
    FS_WRITE_NAMES: [
      'writeFileSync',
      'appendFileSync',
      'renameSync',
      'rmSync',
      'unlinkSync',
      'copyFileSync',
      'mkdirSync',
      'chmodSync'
    ],
    FS_PROMISE_WRITE_NAMES: ['writeFile', 'appendFile', 'rename', 'rm', 'unlink', 'copyFile', 'mkdir', 'chmod']
  })
)

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  const recorded = Object.fromEntries(
    FS_WRITE_NAMES.map((name) => [
      name,
      (...args: unknown[]) => {
        fsWrites.push(`${name}:${String(args[0])}`)
      }
    ])
  )
  return { ...actual, ...recorded, default: { ...actual, ...recorded } }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  const recorded = Object.fromEntries(
    FS_PROMISE_WRITE_NAMES.map((name) => [
      name,
      async (...args: unknown[]) => {
        fsWrites.push(`${name}:${String(args[0])}`)
      }
    ])
  )
  return { ...actual, ...recorded, default: { ...actual, ...recorded } }
})
vi.mock('../macos-keychain/generic-password', () => ({
  readKeychainPassword: async () => null,
  writeKeychainPassword: async (service: string) => {
    keychainWrites.push(`write:${service}`)
  },
  deleteKeychainPassword: async (service: string) => {
    keychainWrites.push(`delete:${service}`)
  }
}))
vi.mock('../wsl', () => ({
  getDefaultWslDistro: () => 'Ubuntu',
  getWslHome: (distro: string) => wslHomes.get(distro) ?? null
}))

import { ClaudeRuntimeAuthService } from './runtime-auth-service'

// FIXTURE_ONLY: retired managed-account keys a profile written before G5 may still carry.
const RETIRED_SETTINGS = {
  claudeManagedAccounts: [
    {
      id: 'retired-account',
      email: 'fixture@example.invalid',
      managedAuthPath: join('fixture', 'claude-accounts', 'retired-account', 'auth'),
      authMethod: 'subscription-oauth',
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    }
  ],
  activeClaudeManagedAccountId: 'retired-account',
  activeClaudeManagedAccountIdsByRuntime: { host: 'retired-account', wsl: {} }
}

function serviceFor(settings: Record<string, unknown> = {}): ClaudeRuntimeAuthService {
  const store = { getSettings: () => ({ localAccountRuntime: 'host', ...settings }) }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the service reads only getSettings.
  return new ClaudeRuntimeAuthService(store as never)
}

describe('ClaudeRuntimeAuthService (system login only)', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const fetchSpy = vi.fn()

  beforeEach(() => {
    fsWrites.length = 0
    keychainWrites.length = 0
    wslHomes.clear()
    delete process.env.CLAUDE_CONFIG_DIR
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
  })

  it('prepares host launches on the default ~/.claude login without stripping auth env', async () => {
    const service = serviceFor(RETIRED_SETTINGS)
    const expected = {
      configDir: join(homedir(), '.claude'),
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }

    expect(service.getPreparation({ runtime: 'host' })).toEqual(expected)
    await expect(service.prepareForClaudeLaunch({ runtime: 'host' })).resolves.toEqual(expected)
    await expect(service.prepareForRateLimitFetch()).resolves.toEqual(expected)
    expect(service.getRuntimeConfigDir()).toBe(join(homedir(), '.claude'))
  })

  it('keeps an inherited CLAUDE_CONFIG_DIR as the launch config dir', async () => {
    const inherited = join(homedir(), 'fixture-claude-config')
    process.env.CLAUDE_CONFIG_DIR = inherited

    const preparation = await serviceFor().prepareForClaudeLaunch()

    expect(preparation.configDir).toBe(inherited)
    expect(preparation.envPatch).toEqual({ CLAUDE_CONFIG_DIR: inherited })
    expect(preparation.stripAuthEnv).toBe(false)
  })

  it('keeps the WSL system preparation unchanged', async () => {
    const home = '\\\\wsl.localhost\\Ubuntu\\home\\dev'
    wslHomes.set('Ubuntu', home)

    await expect(
      serviceFor(RETIRED_SETTINGS).prepareForClaudeLaunch({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    ).resolves.toEqual({
      configDir: join(home, '.claude'),
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      wslLinuxConfigDir: '/home/dev/.claude',
      envPatch: {},
      stripAuthEnv: true,
      provenance: 'wsl:Ubuntu:system'
    })
  })

  it('resolves a WSL target without a distro to the default distro', () => {
    wslHomes.set('Ubuntu', '\\\\wsl.localhost\\Ubuntu\\home\\dev')

    expect(serviceFor().getPreparation({ runtime: 'wsl', wslDistro: null })).toMatchObject({
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      provenance: 'wsl:Ubuntu:system'
    })
  })

  it('falls back to the host config dir when the WSL home is unknown', () => {
    expect(serviceFor().getPreparation({ runtime: 'wsl', wslDistro: 'Debian' })).toEqual({
      configDir: join(homedir(), '.claude'),
      runtime: 'wsl',
      wslDistro: 'Debian',
      wslLinuxConfigDir: null,
      envPatch: {},
      stripAuthEnv: true,
      provenance: 'wsl:Debian:system'
    })
  })

  it('writes no credential, oauthAccount or Keychain item and calls no token endpoint', async () => {
    const service = serviceFor(RETIRED_SETTINGS)

    await service.prepareForClaudeLaunch()
    await service.prepareForClaudeLaunch({ runtime: 'host' })
    await service.prepareForRateLimitFetch({ runtime: 'host' })
    await service.prepareForRateLimitFetch({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    service.getRuntimeConfigDir({ runtime: 'host' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fsWrites).toEqual([])
    expect(keychainWrites).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('offers no account sync, selection or rollback entry point', () => {
    const service = serviceFor()
    for (const removed of [
      'syncForCurrentSelection',
      'forceMaterializeCurrentSelectionForRollback',
      'clearLastWrittenCredentialsJson'
    ]) {
      expect(removed in service).toBe(false)
    }
  })
})
