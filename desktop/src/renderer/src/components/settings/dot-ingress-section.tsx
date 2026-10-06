import { translate } from '@/i18n/i18n'
import { DotIngressInterfaceCard } from './dot-ingress-interface-card'
import { DotIngressLimitsCard } from './dot-ingress-limits-card'
import { DotIngressWorkspacesCard } from './dot-ingress-workspaces-card'
import { DotRemoteAccessCard } from './dot-remote-access-card'
import { useDotIngressSettings } from './use-dot-ingress-settings'

export const DOT_SETTINGS_SECTION_ID = 'integrations-dot'

/**
 * The dot settings (D-018): tasks from dot start without a desktop confirmation, so the switch, the
 * enabled workspaces and the submission caps are what limits them before they start.
 */
export function DotIngressSection(): React.JSX.Element {
  const model = useDotIngressSettings()
  return (
    <section className="space-y-3" data-settings-section={DOT_SETTINGS_SECTION_ID}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          {translate('auto.components.settings.dotIngress.section.title', 'Tasks from dot')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.dotIngress.section.description',
            'A task sent from dot starts without asking you first. It is limited by the interface switch, the enabled workspaces and the submission limits below.'
          )}
        </p>
      </div>
      <div className="space-y-3">
        <DotIngressInterfaceCard model={model} />
        <DotIngressWorkspacesCard model={model} />
        <DotIngressLimitsCard model={model} />
        <DotRemoteAccessCard />
      </div>
    </section>
  )
}
