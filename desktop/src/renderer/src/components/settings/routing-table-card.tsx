import { useState } from 'react'
import { FileJson, PencilLine, RefreshCw, Waypoints } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkbenchRoutingTableListResult } from '../../../../shared/workbench-routing-table-view'
import { Button } from '../ui/button'
import {
  IntegrationCardDetails,
  IntegrationCardShell,
  type IntegrationCardStatusTone
} from './integration-card-shell'
import { RoutingTableActiveView } from './routing-table-active-view'
import { RouteCheckButton } from './routing-table-availability'
import { RoutingTableImportDialog } from './routing-table-import-dialog'
import { routingTableRefusalMessage } from './routing-table-messages'
import { RoutingTableProposals } from './routing-table-proposals'
import { RoutingTableRouteEditor, type RouteEditorMode } from './routing-table-route-editor'
import { RoutingTableRevertDialog, RoutingTableVersions } from './routing-table-versions'
import { RoutingWarningCallout } from './routing-warning-callout'
import { useRoutingTable, type RoutingTableModel } from './use-routing-table'

export const ROUTING_TABLE_SECTION_ID = 'integrations-routing-table'

function cardStatus(model: RoutingTableModel): { label: string; tone: IntegrationCardStatusTone } {
  const { list } = model
  if (list === null) {
    return {
      label: translate('auto.components.settings.routingTable.card.unavailable', 'Unavailable'),
      tone: 'attention'
    }
  }
  if (!list.active.ok) {
    return {
      label: translate('auto.components.settings.routingTable.card.blocked', 'Blocked'),
      tone: 'attention'
    }
  }
  const pending = list.proposals.filter((entry) => entry.decision === null).length
  return pending > 0
    ? {
        label: translate(
          'auto.components.settings.routingTable.card.toReview',
          '{{count}} to review',
          { count: pending }
        ),
        tone: 'attention'
      }
    : {
        label: translate(
          'auto.components.settings.routingTable.card.active',
          'Version {{version}} active',
          {
            version: list.active.version
          }
        ),
        tone: 'neutral'
      }
}

function TableBody(props: {
  model: RoutingTableModel
  list: WorkbenchRoutingTableListResult
  onEditRoutes: () => void
  onImport: () => void
  onEditProposal: (mode: RouteEditorMode) => void
  onRevert: (version: number) => void
}): React.JSX.Element {
  const { model, list } = props
  const active = list.active.ok ? list.active : null
  const unreadable = list.unreadableProposalIds.length
  return (
    <>
      {list.active.ok ? null : (
        <RoutingWarningCallout
          label={translate(
            'auto.components.settings.routingTable.card.blockedTitle',
            'Routing is blocked'
          )}
        >
          <p>{routingTableRefusalMessage(list.active)}</p>
        </RoutingWarningCallout>
      )}
      {active ? <RoutingTableActiveView active={active} availability={model.availability} /> : null}
      {active !== null && model.availability !== null ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.availability.hint',
            'Availability shows readings from the last 10 minutes. Check routes asks each CLI again.'
          )}{' '}
          {translate(
            'auto.components.settings.routingTable.availability.cliUsageHint',
            "NASH reads usage only from the CLIs: Claude Code's status line, codex app-server and agy /usage. A route is blocked when a fresh reading shows a used-up limit, or after its CLI reports a sign-in or usage-limit failure."
          )}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={active === null || model.busy}
          onClick={props.onEditRoutes}
        >
          <PencilLine aria-hidden="true" />
          {translate('auto.components.settings.routingTable.card.editRoutes', 'Edit routes')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={active === null || model.busy}
          onClick={props.onImport}
        >
          <FileJson aria-hidden="true" />
          {translate('auto.components.settings.routingTable.card.import', 'Import')}
        </Button>
        {active !== null && model.availability !== null ? (
          <RouteCheckButton
            checking={model.checking}
            disabled={model.loading || model.busy}
            onCheck={() => void model.checkRoutes()}
          />
        ) : null}
      </div>
      {unreadable > 0 ? (
        <p className="text-xs text-status-warning">
          {translate(
            'auto.components.settings.routingTable.card.unreadable',
            'Unreadable proposal files: {{count}}. They are not shown and cannot be decided here.',
            { count: unreadable }
          )}
        </p>
      ) : null}
      <RoutingTableProposals
        list={list}
        active={active?.table ?? null}
        actions={{
          busy: model.busy,
          onAccept: (proposalId) => void model.accept(proposalId),
          onReject: (proposalId) => void model.reject(proposalId),
          onEdit: (proposal) => props.onEditProposal({ kind: 'modify', proposal })
        }}
      />
      {list.versions.length > 0 ? (
        <RoutingTableVersions
          versions={list.versions}
          activeVersion={list.activeVersion}
          busy={model.busy}
          onRevert={props.onRevert}
        />
      ) : null}
    </>
  )
}

/** The user-owned, versioned Routing Table (D-016): read it, review proposals, change or revert it. */
export function RoutingTableCard(): React.JSX.Element {
  const model = useRoutingTable()
  const [editor, setEditor] = useState<RouteEditorMode | null>(null)
  const [importing, setImporting] = useState(false)
  const [revertVersion, setRevertVersion] = useState<number | null>(null)
  const pill = cardStatus(model)
  const { list } = model
  const active = list?.active.ok ? list.active : null
  const activeRef = active ? { version: active.version, sha256: active.sha256 } : null
  const dialogOpen = editor !== null || importing
  const refusal = model.notice?.kind === 'error' ? model.notice.message : null
  const success = model.notice?.kind === 'success' ? model.notice.message : ''

  const openDialog = (open: () => void): void => {
    model.clearNotice()
    open()
  }
  const confirmRevert = (version: number): void => {
    setRevertVersion(null)
    void model.revert(version)
  }

  return (
    <IntegrationCardShell
      icon={<Waypoints className="size-5" />}
      name={translate('auto.components.settings.routingTable.card.name', 'Routing Table')}
      description={translate(
        'auto.components.settings.routingTable.card.description',
        'Chooses the executor, model and reasoning level for each task type Clef reports. Changes take effect only when you accept them.'
      )}
      checking={model.loading}
      statusLabel={pill.label}
      statusTone={pill.tone}
      settingsSectionId={ROUTING_TABLE_SECTION_ID}
      actions={
        <Button
          variant="ghost"
          size="xs"
          disabled={model.loading || model.busy}
          onClick={() => void model.refresh()}
        >
          <RefreshCw aria-hidden="true" />
          {translate('auto.components.settings.routingTable.card.refresh', 'Refresh')}
        </Button>
      }
    >
      {model.loading ? null : (
        <IntegrationCardDetails className="space-y-4">
          <div
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground empty:hidden"
          >
            {success}
          </div>
          {refusal !== null && !dialogOpen ? (
            <p role="alert" className="text-xs text-destructive">
              {refusal}
            </p>
          ) : null}
          {model.loadError === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {model.loadError}
            </p>
          )}
          {list === null ? null : (
            <TableBody
              model={model}
              list={list}
              onEditRoutes={() => openDialog(() => setEditor({ kind: 'propose' }))}
              onImport={() => openDialog(() => setImporting(true))}
              onEditProposal={(mode) => openDialog(() => setEditor(mode))}
              onRevert={setRevertVersion}
            />
          )}
        </IntegrationCardDetails>
      )}
      {editor !== null && active !== null && activeRef !== null ? (
        <RoutingTableRouteEditor
          mode={editor}
          active={active.table}
          activeRef={activeRef}
          busy={model.busy}
          refusal={refusal}
          onAccept={model.accept}
          onPropose={model.importChangeSet}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {importing ? (
        <RoutingTableImportDialog
          activeRef={activeRef}
          busy={model.busy}
          refusal={refusal}
          onImport={model.importChangeSet}
          onClose={() => setImporting(false)}
        />
      ) : null}
      <RoutingTableRevertDialog
        version={revertVersion}
        activeVersion={list?.activeVersion ?? null}
        onCancel={() => setRevertVersion(null)}
        onConfirm={confirmRevert}
      />
    </IntegrationCardShell>
  )
}
