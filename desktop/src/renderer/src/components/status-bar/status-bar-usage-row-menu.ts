import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'

export type UsageRowMenuKind = 'codex-switcher' | 'details'

/**
 * Which drill-in a usage row opens. Claude has no account switcher (user decision 2026-10-06:
 * Claude account switching is removed), so its row opens the details panel; Codex keeps its
 * switcher on every usage source.
 */
export function usageRowMenuKind(provider: ProviderRateLimits['provider']): UsageRowMenuKind {
  return provider === 'codex' ? 'codex-switcher' : 'details'
}
