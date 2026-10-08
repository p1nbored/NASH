import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import {
  WorkbenchRequestAccessSchema,
  type WorkbenchRequestAccess
} from '../../../../shared/workbench-request'

export type WorkbenchRequestSettings = {
  readonly requestedAccess: WorkbenchRequestAccess
}

export function workbenchRequestSettingsFrom(params: {
  readonly requestedAccess: WorkbenchRequestAccess
}): WorkbenchRequestSettings {
  return { requestedAccess: params.requestedAccess }
}

export function insertWorkbenchRequestSettings(
  db: Database.Database,
  requestId: string,
  settings: WorkbenchRequestSettings
): void {
  db.prepare(
    'INSERT INTO workbench_request_settings (request_id, requested_access) VALUES (?, ?)'
  ).run(requestId, settings.requestedAccess)
}

export function readWorkbenchRequestSettings(
  db: Database.Database,
  requestId: string
): WorkbenchRequestSettings {
  const row = db
    .prepare('SELECT requested_access FROM workbench_request_settings WHERE request_id = ?')
    .get(requestId)
  const access = WorkbenchRequestAccessSchema.safeParse(row?.requested_access)
  if (!access.success) {
    throw new OrchestrationError('workbench_recovery_required', 'Request settings are missing or invalid.')
  }
  return { requestedAccess: access.data }
}

export function sameWorkbenchRequestSettings(
  left: WorkbenchRequestSettings,
  right: WorkbenchRequestSettings
): boolean {
  return left.requestedAccess === right.requestedAccess
}
