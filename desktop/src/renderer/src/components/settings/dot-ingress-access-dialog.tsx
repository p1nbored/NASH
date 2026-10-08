import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'

/**
 * The one confirmation before dot may ask for write access in a workspace (D-018 rail). The maximum
 * applies to local and remote dot alike (D-034): runs start in acceptEdits and dot may allow command
 * prompts (RG7).
 */
export function DotIngressAccessDialog({
  label,
  onCancel,
  onConfirm
}: {
  /** The workspace awaiting confirmation; null keeps the dialog closed. */
  label: string | null
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  // Why: the title keeps the last name while the dialog animates closed after `label` turns null.
  const [shownLabel, setShownLabel] = useState(label ?? '')
  if (label !== null && label !== shownLabel) {
    setShownLabel(label)
  }
  return (
    <Dialog open={label !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.dotIngress.access.title',
              'Allow workspace write for {{label}}?',
              { label: shownLabel }
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.dotIngress.access.descriptionBothPaths',
              'A task from dot that asks for write access, here or through your GPT Site, will start with file edits allowed in this workspace, without asking you. dot can also approve command prompts, such as Bash and PowerShell, for those tasks.'
            )}
          </DialogDescription>
        </DialogHeader>
        <p className="text-meta text-muted-foreground">
          {translate(
            'auto.components.settings.dotIngress.access.reversible',
            'Switching back to read only stops new write tasks; runs that already started keep their access.'
          )}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {translate('auto.components.settings.dotIngress.access.cancel', 'Cancel')}
          </Button>
          <Button onClick={onConfirm}>
            {translate(
              'auto.components.settings.dotIngress.access.confirm',
              'Allow workspace write'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
