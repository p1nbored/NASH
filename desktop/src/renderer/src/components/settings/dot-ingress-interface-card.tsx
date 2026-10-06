import { Cable, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkbenchDotIngressSettingsResult } from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { Button } from '../ui/button'
import {
  IntegrationCardDetails,
  IntegrationCardShell,
  type IntegrationCardStatusTone
} from './integration-card-shell'
import { dotIngressFailureMessage } from './dot-ingress-messages'
import { DotIngressRefusalLine } from './dot-ingress-refusal-line'
import { RoutingWarningCallout } from './routing-warning-callout'
import { SettingsSwitchRow } from './SettingsFormControls'
import type { DotIngressModel } from './use-dot-ingress-settings'

export const DOT_INTERFACE_SECTION_ID = 'integrations-dot-interface'

type Settings = WorkbenchDotIngressSettingsResult

function notListening(): string {
  return translate('auto.components.settings.dotIngress.interface.notListening', 'Not listening')
}

function interfacePill(settings: Settings | null): {
  label: string
  tone: IntegrationCardStatusTone
} {
  if (settings === null) {
    return {
      label: translate('auto.components.settings.dotIngress.unavailable', 'Unavailable'),
      tone: 'attention'
    }
  }
  if (settings.listening) {
    return {
      label: translate('auto.components.settings.dotIngress.interface.listening', 'Listening'),
      tone: 'connected'
    }
  }
  return { label: notListening(), tone: settings.enabled ? 'attention' : 'neutral' }
}

function statusText(settings: Settings): string {
  if (settings.listening) {
    return translate(
      'auto.components.settings.dotIngress.interface.listeningDetail',
      'Listening. The endpoint is open; the app cannot tell whether dot is connected.'
    )
  }
  return settings.enabled
    ? translate(
        'auto.components.settings.dotIngress.interface.notOpenDetail',
        'Not listening. The switch is on, but the endpoint is not open in this session.'
      )
    : translate(
        'auto.components.settings.dotIngress.interface.offDetail',
        'Not listening. The switch is off.'
      )
}

/** The real endpoint state the app reported with the last answer; never a claim that dot is linked. */
function InterfaceStatus({ settings }: { settings: Settings }): React.JSX.Element {
  if (settings.failure !== null) {
    return (
      <RoutingWarningCallout label={notListening()} role="alert">
        <p>{dotIngressFailureMessage(settings.failure)}</p>
      </RoutingWarningCallout>
    )
  }
  return (
    <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
      {statusText(settings)}
    </p>
  )
}

export function DotIngressInterfaceCard({ model }: { model: DotIngressModel }): React.JSX.Element {
  const { settings } = model
  const pill = interfacePill(settings)
  return (
    <IntegrationCardShell
      icon={<Cable className="size-5" />}
      name={translate('auto.components.settings.dotIngress.interface.name', 'Local dot interface')}
      description={translate(
        'auto.components.settings.dotIngress.interface.description',
        'Lets dot on this computer send tasks to the app through a local endpoint.'
      )}
      checking={model.loading}
      statusLabel={pill.label}
      statusTone={pill.tone}
      settingsSectionId={DOT_INTERFACE_SECTION_ID}
      actions={
        <Button
          variant="ghost"
          size="xs"
          disabled={model.loading || model.busy !== null}
          onClick={() => void model.refresh()}
        >
          <RefreshCw aria-hidden="true" />
          {translate('auto.components.settings.dotIngress.interface.refresh', 'Refresh')}
        </Button>
      }
    >
      {model.loading ? null : (
        <IntegrationCardDetails className="space-y-2">
          {settings === null ? null : (
            <>
              <SettingsSwitchRow
                label={translate(
                  'auto.components.settings.dotIngress.interface.switch',
                  'Accept tasks from dot'
                )}
                description={translate(
                  'auto.components.settings.dotIngress.interface.switchDescription',
                  'Turning it off stops new tasks from dot. Runs that already started keep running.'
                )}
                checked={settings.enabled}
                disabled={model.busy !== null}
                onChange={() => void model.setEnabled(!settings.enabled)}
              />
              <InterfaceStatus settings={settings} />
              <DotIngressRefusalLine model={model} scope="interface" />
            </>
          )}
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
