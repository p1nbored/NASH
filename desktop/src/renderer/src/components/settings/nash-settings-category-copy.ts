import { translate } from '@/i18n/i18n'

// Titles and descriptions shared by the Settings sidebar metadata and the NASH category renderers.
// Kept free of pane UI imports so the navigation metadata can read them.

export function getTaskRoutingSettingsTitle(): string {
  return translate('auto.hooks.useSettingsNavigationMetadata.taskRoutingTitle', 'Task routing')
}

export function getTaskRoutingSettingsDescription(): string {
  return translate(
    'auto.hooks.useSettingsNavigationMetadata.taskRoutingDescription',
    'Choose which agent, model and effort handle each kind of task.'
  )
}

export function getDotSettingsTitle(): string {
  return translate('auto.hooks.useSettingsNavigationMetadata.dotTitle', 'Dot')
}

export function getDotSettingsDescription(): string {
  return translate(
    'auto.hooks.useSettingsNavigationMetadata.dotDescription',
    'Let ChatGPT dot send tasks to NASH.'
  )
}
