import { translate } from '@/i18n/i18n'
import type { Route, RoutingTable } from '../../../../shared/routing-table/routing-table-schema'
import type {
  RouteAvailabilityView,
  RoutingTableAvailabilityView
} from '../../../../shared/workbench-route-availability-view'
import { RouteAvailabilityStatus } from './routing-table-availability'
import {
  executionTargetLabel,
  reasoningLevelLabel,
  reviewerTargetLabel,
  tableSourceLabel,
  taskTypeLabel
} from './routing-table-labels'
import { formatRoutingTime } from './routing-table-time'

type ActiveTable = {
  version: number
  sha256: string
  source: 'bundled' | 'user'
  table: RoutingTable
}

function inherits(route: Route): boolean {
  return route.model === 'inherit' && route.reasoning_level === 'inherit'
}

function RouteRow({
  route,
  showStatus,
  availability
}: {
  route: Route
  showStatus: boolean
  availability: RouteAvailabilityView | null
}): React.JSX.Element {
  const level = reasoningLevelLabel(route.reasoning_level)
  return (
    <tr className="border-t border-border/50 align-top">
      <td className="py-1.5 pr-3">
        <span className="block text-foreground">{taskTypeLabel(route.task_type)}</span>
        {route.notes ? (
          <span className="block text-[11px] text-muted-foreground">{route.notes}</span>
        ) : null}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {executionTargetLabel(route.execution_target)}
      </td>
      {inherits(route) ? (
        <td colSpan={2} className="py-1.5 text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.active.inheritsCoordinator',
            'Inherits coordinator'
          )}
        </td>
      ) : (
        <>
          <td className="py-1.5 pr-3 font-mono text-[11px]">{route.model}</td>
          <td className="py-1.5 whitespace-nowrap">
            {level}
            {route.reasoning_requirement === 'if_supported' ? (
              <span className="text-muted-foreground">
                {' '}
                {translate(
                  'auto.components.settings.routingTable.active.whenSupported',
                  '(when supported)'
                )}
              </span>
            ) : null}
          </td>
        </>
      )}
      {showStatus ? (
        <td className="py-1.5 pl-3">
          {availability ? <RouteAvailabilityStatus availability={availability} /> : null}
        </td>
      ) : null}
    </tr>
  )
}

function RouteTable({
  version,
  table,
  availability
}: {
  version: number
  table: RoutingTable
  availability: RoutingTableAvailabilityView | null
}): React.JSX.Element {
  const byTaskType = new Map(
    (availability?.routes ?? []).map((row) => [row.taskType, row.availability])
  )
  return (
    <div className="overflow-x-auto scrollbar-sleek">
      <table
        aria-label={translate(
          'auto.components.settings.routingTable.active.routesLabel',
          'Routes in version {{version}}',
          { version }
        )}
        className="w-full text-xs"
      >
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="pb-1.5 pr-3 font-medium">
              {translate('auto.components.settings.routingTable.active.taskType', 'Task type')}
            </th>
            <th className="pb-1.5 pr-3 font-medium">
              {translate('auto.components.settings.routingTable.active.executor', 'Executor')}
            </th>
            <th className="pb-1.5 pr-3 font-medium">
              {translate('auto.components.settings.routingTable.active.model', 'Model')}
            </th>
            <th className="pb-1.5 font-medium">
              {translate('auto.components.settings.routingTable.active.reasoning', 'Reasoning')}
            </th>
            {availability ? (
              <th className="pb-1.5 pl-3 font-medium">
                {translate('auto.components.settings.routingTable.active.status', 'Status')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {table.routes.map((route) => (
            <RouteRow
              key={route.task_type}
              route={route}
              showStatus={availability !== null}
              availability={byTaskType.get(route.task_type) ?? null}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Reviewers({
  table,
  availability
}: {
  table: RoutingTable
  availability: RoutingTableAvailabilityView | null
}): React.JSX.Element {
  const { reviewers, notes } = table.validation
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">
        {translate(
          'auto.components.settings.routingTable.active.reviewersTitle',
          'Validation reviewers'
        )}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {translate(
          'auto.components.settings.routingTable.active.reviewersHelp',
          'When a task has no automatic check, the first reviewer whose model differs from the one that did the work reviews it.'
        )}
      </p>
      {reviewers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.active.noReviewers',
            'No reviewers: such tasks cannot be validated by review.'
          )}
        </p>
      ) : (
        <ol
          aria-label={translate(
            'auto.components.settings.routingTable.active.reviewersTitle',
            'Validation reviewers'
          )}
          className="list-decimal space-y-0.5 pl-5 text-xs"
        >
          {reviewers.map((reviewer, index) => {
            const status = availability?.reviewers[index]
            return (
              <li key={`${reviewer.target}:${reviewer.model}:${reviewer.reasoning_level}`}>
                {reviewerTargetLabel(reviewer.target)} ·{' '}
                <span className="font-mono text-[11px]">{reviewer.model}</span> ·{' '}
                {reasoningLevelLabel(reviewer.reasoning_level)}
                {status ? (
                  <>
                    {' '}
                    <RouteAvailabilityStatus availability={status} layout="inline" />
                  </>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
      {notes ? <p className="text-[11px] text-muted-foreground">{notes}</p> : null}
    </div>
  )
}

/**
 * The table that routes delegated tasks now: version, coordinator, one row per task type, reviewers,
 * and each route's availability when the list carries it.
 */
export function RoutingTableActiveView({
  active,
  availability
}: {
  active: ActiveTable
  availability: RoutingTableAvailabilityView | null
}): React.JSX.Element {
  const { table, version } = active
  const coordinator = table.coordinator
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">
          {translate(
            'auto.components.settings.routingTable.active.versionActive',
            'Version {{version}} active',
            { version }
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {tableSourceLabel(active.source)} ·{' '}
          {translate('auto.components.settings.routingTable.active.created', 'created {{time}}', {
            time: formatRoutingTime(table.created_at)
          })}{' '}
          · <span className="font-mono">{active.sha256.slice(0, 12)}</span>
        </p>
      </div>
      <p className="text-xs">
        <span className="text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.active.coordinator',
            'Coordinator (primary session):'
          )}
        </span>{' '}
        <span className="font-mono text-[11px]">{coordinator.model}</span> ·{' '}
        {reasoningLevelLabel(coordinator.reasoning_level)}
        {availability ? (
          <>
            {' '}
            <RouteAvailabilityStatus availability={availability.coordinator} layout="inline" />
          </>
        ) : null}
      </p>
      <RouteTable version={version} table={table} availability={availability} />
      <Reviewers table={table} availability={availability} />
      {table.notes ? <p className="text-[11px] text-muted-foreground">{table.notes}</p> : null}
    </div>
  )
}
