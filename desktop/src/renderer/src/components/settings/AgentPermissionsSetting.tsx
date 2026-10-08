import { Info } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { AgentPermissionMode } from '../../../../shared/tui-agent-permissions'
import { SettingsSegmentedControl, SettingsSubsectionHeader } from './SettingsFormControls'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function AgentPermissionsSetting({
  mode,
  onChange
}: {
  mode: AgentPermissionMode
  onChange: (mode: Exclude<AgentPermissionMode, 'mixed'>) => void
}): React.JSX.Element {
  const visibleMode = mode === 'mixed' ? 'yolo' : mode
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={
          <span className="flex items-center gap-2">
            {translate('auto.components.settings.AgentsPane.agentPermissions', 'Agent Permissions')}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={translate(
                    'auto.components.settings.AgentsPane.agentPermissionsInfo',
                    'Agent permissions info'
                  )}
                  className="grid size-5 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {translate(
                  'auto.components.settings.AgentsPane.agentPermissionsTooltip',
                  'Custom launch arguments keep their own permission behavior. Auto review requires supported hooks in a NASH-managed run; other launches use native manual prompts. Managed runs always keep their access limits.'
                )}
              </TooltipContent>
            </Tooltip>
          </span>
        }
        description={translate(
          'auto.components.settings.AgentsPane.agentPermissionsDescription',
          'Auto lets coordinators review worker requests and Dot review coordinator requests. Critical actions still need you. Yolo skips native prompts where supported; Manual keeps native prompts.'
        )}
        action={
          <SettingsSegmentedControl<AgentPermissionMode>
            value={visibleMode}
            onChange={(nextMode) => {
              if (nextMode !== 'mixed') {
                onChange(nextMode)
              }
            }}
            ariaLabel={translate(
              'auto.components.settings.AgentsPane.agentPermissions',
              'Agent Permissions'
            )}
            size="sm"
            options={[
              {
                value: 'yolo',
                label: translate('auto.components.settings.AgentsPane.agentPermissionsYolo', 'Yolo')
              },
              {
                value: 'auto',
                label: translate('auto.components.settings.AgentsPane.agentPermissionsAuto', 'Auto')
              },
              {
                value: 'manual',
                label: translate(
                  'auto.components.settings.AgentsPane.agentPermissionsManual',
                  'Manual'
                )
              }
            ]}
          />
        }
      />
    </section>
  )
}
