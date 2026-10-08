import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { SettingsRow, SettingsSwitch } from './SettingsFormControls'

type PluginOrcaCatalogSettingProps = {
  enabled: boolean
  onChange: (enabled: boolean) => Promise<void>
}

/** D-039: opt-in switch for Orca's official plugin marketplace and plugin safety list. */
export function PluginOrcaCatalogSetting({
  enabled,
  onChange
}: PluginOrcaCatalogSettingProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const toggle = async (): Promise<void> => {
    setBusy(true)
    setSaveFailed(false)
    try {
      await onChange(!enabled)
    } catch (cause) {
      console.warn('[plugins] plugin catalog setting failed:', cause)
      setSaveFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsRow
        label={translate(
          'auto.components.settings.PluginsSettingsSection.orcaCatalogLabel',
          "Use Orca's plugin catalog"
        )}
        labelId="orca-plugin-catalog-label"
        description={translate(
          'auto.components.settings.PluginsSettingsSection.orcaCatalogDescription',
          "Downloads Orca's official plugin list and plugin safety list from Orca's servers."
        )}
        alignTop
        control={
          <SettingsSwitch
            checked={enabled}
            disabled={busy}
            ariaLabelledBy="orca-plugin-catalog-label"
            onChange={() => void toggle()}
          />
        }
      />
      {saveFailed ? (
        <p className="text-meta text-destructive">
          {translate(
            'auto.components.settings.PluginsSettingsSection.settingsUpdateFailed',
            'Could not save plugin settings.'
          )}
        </p>
      ) : null}
    </>
  )
}
