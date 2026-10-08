import { useId } from 'react'
import { translate } from '@/i18n/i18n'
import type { DotRequestAccess } from '../../../../shared/dot-ingress/dot-ingress-limits'
import type { WorkbenchDotIngressSettingsResult } from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { Switch } from '../ui/switch'
import { dotWorkspacePath } from './dot-workspace-candidates'
import { compactPath } from './settings-compact-path'
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
    <li
      aria-labelledby={labelId}
      className="flex flex-wrap items-center gap-x-group gap-y-row py-row"
    >
      <div className="min-w-0 flex-1 basis-[14rem] space-y-0.5">
        <p id={labelId} className="truncate text-body text-foreground">
          {workspace.label}
        </p>
        {path === null ? null : (
          <p className="truncate font-mono text-caption text-muted-foreground" title={path}>
            {compactPath(path)}
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
        <span className="text-meta text-muted-foreground">
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
