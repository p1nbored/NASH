import { fetchAntigravityRateLimits } from '../antigravity-usage-fetcher'
import { antigravityUsageDisabledSnapshot } from '../antigravity-usage-snapshot'
import { fetchCodexUsageFromCli } from '../codex-cli-usage-fetch'
import { USAGE_METER_SOURCE } from '../usage-meters-policy'
import { RateLimitServiceConfiguration } from './service-configuration'
import { toErrorMessage, type ActiveProviderState, type ProviderRateLimits } from './service-types'

/** The Codex home NASH's own Codex launches use, resolved read-only; null means Codex's default. */
export type CliCodexHomeResolver = () => Promise<string | null>

function failedCliReading(provider: 'codex' | 'antigravity', error: unknown): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: toErrorMessage(error),
    status: 'error',
    usageMetadata: { source: 'cli', attemptedSources: ['cli'] }
  }
}

/**
 * The fetch cycles with USAGE_METER_SOURCE 'cli-native': Orca's queue, debounce, backoff and
 * triggers stay, but a cycle asks only `codex app-server` and `agy -p /usage`. Claude has no
 * cycle: its reading arrives passively from the status line.
 */
export abstract class RateLimitServiceCliUsageCycles extends RateLimitServiceConfiguration {
  protected cliCodexHomeResolver: CliCodexHomeResolver | null = null

  setCliCodexHomeResolver(resolver: CliCodexHomeResolver): void {
    this.cliCodexHomeResolver = resolver
  }

  protected readsCliUsageOnly(): boolean {
    return USAGE_METER_SOURCE === 'cli-native'
  }

  protected isAntigravityUsageShown(): boolean {
    return this.antigravityUsageEnabledResolver?.() ?? true
  }

  // Why only these: Claude's status-line feed has nothing to refresh and every other provider is off,
  // so a null slot there must not turn each window focus into a full cycle.
  protected override getActiveProviderState(): ActiveProviderState[] {
    if (!this.readsCliUsageOnly()) {
      return super.getActiveProviderState()
    }
    const codex: ActiveProviderState = { provider: 'codex', limits: this.state.codex }
    return this.isAntigravityUsageShown()
      ? [codex, { provider: 'antigravity', limits: this.state.antigravity }]
      : [codex]
  }

  protected override async runFetchAllCycle(
    signal: AbortSignal,
    options?: { force?: boolean }
  ): Promise<void> {
    if (!this.readsCliUsageOnly()) {
      await super.runFetchAllCycle(signal, options)
      return
    }
    await Promise.all([this.runFetchCodexOnlyCycle(signal), this.runCliAntigravityCycle(signal)])
  }

  protected override async runFetchCodexOnlyCycle(signal: AbortSignal): Promise<void> {
    if (!this.readsCliUsageOnly()) {
      await super.runFetchCodexOnlyCycle(signal)
      return
    }
    if (signal.aborted) {
      return
    }
    const generation = this.codexFetchGeneration
    const previous = this.state.codex
    this.updateState({ ...this.state, codex: this.withFetchingStatus(previous, 'codex') })
    const fresh = await this.readCodexFromCli(signal)
    // Why: an account switch during the probe queues its own read; this one is the old account's.
    if (signal.aborted || generation !== this.codexFetchGeneration) {
      return
    }
    this.trackActiveFailureStreak('codex', fresh)
    this.updateState({ ...this.state, codex: this.applyStalePolicy(fresh, previous) })
  }

  protected override async runFetchClaudeOnlyCycle(
    signal: AbortSignal,
    options?: { force?: boolean }
  ): Promise<void> {
    if (!this.readsCliUsageOnly()) {
      await super.runFetchClaudeOnlyCycle(signal, options)
      return
    }
    // Why no read: the hidden `/usage` PTY stays off (usage-meters-policy.ts); a switch or retarget
    // only drops the old reading until the status line reports again.
    if (this.state.claude?.status === 'fetching') {
      this.updateState({ ...this.state, claude: null })
    }
  }

  protected override async runFetchGrokOnlyCycle(signal: AbortSignal): Promise<void> {
    if (!this.readsCliUsageOnly()) {
      await super.runFetchGrokOnlyCycle(signal)
    }
  }

  private async readCodexFromCli(signal: AbortSignal): Promise<ProviderRateLimits> {
    let codexHomePath: string | null
    try {
      codexHomePath = (await this.cliCodexHomeResolver?.()) ?? null
    } catch (error) {
      return failedCliReading('codex', error)
    }
    try {
      return await fetchCodexUsageFromCli({ codexHomePath, signal })
    } catch (error) {
      return failedCliReading('codex', error)
    }
  }

  private async runCliAntigravityCycle(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return
    }
    const previous = this.state.antigravity
    // Why: a hidden agy meter spawns nothing, as in Orca, and its last reading is dropped so no
    // route check rests on a reading nobody refreshes; a null slot would read as loading.
    if (!this.isAntigravityUsageShown()) {
      if (previous?.status !== 'idle') {
        this.updateState({ ...this.state, antigravity: antigravityUsageDisabledSnapshot() })
      }
      return
    }
    this.updateState({
      ...this.state,
      antigravity: this.withFetchingStatus(previous, 'antigravity')
    })
    let fresh: ProviderRateLimits
    try {
      fresh = await fetchAntigravityRateLimits({ signal })
    } catch (error) {
      fresh = failedCliReading('antigravity', error)
    }
    if (signal.aborted) {
      return
    }
    this.trackActiveFailureStreak('antigravity', fresh)
    this.updateState({ ...this.state, antigravity: this.applyStalePolicy(fresh, previous) })
  }
}
