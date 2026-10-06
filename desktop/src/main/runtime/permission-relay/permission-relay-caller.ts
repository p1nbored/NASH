import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrchestrationCompatibilityCallerAuthority } from '../runtime-terminal-contracts'
import { resolveAppRunPrimary, type AppRunPrimaryRefusal } from '../workflow-run/app-run-primary'
import { appRunReadersFor, NO_APP_RUNS, type AppRunReaders } from '../workflow-run/app-run-readers'

export const PERMISSION_RELAY_ERROR_CODES = {
  callerRefused: 'autopilot_permission_caller_refused',
  notFound: 'autopilot_permission_not_found',
  desktopOnly: 'autopilot_permission_desktop_only',
  summaryRefused: 'autopilot_permission_summary_refused',
  unavailable: 'autopilot_permission_relay_unavailable'
} as const

/** The primary session that raised a prompt, as the relay records and observes it. */
export type PermissionRelayCaller = Readonly<{
  runId: string
  ownerId: string
  terminalHandle: string
  paneKey: string
}>

// Why one reason for the first three: the relay has always refused a pane outside an open app run alike.
const RELAY_REFUSAL_REASONS: Readonly<Record<AppRunPrimaryRefusal, string>> = {
  not_app_run: 'not_app_run_primary',
  not_run_primary: 'not_app_run_primary',
  run_closed: 'not_app_run_primary',
  owner_not_running: 'owner_not_running',
  process_mismatch: 'process_mismatch'
}

function refused(reason: string): OrchestrationError {
  return new OrchestrationError(
    PERMISSION_RELAY_ERROR_CODES.callerRefused,
    'Only the primary session of an app run can raise a relayed permission prompt. No effects were applied.',
    { effectsApplied: false, reason }
  )
}

/** The app-run readers, or null when this database never held an app run (no table is created). */
export function appRunReadersIfPresent(db: OrchestrationDb): AppRunReaders | null {
  const readers = appRunReadersFor(db)
  return readers === NO_APP_RUNS ? null : readers
}

/**
 * Accepts only the attested pane of a live primary session of an open app run, running the same
 * process the app launched. `authority` comes from `verifyOrchestrationCompatibilityCaller` over
 * the request's pane evidence; the pane match uses the B4 app-run readers.
 */
export function resolvePermissionRelayCaller(
  db: OrchestrationDb,
  authority: OrchestrationCompatibilityCallerAuthority | null
): PermissionRelayCaller {
  if (!authority) {
    throw refused('not_attested')
  }
  const readers = appRunReadersIfPresent(db)
  if (!readers) {
    throw refused('not_app_run_primary')
  }
  const resolved = resolveAppRunPrimary(db, readers, authority, { openRunOnly: true })
  if (!resolved.ok) {
    throw refused(RELAY_REFUSAL_REASONS[resolved.refusal])
  }
  return Object.freeze({
    runId: resolved.primary.run.runId,
    ownerId: resolved.primary.ownerId,
    terminalHandle: authority.terminalHandle,
    paneKey: authority.paneKey
  })
}
