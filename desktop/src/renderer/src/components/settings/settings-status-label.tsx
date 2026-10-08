import { CircleCheck, CircleDashed, CircleX, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SettingsStatusTone = 'success' | 'warning' | 'error' | 'neutral' | 'busy'

const ICONS = {
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
  neutral: CircleDashed,
  busy: Loader2
} as const

// Why the hue marks only the icon: status hues are under 4.5:1 on some surfaces, so text stays ink.
const ICON_CLASSES: Record<SettingsStatusTone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-muted-foreground',
  busy: 'animate-spin text-muted-foreground'
}

/** A status as a small icon and a short label, never colour alone and never a pill. */
export function SettingsStatusLabel({
  tone,
  label,
  className
}: {
  tone: SettingsStatusTone
  label: string
  className?: string
}): React.JSX.Element {
  const Icon = ICONS[tone]
  return (
    <span
      data-status-tone={tone}
      className={cn(
        'inline-flex items-start gap-1.5 text-meta',
        tone === 'neutral' ? 'text-muted-foreground' : 'text-foreground',
        className
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-px size-3.5 shrink-0', ICON_CLASSES[tone])} />
      <span>{label}</span>
    </span>
  )
}
