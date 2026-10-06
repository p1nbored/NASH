import type Database from '../../../sqlite/sync-database'
import {
  DOT_INGRESS_RATE_WINDOW_MS,
  DOT_INGRESS_RECEIVED_LIMIT,
  DOT_INGRESS_RETAINED_LIMIT
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import { readDotIngressSettings, readDotWorkspace } from './dot-ingress-settings-store'
import { dotIngressError } from './dot-ingress-store-input'

/**
 * Rail 1 (a default the user can change, one workspace at a time): the interface is on and the
 * workspace was enabled for dot, with the binding the user saw. Needs no per-task step.
 */
export function requireOpenWorkspace(
  db: Database.Database,
  target: { workspaceRef: string; workspaceBinding: string }
): void {
  if (!readDotIngressSettings(db).enabled) {
    throw dotIngressError('dot_ingress_disabled')
  }
  const workspace = readDotWorkspace(db, target.workspaceRef)
  if (!workspace?.enabled) {
    throw dotIngressError('dot_workspace_unknown')
  }
  if (workspace.workspaceBinding !== target.workspaceBinding) {
    throw dotIngressError('dot_workspace_unavailable')
  }
}

/**
 * Rail 2 (default caps the user can change): submissions per sliding minute and per UTC day over
 * every row the dot created, whatever became of it; then the store's own retention limits.
 */
export function requireWithinLimits(db: Database.Database, timestamp: string): void {
  const { ratePerMinute, ratePerUtcDay } = readDotIngressSettings(db)
  const countCreated = (comparison: '>' | '>=', since: string): number =>
    Number(
      db
        .prepare(`SELECT count(*) AS n FROM dot_ingress_requests WHERE created_at ${comparison} ?`)
        .get(since)?.n
    )
  const minuteStart = new Date(Date.parse(timestamp) - DOT_INGRESS_RATE_WINDOW_MS).toISOString()
  if (countCreated('>', minuteStart) >= ratePerMinute) {
    throw dotIngressError('dot_rate_limited', { window: 'minute' })
  }
  const dayStart = `${timestamp.slice(0, 10)}T00:00:00.000Z`
  if (countCreated('>=', dayStart) >= ratePerUtcDay) {
    throw dotIngressError('dot_rate_limited', { window: 'utc_day' })
  }
  const counts = db
    .prepare(
      `SELECT count(*) AS total, sum(CASE WHEN state = 'received' THEN 1 ELSE 0 END) AS received
        FROM dot_ingress_requests`
    )
    .get()
  if (
    Number(counts?.total) >= DOT_INGRESS_RETAINED_LIMIT ||
    Number(counts?.received) >= DOT_INGRESS_RECEIVED_LIMIT
  ) {
    throw dotIngressError('dot_capacity_exceeded')
  }
}
