import { FileJson, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { RoutingTableProposal } from '../../../../shared/routing-table/routing-table-proposal-schema'
import type { WorkbenchRoutingTableListResult } from '../../../../shared/workbench-routing-table-view'
import { Button } from '../ui/button'
import { routingTableDetails } from './routing-table-details'
import { tableSourceLabel } from './routing-table-labels'
import { RoutingTableProposals } from './routing-table-proposals'
import { formatRoutingTime } from './routing-table-time'
import { RoutingTableVersions } from './routing-table-versions'
import { SettingsAdvancedDisclosure } from './settings-advanced-disclosure'
import { CopyDetailsButton } from './settings-copy-details-button'
import { SettingsStatusLabel } from './settings-status-label'
import { SettingsRow } from './SettingsFormControls'
import type { RoutingTableModel } from './use-routing-table'

function VersionLine({ list }: { list: WorkbenchRoutingTableListResult }): React.JSX.Element {
  const { active } = list
  if (!active.ok) {
    return <span />
  }
  return (
    <p className="text-meta text-muted-foreground">
      <span className="text-foreground">
        {translate(
          'auto.components.settings.routingTable.active.versionActive',
          'Version {{version}} active',
          { version: active.version }
        )}
      </span>
      {` · ${tableSourceLabel(active.source)} · `}
      {translate('auto.components.settings.routingTable.active.created', 'created {{time}}', {
        time: formatRoutingTime(active.table.created_at)
      })}
    </p>
  )
}

/**
 * Everything beyond the per-task choices: the version in use, suggested changes to review, the
 * history to roll back to and JSON import. Closed by default (D-035).
 */
export function RoutingTableAdvanced(props: {
  model: RoutingTableModel
  list: WorkbenchRoutingTableListResult
  open: boolean
  onOpenChange: (open: boolean) => void
  onEditProposal: (proposal: RoutingTableProposal) => void
  onImport: () => void
  onRevert: (version: number) => void
}): React.JSX.Element {
  const { model, list } = props
  const active = list.active.ok ? list.active : null
  const unreadable = list.unreadableProposalIds.length
  return (
    <SettingsAdvancedDisclosure open={props.open} onOpenChange={props.onOpenChange}>
      <div className="flex flex-wrap items-center justify-between gap-row">
        <VersionLine list={list} />
        <div className="flex items-center gap-1">
          <CopyDetailsButton details={() => routingTableDetails(list)} />
          <Button
            variant="ghost"
            size="xs"
            disabled={model.loading || model.busy}
            onClick={() => void model.refresh()}
          >
            <RefreshCw aria-hidden="true" />
            {translate('auto.components.settings.routingTable.card.refresh', 'Refresh')}
          </Button>
        </div>
      </div>
      <RoutingTableProposals
        list={list}
        active={active?.table ?? null}
        actions={{
          busy: model.busy,
          onAccept: (proposalId) => void model.accept(proposalId),
          onReject: (proposalId) => void model.reject(proposalId),
          onEdit: props.onEditProposal
        }}
      />
      {unreadable > 0 ? (
        <SettingsStatusLabel
          tone="warning"
          label={translate(
            'auto.components.settings.routingTable.advanced.unreadable',
            'Suggested changes that could not be read: {{count}}',
            { count: unreadable }
          )}
        />
      ) : null}
      {list.versions.length > 0 ? (
        <RoutingTableVersions
          versions={list.versions}
          activeVersion={list.activeVersion}
          busy={model.busy}
          onRevert={props.onRevert}
        />
      ) : null}
      <SettingsRow
        label={translate(
          'auto.components.settings.routingTable.advanced.importLabel',
          'Import a change set'
        )}
        description={translate(
          'auto.components.settings.routingTable.advanced.importDescription',
          'Paste routing as JSON. It waits under Suggested changes until you accept it.'
        )}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={active === null || model.busy}
            onClick={props.onImport}
          >
            <FileJson aria-hidden="true" />
            {translate('auto.components.settings.routingTable.advanced.import', 'Import…')}
          </Button>
        }
      />
    </SettingsAdvancedDisclosure>
  )
}
