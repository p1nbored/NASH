import { useId } from 'react'
import { translate } from '@/i18n/i18n'
import type { RoutingTableChanges } from '../../../../shared/routing-table/routing-table-edit-schema'
import type { WorkbenchRoutingTableListResult } from '../../../../shared/workbench-routing-table-view'
import { RoutingTableTaskList } from './routing-table-active-view'
import { EMPTY_ROUTING_MODELS, RoutingModelsContext } from './routing-table-model-select'
import { RouteCheckButton } from './routing-table-availability'
import { settingsEditSubmission } from './routing-table-inline-edit'
import { routingTableRefusalDetails, routingTableRefusalMessage } from './routing-table-messages'
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

/** Task routing: each task and reviewer is edited in place. */
export function RoutingTableCard(): React.JSX.Element {
  const model = useRoutingTable()
  const headingId = useId()
  const { list } = model
  const active = list?.active.ok ? list.active : null
  const activeRef = active ? { version: active.version, sha256: active.sha256 } : null
  const refusal = model.notice?.kind === 'error' ? model.notice : null
  const success = model.notice?.kind === 'success' ? model.notice.message : ''
  const status = headerStatus(model)

  const saveEdit = async (changes: RoutingTableChanges): Promise<boolean> => {
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
            {active !== null ? (
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
      {refusal !== null ? <ErrorLine message={refusal.message} details={refusal.details} /> : null}
      {model.loadError === null ? null : (
        <ErrorLine message={model.loadError} details={model.loadErrorDetails} />
      )}
      {list === null ? null : (
        <>
          <Blocked list={list} />
          {active === null ? null : (
            <RoutingModelsContext.Provider value={model.models ?? EMPTY_ROUTING_MODELS}>
              <RoutingTableTaskList
                table={active.table}
                availability={model.availability}
                busy={model.busy}
                onSave={saveEdit}
              />
            </RoutingModelsContext.Provider>
          )}
        </>
      )}
    </section>
  )
}
