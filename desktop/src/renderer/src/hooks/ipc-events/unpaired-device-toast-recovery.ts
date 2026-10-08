import { translate } from '@/i18n/i18n'
import type { SettingsNavTarget } from '@/lib/settings-navigation-types'

export type UnpairedDeviceToastRecovery = {
  description: string
  actionLabel: string
  pane: SettingsNavTarget
}

/** Where the "device is not paired" toast sends the user; Mobile settings only while Orca Mobile is shown (D-038). */
export function getUnpairedDeviceToastRecovery(
  mobileUiEnabled: boolean
): UnpairedDeviceToastRecovery {
  if (mobileUiEnabled) {
    return {
      description: translate(
        'auto.hooks.useIpcEvents.11992d0337',
        'If this was your phone or another NASH client, re-pair it from Settings → Mobile.'
      ),
      actionLabel: translate('auto.hooks.useIpcEvents.6573cfe955', 'Open Mobile Settings'),
      pane: 'mobile'
    }
  }
  return {
    description: translate(
      'auto.hooks.useIpcEvents.unpairedDeviceServersDescription',
      'If this was another NASH client, share this server with it again from Settings → Remote NASH Servers.'
    ),
    actionLabel: translate('auto.hooks.useIpcEvents.openServerSettings', 'Open Server Settings'),
    pane: 'servers'
  }
}
