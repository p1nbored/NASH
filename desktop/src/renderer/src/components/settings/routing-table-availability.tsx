import { ListChecks, Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { RouteAvailabilityView } from '../../../../shared/workbench-route-availability-view'
import { Button } from '../ui/button'
import {
  routeAvailabilityLabel,
  type RouteAvailabilityTone
} from './routing-table-availability-messages'
import { SettingsStatusLabel, type SettingsStatusTone } from './settings-status-label'

const TONES: Record<RouteAvailabilityTone, SettingsStatusTone> = {
  available: 'success',
  unavailable: 'warning',
  unverified: 'neutral'
}

/** A route's status as a small icon and label; its reasons are shown by the row beneath its choice. */
export function RouteAvailabilityStatus(props: {
  availability: RouteAvailabilityView
}): React.JSX.Element {
  const { label, tone } = routeAvailabilityLabel(props.availability)
  return <SettingsStatusLabel tone={TONES[tone]} label={label} />
}

/** The user's "Check availability": asks each CLI again, so it runs only when clicked. */
export function RouteCheckButton(props: {
  checking: boolean
  disabled: boolean
  onCheck: () => void
}): React.JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={props.disabled || props.checking}
      onClick={props.onCheck}
    >
      {props.checking ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <ListChecks aria-hidden="true" />
      )}
      {props.checking
        ? translate('auto.components.settings.routingTable.availability.checkingPlain', 'Checking…')
        : translate(
            'auto.components.settings.routingTable.availability.checkPlain',
            'Check availability'
          )}
    </Button>
  )
}
