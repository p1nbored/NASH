import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { normalizeUsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import { ProviderIcon, ProviderPanel, getProviderDisplayName } from '../status-bar/tooltip'
import { SettingsSubsectionHeader } from './SettingsFormControls'

type CliProvider = 'claude' | 'codex' | 'antigravity'

function noReadingHint(provider: CliProvider): string {
  if (provider === 'claude') {
    return translate(
      'auto.components.settings.cliUsageReadings.claudeHintPlain',
      'Appears while a Claude session started in NASH runs.'
    )
  }
  if (provider === 'codex') {
    return translate(
      'auto.components.settings.cliUsageReadings.codexHintPlain',
      'Use Refresh usage to read it.'
    )
  }
  return translate(
    'auto.components.settings.cliUsageReadings.agyHintPlain',
    'Use Refresh usage while the agy meter is on in the status bar.'
  )
}

function NoReading({ provider }: { provider: CliProvider }): React.JSX.Element {
  return (
    <div className="space-y-1 text-meta">
      <div className="flex items-center gap-1.5 font-medium">
        <ProviderIcon provider={provider} />
        {getProviderDisplayName(provider)}
      </div>
      <div className="text-muted-foreground">
        {translate('auto.components.settings.cliUsageReadings.noReading', 'No reading yet')}
      </div>
      <div className="text-muted-foreground">{noReadingHint(provider)}</div>
    </div>
  )
}

/**
 * Settings > Accounts on CLI readings (NASH): the Claude, Codex and agy readings with the CLI feed
 * and time of each. A refresh asks Codex and agy; Claude has nothing to ask (its status line reports).
 */
export function CliUsageReadingsSection(): React.JSX.Element {
  const claude = useAppStore((s) => s.rateLimits.claude)
  const codex = useAppStore((s) => s.rateLimits.codex)
  const antigravity = useAppStore((s) => s.rateLimits.antigravity)
  const refreshRateLimits = useAppStore((s) => s.refreshRateLimits)
  const display = normalizeUsagePercentageDisplay(useAppStore((s) => s.usagePercentageDisplay))
  const [refreshing, setRefreshing] = useState(false)
  const readings: [CliProvider, ProviderRateLimits | null][] = [
    ['claude', claude],
    ['codex', codex],
    ['antigravity', antigravity]
  ]

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refreshRateLimits()
    } catch (error) {
      console.error('Failed to refresh CLI usage readings:', error)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section
      id="accounts-cli-usage"
      data-testid="cli-usage-readings"
      className="space-y-group scroll-mt-6"
    >
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.cliUsageReadings.title', 'Usage from the CLIs')}
        description={translate(
          'auto.components.settings.cliUsageReadings.bodyPlain',
          'Each reading comes from the CLI itself, never from a sign-in.'
        )}
        action={
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {translate('auto.components.settings.cliUsageReadings.refresh', 'Refresh usage')}
          </Button>
        }
      />
      <div className="grid gap-group sm:grid-cols-3">
        {readings.map(([provider, limits]) => (
          <div key={provider} className="min-w-0">
            {limits ? (
              <ProviderPanel p={limits} usagePercentageDisplay={display} showResetCredits={false} />
            ) : (
              <NoReading provider={provider} />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
