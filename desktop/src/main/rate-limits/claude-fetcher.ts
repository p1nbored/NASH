import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { fetchActiveClaudeRateLimits } from './claude-active-usage-fetch'
import type { ClaudeRateLimitFetchOptions } from './claude-usage-fetch-options'

export type FetchClaudeRateLimitsOptions = ClaudeRateLimitFetchOptions

export async function fetchClaudeRateLimits(
  options?: FetchClaudeRateLimitsOptions
): Promise<ProviderRateLimits> {
  return fetchActiveClaudeRateLimits(options)
}
