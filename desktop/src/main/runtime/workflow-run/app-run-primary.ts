import type { OrchestrationDb } from '../orchestration/db'
import { isEquivalentPaneKey } from '../orchestration/db/pane-key-match'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { WORKFLOW_RUN_TERMINAL_STATUSES } from '../orchestration/db/workflow-run-transition'
import type { OrchestrationCompatibilityCallerAuthority } from '../runtime-terminal-contracts'
import type { AppRunReaders, AppRunRecord } from './app-run-readers'

// The one check that an attested pane is the live primary session of an app run; the task commands
// and the permission relay map its refusals to their own codes and texts.

/** Why a pane is not the live primary of an app run. */
export type AppRunPrimaryRefusal =
  | 'not_app_run'
  | 'not_run_primary'
  | 'run_closed'
  | 'owner_not_running'
  | 'process_mismatch'

export type AppRunPrimary = Readonly<{ run: AppRunRecord; ownerId: string }>

export type AppRunPrimaryResolution =
  | { readonly ok: true; readonly primary: AppRunPrimary }
  | { readonly ok: false; readonly refusal: AppRunPrimaryRefusal }

export type AppRunPrimaryScope = {
  /** The run Orca binds the pane to; without it the run is the one whose live primary holds the pane. */
  readonly runId?: string
  /** Refuse a completed, failed or canceled run before the owner is read. */
  readonly openRunOnly?: boolean
}

type AttestedPane = Pick<
  OrchestrationCompatibilityCallerAuthority,
  'paneKey' | 'processIncarnation'
>

const LIVE_OWNER_STATES: ReadonlySet<string> = new Set(['running', 'unverifiable'])
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(WORKFLOW_RUN_TERMINAL_STATUSES)

function refused(refusal: AppRunPrimaryRefusal): AppRunPrimaryResolution {
  return { ok: false, refusal }
}

/**
 * Accepts only the attested pane of the live primary of an app run (the B4 readers' live panes and
 * the run's workflow_runs row), whose live owner holds the same pane and the process incarnation the
 * app launched. One live primary per run is a unique index, so a named run has at most one pane.
 */
export function resolveAppRunPrimary(
  db: OrchestrationDb,
  readers: AppRunReaders,
  attested: AttestedPane,
  scope: AppRunPrimaryScope = {}
): AppRunPrimaryResolution {
  const pane = readers
    .listLivePrimaryPanes()
    .find(
      (live) =>
        (scope.runId === undefined || live.runId === scope.runId) &&
        live.paneKey !== null &&
        isEquivalentPaneKey(live.paneKey, attested.paneKey)
    )
  const runId = scope.runId ?? pane?.runId
  if (runId === undefined) {
    return refused('not_run_primary')
  }
  const run = readers.findAppRun(runId)
  if (!run) {
    return refused('not_app_run')
  }
  if (!pane) {
    return refused('not_run_primary')
  }
  const native = db.getCurrentRunForCoordinator({
    terminalHandle: null,
    paneKey: attested.paneKey,
    orcaSessionId: null
  })
  if (native?.id !== run.runId) {
    return refused('not_run_primary')
  }
  if (scope.openRunOnly && TERMINAL_RUN_STATUSES.has(run.status)) {
    return refused('run_closed')
  }
  const owner = getPrimarySessionStore(db).findLiveByRun(run.runId)
  if (
    !owner ||
    !LIVE_OWNER_STATES.has(owner.state) ||
    owner.paneKey === null ||
    !isEquivalentPaneKey(owner.paneKey, attested.paneKey)
  ) {
    return refused('owner_not_running')
  }
  if (owner.processIncarnation !== attested.processIncarnation) {
    return refused('process_mismatch')
  }
  return { ok: true, primary: Object.freeze({ run, ownerId: owner.ownerId }) }
}
