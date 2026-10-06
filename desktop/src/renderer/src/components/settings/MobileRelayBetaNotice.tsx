import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { ORCA_CLOUD_SERVICES_ENABLED } from '../../../../shared/orca-cloud-services'

// Why: Relay ships in the public builds but is still beta; keep a quiet
// qualifier wherever the Relay path is offered. NASH builds have neither Relay
// nor the push gateway (Orca cloud services off), so the pairing UI says so.
export function MobileRelayBetaNotice({ className }: { className?: string }): React.JSX.Element {
  return (
    <p className={cn('text-[11px] text-muted-foreground', className)}>
      {ORCA_CLOUD_SERVICES_ENABLED
        ? translate(
            'auto.components.settings.MobileRelayBetaNotice.notice',
            'Orca Relay is in beta.'
          )
        : translate(
            'auto.components.settings.MobileRelayBetaNotice.nashUnavailable',
            'Orca Relay and mobile push notifications are not available in NASH builds.'
          )}
    </p>
  )
}
