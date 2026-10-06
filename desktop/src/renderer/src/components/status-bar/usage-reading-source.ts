import { translate } from '@/i18n/i18n'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'

/**
 * The CLI feed a reading came from, for the three providers NASH reads through their own CLI; null
 * for any other reading, which names no source.
 */
export function getUsageReadingSourceLabel(p: ProviderRateLimits): string | null {
  const source = p.usageMetadata?.source
  if (p.provider === 'claude' && source === 'live-session') {
    return translate(
      'auto.components.status.bar.usageReadingSource.claudeStatusLine',
      'Claude Code status line'
    )
  }
  if (p.provider === 'codex' && source === 'cli') {
    return translate(
      'auto.components.status.bar.usageReadingSource.codexAppServer',
      'codex app-server'
    )
  }
  if (p.provider === 'antigravity' && source === 'cli') {
    return translate('auto.components.status.bar.usageReadingSource.agyUsage', 'agy /usage')
  }
  return null
}
