import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { normalizeUsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import { ProviderIcon, ProviderPanel, getProviderDisplayName } from '../status-bar/tooltip'

type CliProvider = 'claude' | 'codex' | 'antigravity'

function noReadingHint(provider: CliProvider): string {
  if (provider === 'claude') {
    return translate(
      'auto.components.settings.cliUsageReadings.claudeHint',
      'Claude Code reports usage through its status line while a Claude session started in NASH runs.'
    )
  }
  if (provider === 'codex') {
    return translate(
      'auto.components.settings.cliUsageReadings.codexHint',
      'Refresh usage asks codex app-server.'
    )
  }
  return translate(
    'auto.components.settings.cliUsageReadings.agyHint',
    'Refresh usage runs agy /usage while the agy meter is on in the status bar.'
  )
}

function NoReading({ provider }: { provider: CliProvider }): React.JSX.Element {
  return (
    <div className="space-y-1 text-xs">
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
      className="space-y-4 scroll-mt-6"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {translate('auto.components.settings.cliUsageReadings.title', 'Usage from the CLIs')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.cliUsageReadings.body',
            "NASH reads usage only from each CLI: Claude Code's status line, codex app-server and agy /usage. It reads no sign-in and asks no vendor for usage."
          )}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {readings.map(([provider, limits]) => (
          <div key={provider} className="rounded-md border border-border p-3">
            {limits ? (
              <ProviderPanel p={limits} usagePercentageDisplay={display} showResetCredits={false} />
            ) : (
              <NoReading provider={provider} />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
          {translate('auto.components.settings.cliUsageReadings.refresh', 'Refresh usage')}
        </Button>
        {refreshing ? (
          <Loader2
            className="size-4 animate-spin"
            aria-label={translate(
              'auto.components.settings.cliUsageReadings.refreshing',
              'Refreshing usage'
            )}
          />
        ) : null}
      </div>
    </section>
  )
}
