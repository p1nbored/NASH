import type { GlobalSettings } from '../../shared/global-settings-types'
import type { ClaudeAccountSelectionTarget } from '../claude-accounts/runtime-selection'
import { getInitialAccountRateLimitTarget } from './initial-account-rate-limit-target'

// Why empty: Claude account switching is gone, so only the account runtime policy picks the target.
const NO_CLAUDE_ACCOUNT_SELECTION = {
  getWslSelectionKey: (wslDistro: string | null | undefined): string =>
    wslDistro?.trim() || '__default__',
  normalizeRuntimeSelection: () => ({ host: null, wsl: {} })
}

export function getInitialClaudeRateLimitTarget(
  settings: GlobalSettings,
  platform: NodeJS.Platform = process.platform
): ClaudeAccountSelectionTarget {
  return getInitialAccountRateLimitTarget(settings, NO_CLAUDE_ACCOUNT_SELECTION, platform)
}
