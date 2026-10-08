import { Undo2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkbenchRoutingTableListResult } from '../../../../shared/workbench-routing-table-view'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { tableSourceLabel } from './routing-table-labels'
import { formatRoutingTime } from './routing-table-time'

type VersionEntry = WorkbenchRoutingTableListResult['versions'][number]

/** Every accepted version, newest first; any earlier one can come back as a new version. */
export function RoutingTableVersions(props: {
  versions: readonly VersionEntry[]
  activeVersion: number | null
  busy: boolean
  onRevert: (version: number) => void
}): React.JSX.Element {
  const newestFirst = [...props.versions].sort((a, b) => b.version - a.version)
  return (
    <div className="space-y-1">
      <p className="text-meta font-medium text-foreground">
        {translate('auto.components.settings.routingTable.versions.title', 'Version history')}
      </p>
      <ul className="space-y-0.5 text-meta">
        {newestFirst.map((entry) => (
          <li key={entry.version} className="flex min-h-7 flex-wrap items-center gap-x-2">
            <span className="text-foreground">
              {translate(
                'auto.components.settings.routingTable.versions.version',
                'Version {{version}}',
                { version: entry.version }
              )}
            </span>
            <span className="text-muted-foreground">
              {tableSourceLabel(entry.source)} · {formatRoutingTime(entry.acceptedAt)}
            </span>
            {entry.version === props.activeVersion ? (
              <span className="text-muted-foreground">
                {translate('auto.components.settings.routingTable.versions.active', '(active)')}
              </span>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                disabled={props.busy}
                aria-label={translate(
                  'auto.components.settings.routingTable.versions.revertTo',
                  'Revert to version {{version}}',
                  {
                    version: entry.version
                  }
                )}
                onClick={() => props.onRevert(entry.version)}
              >
                <Undo2 aria-hidden="true" />
                {translate('auto.components.settings.routingTable.versions.revert', 'Revert')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** In-page confirmation: reverting changes routing for every later task, so it is never one click. */
export function RoutingTableRevertDialog(props: {
  version: number | null
  activeVersion: number | null
  onCancel: () => void
  onConfirm: (version: number) => void
}): React.JSX.Element {
  const { version } = props
  return (
    <Dialog open={version !== null} onOpenChange={(open) => (open ? undefined : props.onCancel())}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.routingTable.versions.confirmTitle',
              'Revert to version {{version}}?',
              {
                version: version ?? ''
              }
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.routingTable.versions.confirmBody',
              'The content of version {{version}} becomes a new active version. Version {{active}} stays in the history, so you can return to it.',
              { version: version ?? '', active: props.activeVersion ?? '?' }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={props.onCancel}>
            {translate('auto.components.settings.routingTable.versions.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => (version === null ? undefined : props.onConfirm(version))}>
            {translate('auto.components.settings.routingTable.versions.revert', 'Revert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
