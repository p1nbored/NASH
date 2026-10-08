import { useId } from 'react'
import { SettingsStatusLabel, type SettingsStatusTone } from './settings-status-label'
import { SettingsSubsectionHeader } from './SettingsFormControls'

/**
 * A titled group of settings rows without a card around it: Orca's subsection header, an optional
 * status (icon and label) and actions at its right, then the rows.
 */
export function SettingsGroup({
  id,
  title,
  description,
  status,
  actions,
  children
}: {
  /** The `data-settings-section` anchor that search and deep links scroll to. */
  id?: string
  title: string
  description?: React.ReactNode
  status?: { tone: SettingsStatusTone; label: string } | null
  actions?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  const headingId = useId()
  const hasAction = (status !== null && status !== undefined) || actions !== undefined
  return (
    <section aria-labelledby={headingId} data-settings-section={id} className="space-y-row">
      <SettingsSubsectionHeader
        title={<span id={headingId}>{title}</span>}
        description={description}
        action={
          hasAction ? (
            <div className="flex items-center gap-row">
              {status ? <SettingsStatusLabel tone={status.tone} label={status.label} /> : null}
              {actions}
            </div>
          ) : undefined
        }
      />
      {children}
    </section>
  )
}
