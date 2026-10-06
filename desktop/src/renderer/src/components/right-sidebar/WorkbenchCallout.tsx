import { useId, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

// Why: the warning hue is under 4.5:1 on its own tint, so copy stays ink and the hue marks only icon and border.
export default function WorkbenchCallout({
  label,
  role = 'group',
  children
}: {
  label: string
  role?: 'group' | 'alert'
  children: ReactNode
}): React.JSX.Element {
  const labelId = useId()
  return (
    <div
      role={role}
      aria-labelledby={labelId}
      className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-background px-2.5 py-2 text-xs text-foreground"
    >
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-status-warning" />
      <div className="min-w-0 flex-1 space-y-1">
        <p id={labelId} className="font-medium">
          {label}
        </p>
        {children}
      </div>
    </div>
  )
}
