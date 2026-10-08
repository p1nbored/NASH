import { RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkbenchDotIngressSettingsResult } from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { Button } from '../ui/button'
import { dotIngressFailureMessage } from './dot-ingress-messages'
import { DotIngressRefusalLine } from './dot-ingress-refusal-line'
import { RoutingWarningCallout } from './routing-warning-callout'
import { CopyDetailsButton } from './settings-copy-details-button'
import { SettingsGroup } from './settings-group'
import type { SettingsStatusTone } from './settings-status-label'
import { SettingsSwitchRow } from './SettingsFormControls'
import type { DotIngressModel } from './use-dot-ingress-settings'

export const DOT_INTERFACE_SECTION_ID = 'integrations-dot-interface'

type Settings = WorkbenchDotIngressSettingsResult

function notReady(): string {
  return translate('auto.components.settings.dotIngress.interface.notReady', 'Not ready')
}

function interfaceStatus(
  model: DotIngressModel
): { tone: SettingsStatusTone; label: string } | null {
  const { settings } = model
  if (model.loading) {
    return null
  }
  if (settings === null) {
    return {
      tone: 'warning',
      label: translate('auto.components.settings.dotIngress.unavailable', 'Unavailable')
    }
  }
  if (settings.listening) {
    return {
      tone: 'success',
      label: translate('auto.components.settings.dotIngress.interface.ready', 'Ready')
    }
  }
  return settings.enabled
    ? { tone: 'warning', label: notReady() }
    : {
        tone: 'neutral',
        label: translate('auto.components.settings.dotIngress.interface.off', 'Off')
      }
}

/** What the app reported with the last answer; never a claim that dot itself is linked. */
function statusText(settings: Settings): string {
  if (settings.listening) {
    return translate(
      'auto.components.settings.dotIngress.interface.readyDetail',
      'Ready on this computer. NASH cannot tell whether dot is connected.'
    )
  }
  return settings.enabled
    ? translate(
        'auto.components.settings.dotIngress.interface.notReadyDetail',
        'On, but not ready in this session. Turn it off and on, or restart the app.'
      )
    : ''
}

function InterfaceStatus({ settings }: { settings: Settings }): React.JSX.Element {
  const { failure } = settings
  if (failure !== null) {
    return (
      <RoutingWarningCallout label={notReady()} role="alert">
        <p>{dotIngressFailureMessage(failure)}</p>
        <CopyDetailsButton details={`failure: ${failure}`} />
      </RoutingWarningCallout>
    )
  }
  return (
    <p role="status" aria-live="polite" className="text-meta text-muted-foreground empty:hidden">
      {statusText(settings)}
    </p>
  )
}

/**
 * The switch for tasks from dot on this computer (D-018): such a task starts without asking, so
 * the enabled workspaces and the limits below are what bound it.
 */
export function DotIngressInterfaceCard({ model }: { model: DotIngressModel }): React.JSX.Element {
  const { settings } = model
  return (
    <SettingsGroup
      id={DOT_INTERFACE_SECTION_ID}
      title={translate('auto.components.settings.dotIngress.section.title', 'Tasks from dot')}
      description={translate(
        'auto.components.settings.dotIngress.section.descriptionPlain',
        'A task from dot starts without asking you. It can use only the workspaces enabled below, within your limits.'
      )}
      status={interfaceStatus(model)}
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
      {model.loading || settings === null ? null : (
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
        <p role="alert" className="text-meta text-destructive">
          {model.loadError}
        </p>
      )}
    </SettingsGroup>
  )
}
