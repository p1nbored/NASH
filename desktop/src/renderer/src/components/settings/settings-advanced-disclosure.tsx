import { ChevronDown } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'

/** Orca's collapsed "Advanced" pattern: secondary details stay one click away, closed by default. */
export function SettingsAdvancedDisclosure({
  open,
  onOpenChange,
  label,
  children
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  label?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className="group">
          {label ?? translate('auto.components.settings.advancedDisclosure.label', 'Advanced')}
          <ChevronDown
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-group pt-row">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
