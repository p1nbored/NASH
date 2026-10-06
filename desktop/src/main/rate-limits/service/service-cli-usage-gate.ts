import { createEmptyRateLimitState } from '../../../shared/rate-limit-state-factory'
import { RateLimitServiceCliUsageCycles } from './service-cli-usage-cycles'
import {
  normalizeClaudeConfigDir,
  type ClaudeStatusLineRateLimits,
  type CodexRateLimitResetResult,
  type RateLimitRuntimeTarget,
  type RateLimitState
} from './service-types'

/**
 * The service's public surface with USAGE_METER_SOURCE 'cli-native': only the Claude, Codex and agy
 * readings are published, Claude's comes from the user's own login through the status line, and
 * nothing that needs a stored credential runs (inactive-account previews, reset credits).
 */
export abstract class RateLimitServiceCliUsageGate extends RateLimitServiceCliUsageCycles {
  override getState(): RateLimitState {
    if (!this.readsCliUsageOnly()) {
      return super.getState()
    }
    // Why built here: the base reads stored-key presence for providers that stay off.
    return createEmptyRateLimitState({
      claude: this.state.claude,
      codex: this.state.codex,
      antigravity: this.state.antigravity,
      claudeTarget: this.claudeFetchTarget,
      codexTarget: this.codexFetchTarget,
      usageMetersDisabled: true,
      cliUsageReadings: true
    })
  }

  override ingestLiveClaudeRateLimits(event: ClaudeStatusLineRateLimits): void {
    if (this.readsCliUsageOnly()) {
      // Why: Claude account switching is gone (user decision 2026-10-06), so the session's config
      // dir must be the user's own login, the one NASH's Claude launches inherit.
      this.lastClaudeAuthSnapshot = {
        configDir: normalizeClaudeConfigDir(process.env.CLAUDE_CONFIG_DIR),
        provenance: 'system'
      }
    }
    super.ingestLiveClaudeRateLimits(event)
  }

  override async fetchInactiveCodexAccountsOnOpen(): Promise<void> {
    if (!this.readsCliUsageOnly()) {
      await super.fetchInactiveCodexAccountsOnOpen()
    }
  }

  override async consumeCodexRateLimitResetCredit(options: {
    idempotencyKey: string
    target: RateLimitRuntimeTarget
    codexHomePath: string | null
  }): Promise<CodexRateLimitResetResult> {
    if (this.readsCliUsageOnly()) {
      throw new Error(
        'NASH reads Codex usage only through codex app-server, so reset credits cannot be used here.'
      )
    }
    return super.consumeCodexRateLimitResetCredit(options)
  }
}
