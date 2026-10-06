import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits, RateLimitState } from '../../shared/rate-limit-types'
import { RateLimitService } from './service'
import { fetchClaudeRateLimits } from './claude-fetcher'
import { fetchViaPty } from './claude-pty'
import { consumeCodexRateLimitResetCredit, fetchCodexRateLimits } from './codex-fetcher'
import { fetchCodexUsageFromCli } from './codex-cli-usage-fetch'
import { fetchAntigravityRateLimits } from './antigravity-usage-fetcher'
import { fetchGeminiRateLimits } from './gemini-usage-fetcher'
import { fetchKimiRateLimits } from './kimi-fetcher'
import { fetchMiniMaxRateLimits } from './minimax/minimax-fetcher'
import { fetchGrokRateLimits } from './grok-fetcher'
import { readGrokAuthSession } from './grok-auth'
import { fetchCursorRateLimits } from './cursor-fetcher'
import { readCursorAuthSession } from './cursor-auth'
import { fetchOpenCodeGoUsage } from './opencode-go-usage-source-selection'
import { fetchZcodeRateLimits } from './zcode-usage-fetcher'
import { hasMiniMaxSessionCookie } from '../minimax/minimax-cookie-store'
import { hasMiniMaxApiKey } from '../minimax/minimax-api-key-store'
import { hasZcodePlanApiKey } from '../zcode/zcode-plan-api-key-store'
import { USAGE_METER_SOURCE } from './usage-meters-policy'
import {
  FakeRateLimitWindow,
  asRateLimitWindow,
  flushMicrotasks
} from './rate-limit-service-test-harness'

// FIXTURE_ONLY: the two CLI probes return fixture readings; every other usage source and
// credential reader is a spy that must never run.
vi.mock('./codex-cli-usage-fetch', () => ({ fetchCodexUsageFromCli: vi.fn() }))
vi.mock('./antigravity-usage-fetcher', () => ({ fetchAntigravityRateLimits: vi.fn() }))
vi.mock('./claude-pty', () => ({ fetchViaPty: vi.fn() }))
vi.mock('./claude-fetcher', () => ({
  fetchClaudeRateLimits: vi.fn()
}))
vi.mock('./codex-fetcher', () => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchCodexRateLimits: vi.fn()
}))
vi.mock('./gemini-usage-fetcher', () => ({ fetchGeminiRateLimits: vi.fn() }))
vi.mock('./kimi-fetcher', () => ({ fetchKimiRateLimits: vi.fn() }))
vi.mock('./opencode-go-usage-source-selection', () => ({ fetchOpenCodeGoUsage: vi.fn() }))
vi.mock('./zcode-usage-fetcher', () => ({ fetchZcodeRateLimits: vi.fn() }))
vi.mock('./minimax/minimax-fetcher', () => ({ fetchMiniMaxRateLimits: vi.fn() }))
vi.mock('./grok-fetcher', () => ({ fetchGrokRateLimits: vi.fn() }))
vi.mock('./cursor-fetcher', () => ({ fetchCursorRateLimits: vi.fn() }))
vi.mock('./cursor-auth', () => ({ readCursorAuthSession: vi.fn() }))
vi.mock('./grok-auth', () => ({ readGrokAuthSession: vi.fn(() => ({ status: 'missing' })) }))
vi.mock('../minimax/minimax-cookie-store', () => ({ hasMiniMaxSessionCookie: vi.fn(() => false) }))
vi.mock('../minimax/minimax-api-key-store', () => ({ hasMiniMaxApiKey: vi.fn(() => false) }))
vi.mock('../zcode/zcode-plan-api-key-store', () => ({ hasZcodePlanApiKey: vi.fn(() => false) }))

const OFF_SOURCES = [
  fetchClaudeRateLimits,
  fetchViaPty,
  fetchCodexRateLimits,
  consumeCodexRateLimitResetCredit,
  fetchGeminiRateLimits,
  fetchKimiRateLimits,
  fetchOpenCodeGoUsage,
  fetchZcodeRateLimits,
  fetchMiniMaxRateLimits,
  fetchGrokRateLimits,
  fetchCursorRateLimits,
  readCursorAuthSession,
  readGrokAuthSession,
  hasMiniMaxSessionCookie,
  hasMiniMaxApiKey,
  hasZcodePlanApiKey
]
const OFF_PROVIDERS = [
  'gemini',
  'opencodeGo',
  'kimi',
  'minimax',
  'grok',
  'cursor',
  'zcode'
] as const
const MINUTE = 60_000
const CODEX_HOME = '/fixture/codex-home'
const WSL_TARGET = { runtime: 'wsl', wslDistro: 'Ubuntu' } as const

function cliReading(
  provider: 'codex' | 'antigravity',
  usedPercent: number,
  extra: Partial<ProviderRateLimits> = {}
): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: Date.now(),
    error: null,
    status: 'ok',
    usageMetadata: { source: 'cli', attemptedSources: ['cli'], lastSuccessfulSource: 'cli' },
    ...extra
  }
}

/** A service wired the way startup wires it; the credential-preparing resolvers are spies. */
function wiredService(options: { agyShown?: boolean } = {}) {
  const service = new RateLimitService()
  const credentialResolvers = {
    claudeAuth: vi.fn(),
    codexHome: vi.fn(),
    kimiHome: vi.fn(),
    openCodeGo: vi.fn(() => ({ sessionCookie: '', workspaceIdOverride: '' })),
    miniMax: vi.fn(),
    zcode: vi.fn()
  }
  const cliCodexHome = vi.fn(async () => CODEX_HOME)
  const meters = { agyShown: options.agyShown ?? true }
  service.setClaudeAuthPreparationResolver(credentialResolvers.claudeAuth)
  service.setCodexHomePathResolver(credentialResolvers.codexHome)
  service.setKimiHomeResolver(credentialResolvers.kimiHome)
  service.setOpenCodeGoConfigResolver(credentialResolvers.openCodeGo)
  service.setMiniMaxConfigResolver(credentialResolvers.miniMax)
  service.setZcodePlanConfigResolver(credentialResolvers.zcode)
  service.setCliCodexHomeResolver(cliCodexHome)
  service.setAntigravityUsageEnabledResolver(() => meters.agyShown)
  service.setInactiveCodexAccountsResolver(() => [
    { id: 'codex-inactive', resolveHome: () => ({ kind: 'ready', managedHomePath: '/x' }) }
  ])
  const window = new FakeRateLimitWindow()
  service.attach(asRateLimitWindow(window))
  return { service, credentialResolvers, cliCodexHome, window, meters }
}

function expectNothingElseRead(wired: ReturnType<typeof wiredService>): void {
  for (const source of OFF_SOURCES) {
    expect(vi.mocked(source)).not.toHaveBeenCalled()
  }
  for (const resolver of Object.values(wired.credentialResolvers)) {
    expect(resolver).not.toHaveBeenCalled()
  }
}

function expectOffProvidersEmpty(state: RateLimitState): void {
  for (const provider of OFF_PROVIDERS) {
    expect(state[provider]).toBeNull()
  }
  expect(state.usageMetersDisabled).toBe(true)
  expect(state.cliUsageReadings).toBe(true)
  expect(state.inactiveClaudeAccounts).toEqual([])
  expect(state.inactiveCodexAccounts).toEqual([])
}

const codexProbe = () => vi.mocked(fetchCodexUsageFromCli)
const agyProbe = () => vi.mocked(fetchAntigravityRateLimits)

describe('usage read through each CLI (user instruction 2026-10-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CLAUDE_CONFIG_DIR', '')
    codexProbe().mockImplementation(async () => cliReading('codex', 30))
    agyProbe().mockImplementation(async () => cliReading('antigravity', 20))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('reads usage only from the CLIs in NASH', () => {
    expect(USAGE_METER_SOURCE).toBe('cli-native')
  })

  it('reads nothing when the service is built and wired', () => {
    const wired = wiredService()
    expectOffProvidersEmpty(wired.service.getState())
    expect(wired.service.getState().claude).toBeNull()
    expect(codexProbe()).not.toHaveBeenCalled()
    expect(agyProbe()).not.toHaveBeenCalled()
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it('probes Codex and agy after the deferred start and on the 15-minute poll, never Claude', async () => {
    vi.useFakeTimers()
    const wired = wiredService()
    wired.service.start({ fetchImmediately: false })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(codexProbe()).toHaveBeenCalledTimes(1)
    expect(codexProbe().mock.calls[0]?.[0]).toMatchObject({ codexHomePath: CODEX_HOME })
    expect(agyProbe()).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15 * MINUTE)
    expect(codexProbe()).toHaveBeenCalledTimes(2)
    expect(agyProbe()).toHaveBeenCalledTimes(2)
    const state = wired.service.getState()
    expect(state.codex).toMatchObject({ status: 'ok', session: { usedPercent: 30 } })
    expect(state.antigravity).toMatchObject({ status: 'ok', session: { usedPercent: 20 } })
    expect(state.claude).toBeNull()
    expectOffProvidersEmpty(state)
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it('does not poll while the window is in the background', async () => {
    vi.useFakeTimers()
    const wired = wiredService()
    wired.window.focused = false
    wired.service.start({ fetchImmediately: false })
    await vi.advanceTimersByTimeAsync(2 * 15 * MINUTE)
    expect(codexProbe()).not.toHaveBeenCalled()
    expect(agyProbe()).not.toHaveBeenCalled()
    wired.service.stop()
  })

  it('probes again on focus only once the last reading is five minutes old', async () => {
    vi.useFakeTimers()
    const wired = wiredService()
    wired.window.emit('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(codexProbe()).toHaveBeenCalledTimes(1)
    wired.window.emit('show')
    wired.window.emit('restore')
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    wired.window.emit('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(codexProbe()).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(MINUTE)
    wired.window.emit('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(codexProbe()).toHaveBeenCalledTimes(2)
    expect(agyProbe()).toHaveBeenCalledTimes(2)
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it('leaves agy alone while its meter is hidden', async () => {
    const wired = wiredService({ agyShown: false })
    await wired.service.refresh()
    expect(codexProbe()).toHaveBeenCalledTimes(1)
    expect(agyProbe()).not.toHaveBeenCalled()
    wired.service.stop()
  })

  it('drops the last agy reading once its meter is hidden, so no route rests on it', async () => {
    const wired = wiredService()
    expect((await wired.service.refresh()).antigravity?.status).toBe('ok')
    wired.meters.agyShown = false
    const state = await wired.service.refresh()
    expect(agyProbe()).toHaveBeenCalledTimes(1)
    expect(state.antigravity).toMatchObject({ status: 'idle', session: null, weekly: null })
    wired.service.stop()
  })

  it('probes at once on a manual refresh and starts no Claude /usage PTY without a status-line reading', async () => {
    const wired = wiredService()
    await wired.service.refresh()
    const state = await wired.service.refresh()
    expect(codexProbe()).toHaveBeenCalledTimes(2)
    expect(agyProbe()).toHaveBeenCalledTimes(2)
    expect(state.claude).toBeNull()
    expect(await wired.service.refreshIfStale()).toMatchObject({ claude: null })
    expect(codexProbe()).toHaveBeenCalledTimes(2)
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it("shows the status-line rate limits of the user's own Claude login and drops other logins", () => {
    const wired = wiredService()
    wired.service.ingestLiveClaudeRateLimits({
      configDir: '/fixture/other-claude-config',
      fiveHour: { used_percentage: 90, resets_at: 1_900_000_000 },
      sevenDay: null
    })
    expect(wired.service.getState().claude).toBeNull()
    wired.service.ingestLiveClaudeRateLimits({
      configDir: null,
      fiveHour: { used_percentage: 40, resets_at: 1_900_000_000 },
      sevenDay: { used_percentage: 12 }
    })
    const claude = wired.service.getState().claude
    expect(claude).toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 40, resetsAt: 1_900_000_000_000 },
      weekly: { usedPercent: 12 },
      usageMetadata: { source: 'live-session' }
    })
    const pushed = wired.window.webContents.send.mock.calls.at(-1)?.[1] as RateLimitState
    expect(pushed.claude?.session?.usedPercent).toBe(40)
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it('keeps a fresh status-line reading through a manual refresh, still without a PTY', async () => {
    const wired = wiredService()
    wired.service.ingestLiveClaudeRateLimits({
      configDir: null,
      fiveHour: { used_percentage: 55 },
      sevenDay: null
    })
    const state = await wired.service.refresh()
    expect(state.claude?.session?.usedPercent).toBe(55)
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it('publishes a Codex reading without reset credits and refuses to spend one', async () => {
    codexProbe().mockImplementation(async () => cliReading('codex', 30))
    const wired = wiredService()
    const state = await wired.service.refresh()
    expect(state.codex?.rateLimitResetCredits).toBeUndefined()
    await expect(
      wired.service.consumeCodexRateLimitResetCredit({
        idempotencyKey: 'fixture-key',
        target: { runtime: 'host', wslDistro: null },
        codexHomePath: CODEX_HOME
      })
    ).rejects.toThrow('reset credits cannot be used')
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it('probes the newly selected Codex account and clears the Claude reading on a Claude target change', async () => {
    const wired = wiredService()
    const listener = vi.fn()
    wired.service.onAccountChange(listener)
    wired.service.ingestLiveClaudeRateLimits({
      configDir: null,
      fiveHour: { used_percentage: 61 },
      sevenDay: null
    })
    const afterCodex = await wired.service.refreshForCodexAccountChange('outgoing', WSL_TARGET)
    expect(codexProbe()).toHaveBeenCalledTimes(1)
    expect(afterCodex.codex?.status).toBe('ok')
    expect(listener.mock.calls).toEqual([['codex']])
    expect(await wired.service.refreshClaudeForTarget(WSL_TARGET)).toMatchObject({ claude: null })
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it('runs no inactive-account preview or Grok refresh', async () => {
    const wired = wiredService()
    await wired.service.fetchInactiveCodexAccountsOnOpen()
    expectOffProvidersEmpty(await wired.service.refreshGrok())
    await flushMicrotasks()
    expect(codexProbe()).not.toHaveBeenCalled()
    expect(agyProbe()).not.toHaveBeenCalled()
    expectNothingElseRead(wired)
    wired.service.stop()
  })

  it('shows a Codex home that cannot be resolved as a Codex error, without a probe', async () => {
    const wired = wiredService()
    wired.cliCodexHome.mockRejectedValueOnce(
      new Error('Codex runtime home service is not initialized')
    )
    const state = await wired.service.refresh()
    expect(codexProbe()).not.toHaveBeenCalled()
    expect(state.codex).toMatchObject({
      status: 'error',
      error: 'Codex runtime home service is not initialized'
    })
    expect(state.antigravity?.status).toBe('ok')
    wired.service.stop()
  })
})
