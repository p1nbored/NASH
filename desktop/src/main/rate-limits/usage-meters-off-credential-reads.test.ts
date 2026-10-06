import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCursorAccountStatus } from '../cursor-accounts/status'
import { getGrokAccountStatus } from '../grok-accounts/status'
import { registerZcodePlanCredentialsHandlers } from '../ipc/zcode-plan-credentials'
import { runProcess, spawnProcess } from '../../shared/child-process/run-process'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../codex-cli/codex-read-only-app-server-args'
import { readCursorAuthSession } from './cursor-auth'
import { readGrokAuthSession } from './grok-auth'
import { hasZcodeCliPlanCredentials, fetchZcodeRateLimits } from './zcode-usage-fetcher'
import { ANTIGRAVITY_USAGE_ARGS, ANTIGRAVITY_VERSION_ARGS } from './antigravity-usage-command'
import { probeCodexAuthPresence } from './codex-auth-presence'
import { getCodexBackendAuthHeaders } from './codex-backend-auth'
import {
  readClaudeCredentialsFromStrictKeychain,
  readClaudeOAuthCredentials
} from './claude-oauth-credentials'
import { fetchClaudeOAuthUsage } from './claude-oauth-usage-request'
import { fetchViaPty } from './claude-pty'
import { readAuthJson, readGeminiCredentials } from './gemini-oauth-sources'
import { fetchKimiRateLimits } from './kimi-fetcher'
import { RateLimitService } from './service'
import {
  FakeRateLimitWindow,
  asRateLimitWindow,
  flushMicrotasks
} from './rate-limit-service-test-harness'
import { EventEmitter } from 'node:events'
import type * as CodexBackendAuth from './codex-backend-auth'
import type * as ClaudeOAuthCredentials from './claude-oauth-credentials'
import type * as GeminiOAuthSources from './gemini-oauth-sources'

// FIXTURE_ONLY: every credential reader and vendor HTTP path is a spy that must never run. The
// only processes are the fake `codex app-server` and `agy` children below; nothing is spawned.
const ipc = vi.hoisted(() => ({ handle: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: ipc.handle } }))
vi.mock('./cursor-auth', () => ({ readCursorAuthSession: vi.fn() }))
vi.mock('./grok-auth', () => ({ readGrokAuthSession: vi.fn(), isGrokAccessTokenFresh: vi.fn() }))
vi.mock('./zcode-usage-fetcher', () => ({
  hasZcodeCliPlanCredentials: vi.fn(() => true),
  fetchZcodeRateLimits: vi.fn()
}))
vi.mock('../zcode/zcode-plan-api-key-store', () => ({
  hasZcodePlanApiKey: vi.fn(() => false),
  getZcodePlanApiKeyProtection: vi.fn(() => null),
  saveZcodePlanApiKey: vi.fn(),
  clearZcodePlanApiKey: vi.fn()
}))
vi.mock('../../shared/child-process/run-process', () => ({
  spawnProcess: vi.fn(),
  runProcess: vi.fn()
}))
vi.mock('../codex-cli/command', () => ({ resolveCodexCommand: () => 'codex' }))
vi.mock('../windows-process-tree-kill', () => ({ terminateWindowsProcessTree: vi.fn() }))
vi.mock('../startup/login-shell-environment', () => ({
  resolveLoginShellEnvironment: vi.fn(async () => ({ PATH: '/fixture/bin' }))
}))
vi.mock('../ipc/command-path-resolver', () => ({
  resolveCommandOnLocalPath: vi.fn(async () => '/fixture/bin/agy')
}))
vi.mock('./codex-auth-presence', () => ({ probeCodexAuthPresence: vi.fn() }))
vi.mock('./codex-backend-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof CodexBackendAuth>()),
  getCodexBackendAuthHeaders: vi.fn()
}))
vi.mock('./claude-oauth-credentials', async (importOriginal) => ({
  ...(await importOriginal<typeof ClaudeOAuthCredentials>()),
  readClaudeOAuthCredentials: vi.fn(),
  readClaudeCredentialsFromStrictKeychain: vi.fn()
}))
vi.mock('./claude-oauth-usage-request', () => ({ fetchClaudeOAuthUsage: vi.fn() }))
vi.mock('./claude-pty', () => ({ fetchViaPty: vi.fn() }))
vi.mock('./gemini-oauth-sources', async (importOriginal) => ({
  ...(await importOriginal<typeof GeminiOAuthSources>()),
  readAuthJson: vi.fn(),
  readGeminiCredentials: vi.fn()
}))
vi.mock('./kimi-fetcher', () => ({ fetchKimiRateLimits: vi.fn() }))

const CREDENTIAL_READERS = [
  readCursorAuthSession,
  readGrokAuthSession,
  hasZcodeCliPlanCredentials,
  probeCodexAuthPresence,
  getCodexBackendAuthHeaders,
  readClaudeOAuthCredentials,
  readClaudeCredentialsFromStrictKeychain,
  readAuthJson,
  readGeminiCredentials
]
const OTHER_USAGE_SOURCES = [
  fetchClaudeOAuthUsage,
  fetchViaPty,
  fetchKimiRateLimits,
  fetchZcodeRateLimits
]

const AGY_USAGE = JSON.stringify({
  conversation_id: '',
  status: 'SUCCESS',
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 0.4,
              reset_time: '2026-10-07T08:08:35Z'
            }
          ]
        }
      ]
    }
  }
})

function fakeAppServer(): EventEmitter {
  const exit = (): void => queueMicrotask(() => child.emit('close', 0, null))
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 4242,
    exitCode: null,
    kill: vi.fn(() => {
      exit()
      return true
    })
  })
  const send = (message: unknown): void => {
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify(message)}\n`)))
  }
  const stdin = Object.assign(new EventEmitter(), {
    end: vi.fn(exit),
    write: vi.fn((line: string) => {
      const message = JSON.parse(line) as { id?: number; method?: string }
      if (message.method === 'initialize') {
        send({ id: message.id, result: {} })
      }
      if (message.method === 'account/rateLimits/read') {
        send({
          id: message.id,
          result: { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 } } }
        })
      }
      return true
    })
  })
  return Object.assign(child, { stdin })
}

describe('usage settings read no CLI credential with the meters off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports Cursor as not read, without the keychain or auth file', async () => {
    await expect(getCursorAccountStatus()).resolves.toEqual({
      signedIn: false,
      email: null,
      displayName: null,
      credentialSource: null,
      planType: null,
      tokenFresh: false,
      error: null
    })
    expect(readCursorAuthSession).not.toHaveBeenCalled()
  })

  it('reports Grok as not read, without the auth file', () => {
    expect(getGrokAccountStatus()).toEqual({
      signedIn: false,
      email: null,
      teamId: null,
      tokenFresh: false,
      error: null
    })
    expect(readGrokAuthSession).not.toHaveBeenCalled()
  })

  it('does not look for the ZCode CLI plan key', () => {
    registerZcodePlanCredentialsHandlers(null)
    const registration = ipc.handle.mock.calls.find(
      ([channel]) => channel === 'zcodePlanCredentials:getStatus'
    )
    expect(registration?.[1]()).toEqual({
      apiKeyConfigured: false,
      zcodeCliConfigured: false,
      apiKeyProtection: null
    })
    expect(hasZcodeCliPlanCredentials).not.toHaveBeenCalled()
  })
})

describe('CLI usage readings on every trigger: no credential read, no vendor HTTP', () => {
  const vendorHttp = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vendorHttp)
    vi.stubEnv('CLAUDE_CONFIG_DIR', '')
    vi.mocked(spawnProcess).mockImplementation(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake implements the stdio surface the probe uses.
      () => fakeAppServer() as unknown as ReturnType<typeof spawnProcess>
    )
    vi.mocked(runProcess).mockImplementation(async (spec) => ({
      code: 0,
      signal: null,
      stderr: '',
      timedOut: false,
      stdout: spec.args?.[0] === '--version' ? 'agy version 1.2.16\n' : AGY_USAGE
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reads Claude, Codex and agy only through their CLIs across start, focus, poll, refresh and switches', async () => {
    vi.useFakeTimers()
    const service = new RateLimitService()
    const claudeAuth = vi.fn()
    const codexHome = vi.fn()
    service.setClaudeAuthPreparationResolver(claudeAuth)
    service.setCodexHomePathResolver(codexHome)
    service.setCliCodexHomeResolver(async () => '/fixture/codex-home')
    service.setAntigravityUsageEnabledResolver(() => true)
    const window = new FakeRateLimitWindow()
    service.attach(asRateLimitWindow(window))
    service.start({ fetchImmediately: false })
    await vi.advanceTimersByTimeAsync(1_000)
    window.emit('focus')
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    await service.refresh()
    await service.refreshIfStale()
    await service.refreshGrok()
    await service.refreshCodexForTarget({ runtime: 'host', wslDistro: null })
    await service.refreshClaudeForTarget({ runtime: 'host', wslDistro: null })
    await service.refreshForCodexAccountChange('outgoing')
    await service.fetchInactiveCodexAccountsOnOpen()
    service.ingestLiveClaudeRateLimits({
      configDir: null,
      fiveHour: { used_percentage: 33 },
      sevenDay: null
    })
    await expect(
      service.consumeCodexRateLimitResetCredit({
        idempotencyKey: 'fixture-key',
        target: { runtime: 'host', wslDistro: null },
        codexHomePath: '/fixture/codex-home'
      })
    ).rejects.toThrow()
    await flushMicrotasks()

    const state = service.getState()
    expect(state.claude).toMatchObject({ status: 'ok', usageMetadata: { source: 'live-session' } })
    expect(state.codex).toMatchObject({ status: 'ok', usageMetadata: { source: 'cli' } })
    expect(state.antigravity).toMatchObject({ status: 'ok', usageMetadata: { source: 'cli' } })
    expect(vi.mocked(spawnProcess).mock.calls.length).toBeGreaterThan(0)
    for (const [spec] of vi.mocked(spawnProcess).mock.calls) {
      expect(spec.args).toEqual([...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS])
      expect(spec.env?.CODEX_HOME).toBe('/fixture/codex-home')
    }
    for (const [spec] of vi.mocked(runProcess).mock.calls) {
      expect([ANTIGRAVITY_VERSION_ARGS, ANTIGRAVITY_USAGE_ARGS]).toContainEqual(spec.args)
    }
    for (const reader of [...CREDENTIAL_READERS, ...OTHER_USAGE_SOURCES]) {
      expect(vi.mocked(reader)).not.toHaveBeenCalled()
    }
    expect(claudeAuth).not.toHaveBeenCalled()
    expect(codexHome).not.toHaveBeenCalled()
    expect(vendorHttp).not.toHaveBeenCalled()
    service.stop()
  })
})
