import { DotIngressInterfaceCard } from './dot-ingress-interface-card'
import { DotIngressLimitsCard } from './dot-ingress-limits-card'
import { DotIngressWorkspacesCard } from './dot-ingress-workspaces-card'
import { DotRemoteAccessCard } from './dot-remote-access-card'
import { SettingsSectionStack } from './SettingsSectionStack'
import { useDotIngressSettings } from './use-dot-ingress-settings'

export const DOT_SETTINGS_SECTION_ID = 'integrations-dot'

/**
 * The dot settings (D-018, D-034) as plain groups: tasks from dot start without a desktop
 * confirmation, so the switch, the enabled workspaces and the limits are what bound them.
 */
export function DotIngressSection(): React.JSX.Element {
  const model = useDotIngressSettings()
  return (
    <div data-settings-section={DOT_SETTINGS_SECTION_ID} className="space-y-section">
      <SettingsSectionStack
        spacing="group"
        sections={[
          <DotIngressInterfaceCard key="interface" model={model} />,
          <DotIngressWorkspacesCard key="workspaces" model={model} />,
          <DotIngressLimitsCard key="limits" model={model} />,
          <DotRemoteAccessCard key="remote" />
        ]}
      />
    </div>
  )
}
