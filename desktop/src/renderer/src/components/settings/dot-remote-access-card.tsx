import { Globe, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkbenchDotRemoteStatusView } from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { Button } from '../ui/button'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { DotRemoteConnectionForm } from './dot-remote-connection-form'
import { DotRemotePairingPanel } from './dot-remote-pairing-panel'
import { DotRemoteRefusalLine } from './dot-remote-refusal-line'
import {
  dotRemotePill,
  dotRemoteReconnectMessage,
  dotRemoteStateDetail,
  dotRemoteSyncFailingLabel,
  dotRemoteSyncFailureMessage
} from './dot-remote-status-messages'
import { formatRoutingTime } from './routing-table-time'
import { RoutingWarningCallout } from './routing-warning-callout'
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
  return (
    <div className="space-y-1.5">
      {status.reconnectReason === null ? null : (
        <RoutingWarningCallout label={dotRemotePill(status).label} role="alert">
          <p>{dotRemoteReconnectMessage(status.reconnectReason)}</p>
        </RoutingWarningCallout>
      )}
      {status.reconnectReason === null && status.syncFailure ? (
        <RoutingWarningCallout label={dotRemoteSyncFailingLabel()} role="alert">
          <p>{dotRemoteSyncFailureMessage(status.syncFailure)}</p>
        </RoutingWarningCallout>
      ) : null}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {dotRemoteStateDetail(status)}
      </p>
      {status.enabled ? <p className="text-xs text-muted-foreground">{syncLine(status)}</p> : null}
      {status.enabled && status.localEndpoint === 'unavailable' ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.dotRemote.status.endpointClosed',
            'The local dot interface is not listening, so tasks from the Site wait there until it is.'
          )}
        </p>
      ) : null}
      {status.pendingEvents > 0 ? (
        <p className="text-xs text-muted-foreground">
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
 * this computer collects them over HTTPS. Off by default, separate from the local dot switch.
 */
export function DotRemoteAccessCard(): React.JSX.Element {
  const model = useDotRemoteAccess()
  const { status } = model
  const pill = dotRemotePill(status)
  return (
    <IntegrationCardShell
      icon={<Globe className="size-5" />}
      name={translate('auto.components.settings.dotRemote.name', 'Remote access (GPT Sites)')}
      description={translate(
        'auto.components.settings.dotRemote.description',
        'dot reaches this app through a mailbox on your GPT Site. This computer checks the mailbox over HTTPS and opens no inbound port. Tasks from the Site run read only.'
      )}
      checking={model.loading}
      statusLabel={pill.label}
      statusTone={pill.tone}
      settingsSectionId={DOT_REMOTE_SECTION_ID}
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
        <IntegrationCardDetails className="space-y-3">
          {status === null ? null : <RemoteControls model={model} status={status} />}
          {model.loadError === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {model.loadError}
            </p>
          )}
        </IntegrationCardDetails>
      )}
    </IntegrationCardShell>
  )
}
