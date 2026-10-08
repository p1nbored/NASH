import { useId, useState } from 'react'
import { Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { SkillInstallWorkspaceCombobox } from '../skills/SkillInstallWorkspaceCombobox'
import { DotIngressAccessDialog } from './dot-ingress-access-dialog'
import { DotIngressRefusalLine } from './dot-ingress-refusal-line'
import { DotIngressWorkspaceRow, type DotWorkspaceEntry } from './dot-ingress-workspace-row'
import type { DotWorkspaceCandidate } from './dot-workspace-candidates'
import { SettingsGroup } from './settings-group'
import type { SettingsStatusTone } from './settings-status-label'
import type { DotIngressModel } from './use-dot-ingress-settings'
import { useDotWorkspaceCandidates } from './use-dot-workspace-candidates'

export const DOT_WORKSPACES_SECTION_ID = 'integrations-dot-workspaces'

const NO_WORKSPACES: readonly DotWorkspaceEntry[] = []

function workspacesStatus(model: DotIngressModel): {
  label: string
  tone: SettingsStatusTone
} | null {
  if (model.loading) {
    return null
  }
  if (model.settings === null) {
    return {
      label: translate('auto.components.settings.dotIngress.unavailable', 'Unavailable'),
      tone: 'warning'
    }
  }
  const count = model.settings.workspaces.filter((entry) => entry.enabled).length
  return {
    label:
      count === 0
        ? translate('auto.components.settings.dotIngress.workspaces.noneEnabled', 'None enabled')
        : translate(
            'auto.components.settings.dotIngress.workspaces.enabledCount',
            '{{count}} enabled',
            { count }
          ),
    tone: 'neutral'
  }
}

function target(workspace: DotWorkspaceEntry | DotWorkspaceCandidate): {
  workspaceId: string
  label: string
} {
  return { workspaceId: workspace.workspaceId, label: workspace.label }
}

function AddWorkspace({
  model,
  candidates
}: {
  model: DotIngressModel
  candidates: DotWorkspaceCandidate[]
}): React.JSX.Element {
  const pickerId = useId()
  const [choice, setChoice] = useState('')
  const selected = candidates.find((entry) => entry.workspaceId === choice) ?? null
  const busy = model.busy !== null
  const add = async (): Promise<void> => {
    if (selected !== null && (await model.enableWorkspace(target(selected)))) {
      setChoice('')
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={pickerId} className="sr-only">
        {translate(
          'auto.components.settings.dotIngress.workspaces.pickerLabel',
          'Workspace to enable for dot'
        )}
      </label>
      <div className="min-w-0 max-w-md flex-1 basis-[16rem]">
        <SkillInstallWorkspaceCombobox
          id={pickerId}
          value={selected?.workspaceId ?? ''}
          onValueChange={setChoice}
          choices={candidates.map((entry) => ({
            id: entry.workspaceId,
            label: entry.label,
            kind: entry.kind
          }))}
          disabled={busy}
          triggerClassName="h-8"
          placeholder={
            candidates.length === 0
              ? translate(
                  'auto.components.settings.dotIngress.workspaces.noCandidates',
                  'No other local workspace to add'
                )
              : translate(
                  'auto.components.settings.dotIngress.workspaces.choose',
                  'Choose a workspace to add'
                )
          }
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={selected === null || busy}
        onClick={() => void add()}
      >
        <Plus aria-hidden="true" />
        {translate('auto.components.settings.dotIngress.workspaces.add', 'Enable for dot')}
      </Button>
    </div>
  )
}

function WorkspaceList({
  model,
  workspaces,
  onRaise
}: {
  model: DotIngressModel
  workspaces: readonly DotWorkspaceEntry[]
  onRaise: (workspace: DotWorkspaceEntry) => void
}): React.JSX.Element {
  if (workspaces.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        {translate(
          'auto.components.settings.dotIngress.workspaces.empty',
          'No workspace is enabled for dot, so dot cannot start any task.'
        )}
      </p>
    )
  }
  return (
    <ul
      aria-label={translate(
        'auto.components.settings.dotIngress.workspaces.name',
        'Workspaces for dot'
      )}
      className="divide-y divide-border/50"
    >
      {workspaces.map((workspace) => (
        <DotIngressWorkspaceRow
          key={workspace.workspaceRef}
          workspace={workspace}
          busy={model.busy !== null}
          // Why: a re-enable is always read only, so workspace write is set only through the dialog.
          onEnabledChange={(enabled) =>
            void (enabled
              ? model.enableWorkspace(target(workspace))
              : model.disableWorkspace(workspace.workspaceRef))
          }
          onAccessChange={(access) =>
            access === 'workspace_write'
              ? onRaise(workspace)
              : void model.enableWorkspace(target(workspace))
          }
        />
      ))}
    </ul>
  )
}

/** Rail 1 (D-018, D-034): dot may start tasks only in workspaces enabled here, up to each one's maximum. */
export function DotIngressWorkspacesCard({ model }: { model: DotIngressModel }): React.JSX.Element {
  const [pendingWrite, setPendingWrite] = useState<DotWorkspaceEntry | null>(null)
  const workspaces = model.settings?.workspaces ?? NO_WORKSPACES
  const candidates = useDotWorkspaceCandidates(workspaces)

  const confirmWrite = (): void => {
    if (pendingWrite !== null) {
      void model.allowWorkspaceWrite(target(pendingWrite))
    }
    setPendingWrite(null)
  }
  return (
    <SettingsGroup
      id={DOT_WORKSPACES_SECTION_ID}
      title={translate('auto.components.settings.dotIngress.workspaces.title', 'Workspaces')}
      description={translate(
        'auto.components.settings.dotIngress.workspaces.descriptionPlain',
        'dot sees each workspace by the name shown here, not by its folder.'
      )}
      status={workspacesStatus(model)}
    >
      {model.loading || model.settings === null ? null : (
        <div className="space-y-row">
          <WorkspaceList model={model} workspaces={workspaces} onRaise={setPendingWrite} />
          <AddWorkspace model={model} candidates={candidates} />
          <p className="text-caption text-muted-foreground">
            {translate(
              'auto.components.settings.dotIngress.workspaces.readOnlyNotePlain',
              'Workspaces start read only. Allowing write asks you to confirm.'
            )}
          </p>
          <DotIngressRefusalLine model={model} scope="workspaces" />
        </div>
      )}
      <DotIngressAccessDialog
        label={pendingWrite?.label ?? null}
        onCancel={() => setPendingWrite(null)}
        onConfirm={confirmWrite}
      />
    </SettingsGroup>
  )
}
