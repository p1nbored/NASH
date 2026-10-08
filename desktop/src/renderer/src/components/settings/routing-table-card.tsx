import { useId, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type {
  ProposalChanges,
  RoutingTableProposal
} from '../../../../shared/routing-table/routing-table-proposal-schema'
import type { WorkbenchRoutingTableListResult } from '../../../../shared/workbench-routing-table-view'
import { Button } from '../ui/button'
import { RoutingTableTaskList } from './routing-table-active-view'
import { RoutingTableAdvanced } from './routing-table-advanced'
import { RouteCheckButton } from './routing-table-availability'
import { RoutingTableImportDialog } from './routing-table-import-dialog'
import { settingsEditSubmission } from './routing-table-inline-edit'
import { routingTableRefusalDetails, routingTableRefusalMessage } from './routing-table-messages'
import { RoutingTableRouteEditor } from './routing-table-route-editor'
import { RoutingTableRevertDialog } from './routing-table-versions'
import { RoutingWarningCallout } from './routing-warning-callout'
import { CopyDetailsButton } from './settings-copy-details-button'
import { SettingsStatusLabel } from './settings-status-label'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { useRoutingTable, type RoutingTableModel } from './use-routing-table'

export const ROUTING_TABLE_SECTION_ID = 'integrations-routing-table'

function headerStatus(model: RoutingTableModel): string | null {
  if (model.loading) {
    return null
  }
  if (model.list === null) {
    return translate('auto.components.settings.routingTable.card.unavailable', 'Unavailable')
  }
  return model.list.active.ok
    ? null
    : translate('auto.components.settings.routingTable.card.blocked', 'Blocked')
}

/** A short message in the text, its codes behind "Copy details". */
function ErrorLine(props: { message: string; details?: string | null }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-row">
      <p role="alert" className="text-meta text-destructive">
        {props.message}
      </p>
      {props.details ? <CopyDetailsButton details={props.details} /> : null}
    </div>
  )
}

function PendingNotice(props: { count: number; onReview: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-row">
      <SettingsStatusLabel
        tone="warning"
        label={translate(
          'auto.components.settings.routingTable.card.pendingNotice',
          'Suggested changes to review: {{count}}',
          { count: props.count }
        )}
      />
      <Button variant="outline" size="xs" onClick={props.onReview}>
        {translate('auto.components.settings.routingTable.card.review', 'Review')}
      </Button>
    </div>
  )
}

function Blocked({ list }: { list: WorkbenchRoutingTableListResult }): React.JSX.Element | null {
  if (list.active.ok) {
    return null
  }
  const refusal = list.active
  return (
    <RoutingWarningCallout
      label={translate(
        'auto.components.settings.routingTable.card.blockedTitle',
        'Routing is blocked'
      )}
    >
      <p>{routingTableRefusalMessage(refusal)}</p>
      <CopyDetailsButton details={() => routingTableRefusalDetails(refusal)} />
    </RoutingWarningCallout>
  )
}

/**
 * Task routing (D-016, D-035): each kind of task with its agent, model and effort, edited in place.
 * Versions, suggested changes, history and import wait in a closed Advanced section.
 */
export function RoutingTableCard(): React.JSX.Element {
  const model = useRoutingTable()
  const headingId = useId()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [modifying, setModifying] = useState<RoutingTableProposal | null>(null)
  const [importing, setImporting] = useState(false)
  const [revertVersion, setRevertVersion] = useState<number | null>(null)
  const { list } = model
  const active = list?.active.ok ? list.active : null
  const activeRef = active ? { version: active.version, sha256: active.sha256 } : null
  const dialogOpen = modifying !== null || importing
  const refusal = model.notice?.kind === 'error' ? model.notice : null
  const success = model.notice?.kind === 'success' ? model.notice.message : ''
  const pending = list?.proposals.filter((entry) => entry.decision === null).length ?? 0
  const status = headerStatus(model)

  const openDialog = (open: () => void): void => {
    model.clearNotice()
    open()
  }
  const confirmRevert = (version: number): void => {
    setRevertVersion(null)
    void model.revert(version)
  }
  const saveEdit = async (changes: ProposalChanges): Promise<boolean> => {
    const submission = activeRef === null ? null : settingsEditSubmission(changes, activeRef)
    return submission === null ? false : model.applyEdit(submission)
  }

  return (
    <section
      aria-labelledby={headingId}
      data-settings-section={ROUTING_TABLE_SECTION_ID}
      className="space-y-group"
    >
      <SettingsSubsectionHeader
        title={
          <span id={headingId}>
            {translate('auto.components.settings.routingTable.card.title', 'Agents for each task')}
          </span>
        }
        action={
          <div className="flex items-center gap-row">
            {status === null ? null : <SettingsStatusLabel tone="warning" label={status} />}
            {active !== null && model.availability !== null ? (
              <RouteCheckButton
                checking={model.checking}
                disabled={model.loading || model.busy}
                onCheck={() => void model.checkRoutes()}
              />
            ) : null}
          </div>
        }
      />
      <div
        role="status"
        aria-live="polite"
        className="text-meta text-muted-foreground empty:hidden"
      >
        {success}
      </div>
      {refusal !== null && !dialogOpen ? (
        <ErrorLine message={refusal.message} details={refusal.details} />
      ) : null}
      {model.loadError === null ? null : (
        <ErrorLine message={model.loadError} details={model.loadErrorDetails} />
      )}
      {list === null ? null : (
        <>
          <Blocked list={list} />
          {pending > 0 && !advancedOpen ? (
            <PendingNotice count={pending} onReview={() => setAdvancedOpen(true)} />
          ) : null}
          {active === null ? null : (
            <RoutingTableTaskList
              table={active.table}
              availability={model.availability}
              busy={model.busy}
              onSave={saveEdit}
            />
          )}
          <RoutingTableAdvanced
            model={model}
            list={list}
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
            onEditProposal={(proposal) => openDialog(() => setModifying(proposal))}
            onImport={() => openDialog(() => setImporting(true))}
            onRevert={setRevertVersion}
          />
        </>
      )}
      {modifying !== null && active !== null ? (
        <RoutingTableRouteEditor
          proposal={modifying}
          active={active.table}
          busy={model.busy}
          refusal={refusal?.message ?? null}
          onAccept={model.accept}
          onClose={() => setModifying(null)}
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
    </section>
  )
}
