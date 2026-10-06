import { useId } from 'react'
import { translate } from '@/i18n/i18n'
import type { DotRequestAccess } from '../../../../shared/dot-ingress/dot-ingress-limits'
import type { WorkbenchDotIngressSettingsResult } from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { Switch } from '../ui/switch'
import { dotWorkspacePath } from './dot-workspace-candidates'
import { SettingsSegmentedControl } from './SettingsFormControls'

export type DotWorkspaceEntry = WorkbenchDotIngressSettingsResult['workspaces'][number]

function accessOptions(
  busy: boolean
): { value: DotRequestAccess; label: string; disabled: boolean }[] {
  return [
    {
      value: 'read_only',
      label: translate('auto.components.settings.dotIngress.workspaces.readOnly', 'Read only'),
      disabled: busy
    },
    {
      value: 'workspace_write',
      label: translate(
        'auto.components.settings.dotIngress.workspaces.workspaceWrite',
        'Workspace write'
      ),
      disabled: busy
    }
  ]
}

/** One workspace in the dot list: its name, its access ceiling while enabled, and its switch. */
export function DotIngressWorkspaceRow({
  workspace,
  busy,
  onAccessChange,
  onEnabledChange
}: {
  workspace: DotWorkspaceEntry
  busy: boolean
  onAccessChange: (access: DotRequestAccess) => void
  onEnabledChange: (enabled: boolean) => void
}): React.JSX.Element {
  const labelId = useId()
  const path = dotWorkspacePath(workspace.workspaceId)
  return (
    <li aria-labelledby={labelId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1 basis-[14rem] space-y-0.5">
        <p id={labelId} className="truncate text-sm text-foreground">
          {workspace.label}
        </p>
        {path === null ? null : (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={path}>
            {path}
          </p>
        )}
      </div>
      {workspace.enabled ? (
        <SettingsSegmentedControl
          size="sm"
          value={workspace.maxAccess}
          options={accessOptions(busy)}
          ariaLabel={translate(
            'auto.components.settings.dotIngress.workspaces.accessLabel',
            'Maximum access for {{label}}',
            { label: workspace.label }
          )}
          onChange={(access) => {
            if (access !== workspace.maxAccess) {
              onAccessChange(access)
            }
          }}
        />
      ) : (
        <span className="text-xs text-muted-foreground">
          {translate('auto.components.settings.dotIngress.workspaces.off', 'Off')}
        </span>
      )}
      <Switch
        checked={workspace.enabled}
        disabled={busy}
        aria-label={translate(
          'auto.components.settings.dotIngress.workspaces.enableLabel',
          'Enable {{label}} for dot',
          { label: workspace.label }
        )}
        onCheckedChange={onEnabledChange}
      />
    </li>
  )
}
