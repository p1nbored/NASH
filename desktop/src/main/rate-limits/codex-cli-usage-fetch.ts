import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import {
  resolveCodexHomeProcessLockKey,
  withCodexHomeProcessLock
} from '../codex-cli/codex-home-process-lock'
import { readCodexRateLimitsFromAppServer } from './codex-fetcher'
import type { CodexRateLimitFetchOptions } from './codex-rate-limit-fetch-options'
import { abortedCodexRateLimitResult } from './codex-rate-limit-fetch-result'

/**
 * Codex usage as NASH reads it: `codex app-server` answers `account/rateLimits/read` in the given
 * home (Codex's own default when none). Unlike Orca's fetcher there is no auth.json presence check,
 * no chatgpt.com usage or reset-credit call and no HTTP fallback; Codex reads its own login.
 * Reset credits are dropped because NASH never spends one.
 */
export async function fetchCodexUsageFromCli(
  options: CodexRateLimitFetchOptions = {}
): Promise<ProviderRateLimits> {
  if (options.signal?.aborted) {
    return abortedCodexRateLimitResult()
  }
  let reading: ProviderRateLimits
  try {
    reading = await withCodexHomeProcessLock(
      resolveCodexHomeProcessLockKey(options.codexHomePath),
      () => readCodexRateLimitsFromAppServer(options)
    )
  } catch (error) {
    reading = {
      provider: 'codex',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: error instanceof Error ? error.message : 'codex app-server could not be started',
      status: 'error'
    }
  }
  const { rateLimitResetCredits: _resetCredits, ...withoutResetCredits } = reading
  return {
    ...withoutResetCredits,
    usageMetadata: {
      ...reading.usageMetadata,
      source: 'cli',
      attemptedSources: ['cli'],
      ...(reading.status === 'ok' ? { lastSuccessfulSource: 'cli' } : {})
    }
  }
}
