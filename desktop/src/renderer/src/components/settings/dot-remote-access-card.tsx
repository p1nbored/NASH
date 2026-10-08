import { RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkbenchDotRemoteStatusView } from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { Button } from '../ui/button'
import { DotRemoteConnectionForm } from './dot-remote-connection-form'
import { DotRemotePairingPanel } from './dot-remote-pairing-panel'
import { DotRemoteRefusalLine } from './dot-remote-refusal-line'
import {
  dotRemotePill,
  dotRemoteReconnectMessage,
  dotRemoteStateDetail,
  dotRemoteSyncFailingLabel,
  dotRemoteSyncFailureDetails,
  dotRemoteSyncFailureMessage
} from './dot-remote-status-messages'
import { formatRoutingTime } from './routing-table-time'
import { RoutingWarningCallout } from './routing-warning-callout'
import { CopyDetailsButton } from './settings-copy-details-button'
import { SettingsGroup } from './settings-group'
import { SettingsSwitchRow } from './SettingsFormControls'
import { useDotRemoteAccess, type DotRemoteModel } from './use-dot-remote-access'

export const DOT_REMOTE_SECTION_ID = 'integrations-dot-remote'

type Status = WorkbenchDotRemoteStatusView

function syncLine(status: Status): string {
  return status.lastSyncAt === null
    ? translate(
        'auto.components.settings.dotRemote.status.neverSynced',
        'No sync with the Site yet.'
      )
    : translate('auto.components.settings.dotRemote.status.lastSync', 'Last sync: {{time}}', {
        time: formatRoutingTime(status.lastSyncAt)
      })
}

/** The state the app reported with its last answer: never a claim that dot itself is linked. */
function RemoteStatus({ status }: { status: Status }): React.JSX.Element {
  const { syncFailure } = status
  return (
    <div className="space-y-1">
      {status.reconnectReason === null ? null : (
        <RoutingWarningCallout label={dotRemotePill(status).label} role="alert">
          <p>{dotRemoteReconnectMessage(status.reconnectReason)}</p>
        </RoutingWarningCallout>
      )}
      {status.reconnectReason === null && syncFailure ? (
        <RoutingWarningCallout label={dotRemoteSyncFailingLabel()} role="alert">
          <p>{dotRemoteSyncFailureMessage(syncFailure)}</p>
          <CopyDetailsButton details={() => dotRemoteSyncFailureDetails(syncFailure)} />
        </RoutingWarningCallout>
      ) : null}
      <p role="status" aria-live="polite" className="text-meta text-muted-foreground">
        {dotRemoteStateDetail(status)}
      </p>
      {status.enabled ? (
        <p className="text-meta text-muted-foreground">{syncLine(status)}</p>
      ) : null}
      {status.enabled && status.localEndpoint === 'unavailable' ? (
        <p className="text-meta text-muted-foreground">
          {translate(
            'auto.components.settings.dotRemote.status.localNotReady',
            'Tasks from dot are off or not ready on this computer, so tasks from the Site wait until they are.'
          )}
        </p>
      ) : null}
      {status.pendingEvents > 0 ? (
        <p className="text-meta text-muted-foreground">
          {translate(
            'auto.components.settings.dotRemote.status.pendingEvents',
            'Updates waiting to be sent: {{pending}}',
            { pending: status.pendingEvents }
          )}
        </p>
      ) : null}
    </div>
  )
}

function RemoteControls({
  model,
  status
}: {
  model: DotRemoteModel
  status: Status
}): React.JSX.Element {
  return (
    <>
      <SettingsSwitchRow
        label={translate('auto.components.settings.dotRemote.switch.label', 'Allow remote access')}
        description={translate(
          'auto.components.settings.dotRemote.switch.description',
          'Off stops checking the Site and sending updates. Runs that already started keep running.'
        )}
        checked={status.enabled}
        disabled={model.busy !== null}
        onChange={() => void model.setEnabled(!status.enabled)}
      />
      <RemoteStatus status={status} />
      <DotRemoteRefusalLine model={model} scope="switch" />
      <DotRemoteConnectionForm model={model} status={status} />
      <DotRemotePairingPanel model={model} status={status} />
    </>
  )
}

/**
 * Remote access through GPT Sites (D-021, R1): dot leaves tasks in a mailbox on the user's Site and
 * this computer collects them over HTTPS. Off by default, separate from the local switch; remote
 * tasks are held to each workspace's maximum access (D-034).
 */
export function DotRemoteAccessCard(): React.JSX.Element {
  const model = useDotRemoteAccess()
  const { status } = model
  return (
    <SettingsGroup
      id={DOT_REMOTE_SECTION_ID}
      title={translate('auto.components.settings.dotRemote.title', 'Remote access')}
      description={translate(
        'auto.components.settings.dotRemote.descriptionWorkspaceMax',
        'dot reaches this app through a mailbox on your GPT Site. This computer checks the mailbox over HTTPS and opens no inbound port. Tasks from the Site get at most the access you allow for each workspace.'
      )}
      status={model.loading ? null : dotRemotePill(status)}
      actions={
        <Button
          variant="ghost"
          size="xs"
          disabled={model.loading || model.busy !== null}
          onClick={() => void model.refresh()}
        >
          <RefreshCw aria-hidden="true" />
          {translate('auto.components.settings.dotRemote.refresh', 'Refresh')}
        </Button>
      }
    >
      {model.loading ? null : (
        <div className="space-y-group">
          {status === null ? null : <RemoteControls model={model} status={status} />}
          {model.loadError === null ? null : (
            <p role="alert" className="text-meta text-destructive">
              {model.loadError}
            </p>
          )}
        </div>
      )}
    </SettingsGroup>
  )
}
