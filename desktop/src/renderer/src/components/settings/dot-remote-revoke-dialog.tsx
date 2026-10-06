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

export function dotRemoteRevokeLabel(): string {
  return translate('auto.components.settings.dotRemote.revoke.action', 'Revoke pairing')
}

/** The one confirmation before revoking (RG8): future remote work stops; started runs keep going. */
export function DotRemoteRevokeDialog({
  open,
  onOpenChange,
  onConfirm,
  contentRef,
  onCloseAutoFocus
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  contentRef?: React.Ref<HTMLDivElement>
  onCloseAutoFocus?: (event: Event) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} showCloseButton={false} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.dotRemote.revoke.title',
              "Revoke this computer's pairing?"
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.dotRemote.revoke.description',
              'Revoking stops future remote work: the app stops checking the Site and takes no new tasks from it until you pair again. It does not cancel runs that already started.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.settings.dotRemote.revoke.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {dotRemoteRevokeLabel()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
