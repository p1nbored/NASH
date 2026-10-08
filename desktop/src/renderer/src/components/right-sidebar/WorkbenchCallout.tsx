import { useId, type ReactNode } from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import WorkbenchCopyDetails from './WorkbenchCopyDetails'
import type { WorkbenchDetail } from './workbench-details'

/**
 * An inline notice: a coloured icon, an ink label and an optional sentence, without a box. The
 * status hues are under 4.5:1 for text, so they mark only the icon. A failure gets the error
 * token; a blocked or refused action the warning token.
 */
export default function WorkbenchCallout({
  label,
  tone = 'warning',
  role = 'group',
  details,
  children
}: {
  label: string
  tone?: 'warning' | 'error'
  role?: 'group' | 'alert'
  details?: { subject: string; entries: readonly WorkbenchDetail[] }
  children?: ReactNode
}): React.JSX.Element {
  const labelId = useId()
  return (
    <div
      role={role}
      aria-labelledby={labelId}
      data-tone={tone}
      className="flex items-start gap-1.5 text-meta text-foreground"
    >
      {tone === 'error' ? (
        <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-status-error" />
      ) : (
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-status-warning"
        />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p id={labelId} className="font-medium">
          {label}
        </p>
        {children}
      </div>
      {details && <WorkbenchCopyDetails subject={details.subject} entries={details.entries} />}
    </div>
  )
}
