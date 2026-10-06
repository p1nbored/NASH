import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { canonicalizeDeliverableLanguage } from '../../../../shared/deliverable-language'
import {
  WorkbenchRequestAccessSchema,
  type WorkbenchRequestAccess
} from '../../../../shared/workbench-request'

/** Launch settings kept beside each receipt: D-018 requested access, D-013 deliverable language. */
export type WorkbenchRequestSettings = {
  readonly requestedAccess: WorkbenchRequestAccess
  readonly deliverableLanguage: string | null
}

/** Settings from parsed submit params; the language is stored in its canonical form. */
export function workbenchRequestSettingsFrom(params: {
  readonly requestedAccess: WorkbenchRequestAccess
  readonly deliverableLanguage?: string | undefined
}): WorkbenchRequestSettings {
  if (params.deliverableLanguage === undefined) {
    return { requestedAccess: params.requestedAccess, deliverableLanguage: null }
  }
  const canonical = canonicalizeDeliverableLanguage(params.deliverableLanguage)
  if (!canonical.ok) {
    throw new OrchestrationError(
      'workbench_invalid_input',
      'Deliverable language is not a valid BCP 47 tag.'
    )
  }
  return { requestedAccess: params.requestedAccess, deliverableLanguage: canonical.tag }
}

export function insertWorkbenchRequestSettings(
  db: Database.Database,
  requestId: string,
  settings: WorkbenchRequestSettings
): void {
  db.prepare(
    'INSERT INTO workbench_request_settings (request_id, requested_access, deliverable_language) VALUES (?, ?, ?)'
  ).run(requestId, settings.requestedAccess, settings.deliverableLanguage)
}

/** Every v3 request is written with one settings row, so a missing or invalid row fails closed. */
export function readWorkbenchRequestSettings(
  db: Database.Database,
  requestId: string
): WorkbenchRequestSettings {
  const row = db
    .prepare(
      'SELECT requested_access, deliverable_language FROM workbench_request_settings WHERE request_id = ?'
    )
    .get(requestId)
  const access = WorkbenchRequestAccessSchema.safeParse(row?.requested_access)
  const language = row?.deliverable_language
  if (!access.success || (language !== null && typeof language !== 'string')) {
    throw new OrchestrationError(
      'workbench_recovery_required',
      'Request settings are missing or invalid.'
    )
  }
  return { requestedAccess: access.data, deliverableLanguage: language }
}

export function sameWorkbenchRequestSettings(
  left: WorkbenchRequestSettings,
  right: WorkbenchRequestSettings
): boolean {
  return (
    left.requestedAccess === right.requestedAccess &&
    left.deliverableLanguage === right.deliverableLanguage
  )
}
