import { ListChecks, Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { RouteAvailabilityView } from '../../../../shared/workbench-route-availability-view'
import { Button } from '../ui/button'
import {
  routeAvailabilityLabel,
  type RouteAvailabilityTone
} from './routing-table-availability-messages'

const TONE_CLASSES: Record<RouteAvailabilityTone, string> = {
  available: 'border-status-success-border bg-status-success-background text-status-success',
  unavailable: 'border-status-warning-border bg-status-warning-background text-status-warning',
  unverified: 'border-border bg-background text-muted-foreground'
}

/** A route's status as a small label, with its reasons in plain English beside or beneath it. */
export function RouteAvailabilityStatus(props: {
  availability: RouteAvailabilityView
  layout?: 'stacked' | 'inline'
}): React.JSX.Element {
  const { label, detail, tone } = routeAvailabilityLabel(props.availability)
  return (
    <span
      className={cn(
        'inline-flex items-start gap-1',
        props.layout === 'inline' ? 'flex-wrap items-baseline' : 'flex-col'
      )}
    >
      <span
        className={cn(
          'rounded-full border px-1.5 py-px text-[10px] font-medium whitespace-nowrap',
          TONE_CLASSES[tone]
        )}
      >
        {label}
      </span>
      {detail ? <span className="text-[11px] text-muted-foreground">{detail}</span> : null}
    </span>
  )
}

/** The user's "Check now": reads each CLI again, so it runs only when clicked. */
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
        ? translate(
            'auto.components.settings.routingTable.availability.checking',
            'Checking routes…'
          )
        : translate('auto.components.settings.routingTable.availability.check', 'Check routes')}
    </Button>
  )
}
