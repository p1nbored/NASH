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

export function clefClearCredentialsLabel(): string {
  return translate('auto.components.settings.clef.clear.action', 'Clear credentials')
}

/** In-page confirmation for removing both stored values (never window.confirm). */
export function ClefClearCredentialsDialog({
  open,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.clef.clear.title', 'Clear Clef credentials?')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.clef.clear.descriptionPlain',
              'This removes the saved API token and account ID from this computer. Clef cannot sort tasks until you save new ones.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate('auto.components.settings.clef.clear.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {clefClearCredentialsLabel()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
