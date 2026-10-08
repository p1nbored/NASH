import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CodexAppServerInvocation,
  CodexAppServerRpc
} from '../../codex/codex-app-server-session'
import type * as AppServerSession from '../../codex/codex-app-server-session'
import type * as CodexCommand from '../../codex-cli/command'
import type * as CodexHomePaths from '../../codex/codex-home-paths'
import { CodexAppServerUnsupportedError } from '../../codex/codex-app-server-session'
import { getCodexExplicitHomeHookSourcePath, escapeTomlString } from '../../codex/config-toml-trust'
import { getRuntimeHooksWithSystemUserHooks } from '../../codex/codex-hook-user-mirroring'
import { PERMISSION_HOOK_TIMEOUT_SECONDS } from '../../../shared/workflow-run/autopilot-cli-commands'
import { getPermissionHookCommand } from './permission-hook-command'
import { approveCodexPermissionHook } from './permission-codex-trust'

const mocks = vi.hoisted(() => ({ runSession: vi.fn(), systemHome: '' }))
vi.mock('../../codex/codex-app-server-session', async (original) => ({
  ...(await original<typeof AppServerSession>()),
  runCodexAppServerSession: mocks.runSession
}))
vi.mock('../../codex-cli/command', async (original) => ({
  ...(await original<typeof CodexCommand>()),
  resolveCodexCommand: () => '/fixture/codex'
}))
vi.mock('../../codex/codex-home-paths', async (original) => ({
  ...(await original<typeof CodexHomePaths>()),
  getSystemCodexHomePath: () => mocks.systemHome
}))

const OWN_HASH = 'sha256:vendor-owned-permission-definition'
const USER_COMMAND = 'user-owned-script'
let home = ''
let command = ''
let hooksPath = ''
let writes: Record<string, unknown>[] = []
let scratchHomes: string[] = []

type ProbeOptions = {
  disabled?: boolean
  differentHash?: boolean
  changed?: boolean
  foreignSource?: boolean
  alreadyTrusted?: boolean
  refuseGrant?: boolean
  withoutApprovals?: boolean
}

function definition(gateCommand: string) {
  return {
    matcher: '*',
    hooks: [{ type: 'command', command: gateCommand, timeout: PERMISSION_HOOK_TIMEOUT_SECONDS }]
  }
}

function fakeCodex(options: ProbeOptions = {}): void {
  const trusted = new Set<string>()
  mocks.runSession.mockImplementation(
    async (
      invocation: CodexAppServerInvocation,
      body: (rpc: CodexAppServerRpc) => Promise<unknown>
    ) => {
      const codexHome = invocation.env?.CODEX_HOME
      if (!codexHome) {
        throw new Error('A test must use an explicit isolated Codex home')
      }
      const scratch = codexHome !== mocks.systemHome
      if (scratch) {
        scratchHomes.push(codexHome)
      }
      const source = getCodexExplicitHomeHookSourcePath(join(codexHome, 'hooks.json'))
      const config = JSON.parse(readFileSync(join(codexHome, 'hooks.json'), 'utf8'))
      if (scratch) {
        expect(config).toEqual({ hooks: { PermissionRequest: [definition(command)] } })
      }
      return body({
        notify: () => {},
        request: async (method, params) => {
          if (method === 'config/batchWrite') {
            if (scratch) {
              throw new Error('Scratch discovery must not grant trust')
            }
            writes.push(params ?? {})
            const edits = params?.edits
            if (!Array.isArray(edits)) {
              throw new Error('Expected edits')
            }
            const grants = edits[0].value
            let toml = readFileSync(join(codexHome, 'config.toml'), 'utf8')
            for (const [key, value] of Object.entries(grants)) {
              if (typeof value !== 'object' || value === null || !('trusted_hash' in value)) {
                throw new Error('Expected hash')
              }
              trusted.add(key)
              toml += `\n[hooks.state."${escapeTomlString(key)}"]\ntrusted_hash = "${String(value.trusted_hash)}"\n`
            }
            writeFileSync(join(codexHome, 'config.toml'), toml)
            return {}
          }
          if (method !== 'hooks/list') {
            throw new Error(`Unexpected ${method}`)
          }
          const listed = config.hooks.PermissionRequest.map(
            (group: { hooks: { command: string }[] }, index: number) => {
              const own = group.hooks[0].command === command
              const key = `${!scratch && options.foreignSource && own ? '/other/hooks.json' : source}:permission_request:${index}:0`
              return {
                key,
                command: group.hooks[0].command,
                currentHash: options.withoutApprovals
                  ? null
                  : own
                    ? !scratch && options.differentHash
                      ? 'sha256:changed'
                      : OWN_HASH
                    : 'sha256:user',
                trustStatus: options.withoutApprovals
                  ? null
                  : options.alreadyTrusted || (trusted.has(key) && !options.refuseGrant)
                    ? 'trusted'
                    : 'untrusted',
                enabled: !(own && options.disabled)
              }
            }
          )
          if (!scratch && options.changed) {
            writeFileSync(
              hooksPath,
              JSON.stringify({ hooks: { PermissionRequest: [definition(USER_COMMAND)] } })
            )
          }
          return { data: [{ hooks: listed }] }
        }
      })
    }
  )
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nash-permission-codex-test-'))
  mocks.systemHome = join(home, '.codex')
  mkdirSync(mocks.systemHome)
  hooksPath = join(mocks.systemHome, 'hooks.json')
  command = getPermissionHookCommand('codex', home)
  writeFileSync(
    hooksPath,
    JSON.stringify({
      hooks: { PermissionRequest: [definition(USER_COMMAND), definition(command)] }
    })
  )
  writeFileSync(
    join(mocks.systemHome, 'config.toml'),
    '# User configuration remains intact\nmodel = "fixture-model"\n'
  )
  writes = []
  scratchHomes = []
  mocks.runSession.mockReset()
})

afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('Codex permission gate trust', () => {
  it('grants only the exact owned definition with Codex hashes and mirrors that grant to runtime homes', async () => {
    fakeCodex()
    expect(await approveCodexPermissionHook(home)).toEqual({ status: 'trusted' })
    const key = `${getCodexExplicitHomeHookSourcePath(hooksPath)}:permission_request:1:0`
    expect(writes).toEqual([
      {
        edits: [
          {
            keyPath: 'hooks.state',
            value: { [key]: { trusted_hash: OWN_HASH } },
            mergeStrategy: 'upsert'
          }
        ],
        reloadUserConfig: true
      }
    ])
    expect(readFileSync(join(mocks.systemHome, 'config.toml'), 'utf8')).toContain(
      '# User configuration remains intact'
    )
    const runtimeConfig = join(home, 'runtime', 'hooks.json')
    const mirrored = getRuntimeHooksWithSystemUserHooks(undefined, () => false, runtimeConfig)
    expect(mirrored?.hooks.PermissionRequest).toEqual([
      definition(USER_COMMAND),
      definition(command)
    ])
    expect(mirrored?.trustEntries).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({
          command,
          trustedHash: OWN_HASH,
          eventLabel: 'permission_request',
          groupIndex: 1
        })
      })
    ])
    expect(scratchHomes.every((scratch) => !existsSync(scratch))).toBe(true)
  })

  it.each([
    [{ disabled: true }, 'disabled'],
    [{ differentHash: true }, 'hash_mismatch'],
    [{ changed: true }, 'gate_changed'],
    [{ foreignSource: true }, 'hook_not_listed']
  ] as const)(
    'grants nothing when discovery fails the ownership check: %s',
    async (options, reason) => {
      fakeCodex(options)
      expect(await approveCodexPermissionHook(home)).toEqual({
        status: 'native_approval_required',
        reason
      })
      expect(writes).toEqual([])
      expect(scratchHomes.every((scratch) => !existsSync(scratch))).toBe(true)
    }
  )

  it('mirrors the vendor grant when the system home is reached through a directory alias', async () => {
    fakeCodex()
    expect(await approveCodexPermissionHook(home)).toEqual({ status: 'trusted' })
    const alias = join(home, 'codex-home-alias')
    symlinkSync(mocks.systemHome, alias, process.platform === 'win32' ? 'junction' : 'dir')
    mocks.systemHome = alias

    const mirrored = getRuntimeHooksWithSystemUserHooks(
      undefined,
      () => false,
      join(home, 'runtime', 'hooks.json')
    )
    expect(mirrored?.trustEntries).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({ command, trustedHash: OWN_HASH })
      })
    ])
  })

  it('requires native approval when Codex does not support the trust API', async () => {
    mocks.runSession.mockRejectedValue(new CodexAppServerUnsupportedError('unsupported'))
    expect(await approveCodexPermissionHook(home)).toEqual({
      status: 'native_approval_required',
      reason: 'unsupported'
    })
    expect(writes).toEqual([])
    expect(existsSync(mocks.runSession.mock.calls[0][0].env.CODEX_HOME)).toBe(false)
  })

  it('does not report trust when Codex refuses to retain the granted hash', async () => {
    fakeCodex({ refuseGrant: true })
    expect(await approveCodexPermissionHook(home)).toEqual({
      status: 'native_approval_required',
      reason: 'verification_failed'
    })
    expect(writes).toHaveLength(1)
  })

  it.each([{ alreadyTrusted: true }, { withoutApprovals: true }])(
    'does not write an unnecessary grant with %j',
    async (options) => {
      fakeCodex(options)
      expect(await approveCodexPermissionHook(home)).toEqual({ status: 'trusted' })
      expect(writes).toEqual([])
    }
  )

  it('never probes or approves a modified gate definition', async () => {
    writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: { PermissionRequest: [{ ...definition(command), matcher: 'different' }] }
      })
    )
    expect(await approveCodexPermissionHook(home)).toEqual({
      status: 'native_approval_required',
      reason: 'gate_missing'
    })
    expect(mocks.runSession).not.toHaveBeenCalled()
  })

  it('leaves Codex alone while its existing state index cannot be read', async () => {
    writeFileSync(join(mocks.systemHome, 'state_5.sqlite'), 'unreadable-index')
    expect(await approveCodexPermissionHook(home)).toEqual({
      status: 'native_approval_required',
      reason: 'provider_busy'
    })
    expect(mocks.runSession).not.toHaveBeenCalled()
  })
})
