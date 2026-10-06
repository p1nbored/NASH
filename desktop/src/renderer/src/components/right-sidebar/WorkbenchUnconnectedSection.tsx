import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import WorkbenchSectionHeader from './WorkbenchSectionHeader'

export default function WorkbenchUnconnectedSection({
  id,
  title,
  children
}: {
  id: string
  title: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <WorkbenchSectionHeader id={id} title={title}>
        <Badge variant="outline">
          {translate('workbench.status.notConnected', 'Not connected')}
        </Badge>
      </WorkbenchSectionHeader>
      <div className="space-y-2 text-xs text-muted-foreground">{children}</div>
    </section>
  )
}
