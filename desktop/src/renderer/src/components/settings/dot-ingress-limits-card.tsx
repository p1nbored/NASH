import { translate } from '@/i18n/i18n'
import {
  DOT_INGRESS_DEFAULT_RATE_PER_MINUTE,
  DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY,
  DOT_INGRESS_RATE_PER_MINUTE_MAX,
  DOT_INGRESS_RATE_PER_UTC_DAY_MAX
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import type { DotRateLimits } from '../../../../shared/dot-ingress/dot-ingress-settings'
import { DotIngressRefusalLine } from './dot-ingress-refusal-line'
import { SettingsGroup } from './settings-group'
import { NumberField } from './SettingsFormControls'
import type { DotIngressModel } from './use-dot-ingress-settings'

export const DOT_LIMITS_SECTION_ID = 'integrations-dot-limits'

function LimitFields({
  model,
  limits
}: {
  model: DotIngressModel
  limits: DotRateLimits
}): React.JSX.Element {
  const save = (next: DotRateLimits): void => {
    if (
      next.ratePerMinute !== limits.ratePerMinute ||
      next.ratePerUtcDay !== limits.ratePerUtcDay
    ) {
      void model.setRateLimits(next)
    }
  }
  return (
    // Why a fieldset: one save at a time, so a second field never sends the other's stale value.
    <fieldset disabled={model.busy !== null} className="min-w-0 space-y-row">
      <legend className="sr-only">
        {translate('auto.components.settings.dotIngress.limits.name', 'Submission limits')}
      </legend>
      <NumberField
        label={translate(
          'auto.components.settings.dotIngress.limits.perMinute',
          'Tasks per minute'
        )}
        description={translate(
          'auto.components.settings.dotIngress.limits.perMinuteDescription',
          'Counted over any 60 seconds. From 1 to {{max}}.',
          { max: DOT_INGRESS_RATE_PER_MINUTE_MAX }
        )}
        value={limits.ratePerMinute}
        defaultValue={DOT_INGRESS_DEFAULT_RATE_PER_MINUTE}
        min={1}
        max={DOT_INGRESS_RATE_PER_MINUTE_MAX}
        integer
        onChange={(ratePerMinute) => save({ ...limits, ratePerMinute })}
      />
      <NumberField
        label={translate('auto.components.settings.dotIngress.limits.perDay', 'Tasks per UTC day')}
        description={translate(
          'auto.components.settings.dotIngress.limits.perDayDescription',
          'Counted per calendar day in UTC. From 1 to {{max}}.',
          { max: DOT_INGRESS_RATE_PER_UTC_DAY_MAX }
        )}
        value={limits.ratePerUtcDay}
        defaultValue={DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY}
        min={1}
        max={DOT_INGRESS_RATE_PER_UTC_DAY_MAX}
        integer
        onChange={(ratePerUtcDay) => save({ ...limits, ratePerUtcDay })}
      />
    </fieldset>
  )
}

/** Rail 2 (D-018): how many tasks dot may submit; the store refuses any above them. */
export function DotIngressLimitsCard({ model }: { model: DotIngressModel }): React.JSX.Element {
  const limits = model.settings?.rateLimits ?? null
  return (
    <SettingsGroup
      id={DOT_LIMITS_SECTION_ID}
      title={translate('auto.components.settings.dotIngress.limits.title', 'Limits')}
      description={translate(
        'auto.components.settings.dotIngress.limits.descriptionPlain',
        'A task over a limit is refused and nothing starts. Every task sent counts, even one that fails.'
      )}
      status={
        !model.loading && limits === null
          ? {
              tone: 'warning',
              label: translate('auto.components.settings.dotIngress.unavailable', 'Unavailable')
            }
          : null
      }
    >
      {model.loading || limits === null ? null : (
        <>
          {/* Why the key: a refused change remounts the fields so they show the stored caps again. */}
          <LimitFields key={model.refusedChanges} model={model} limits={limits} />
          <DotIngressRefusalLine model={model} scope="limits" />
        </>
      )}
    </SettingsGroup>
  )
}
