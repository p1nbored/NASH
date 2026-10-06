import type { OrchestrationDb } from '../orchestration/db'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import type { PrimaryLaunchLedgerPort } from './primary-session-ledger'
import { PRIMARY_EXIT_REASON } from './primary-session-exit-watch'
import { moveOwner, moveWorkflowRun } from './primary-session-moves'
import { clockTimestamp, type PrimaryTerminalPort } from './primary-session-ports'
import { releaseEndedPrimaryBinding } from './primary-session-run-binding'
import { promoteVerifiedOwner, readPrimarySessionStatus } from './primary-session-status'

const RECONCILE_LIMIT = 1000

export type PrimarySessionReconcileDeps = {
  readonly db: OrchestrationDb
  readonly terminal: Pick<
    PrimaryTerminalPort,
    | 'getTerminalAgentStatus'
    | 'getTerminalProcessIncarnation'
    | 'getTerminalHandleForPaneKey'
    | 'getOrchestrationDispatchAuthority'
  >
  /** Only `read` is used: reconcile never admits, so it can never start a launch. */
  readonly ledger: PrimaryLaunchLedgerPort
  readonly clock: { now(): number }
  readonly exitWatches?: { watch(owner: PrimarySessionRecord): void }
}

export type PrimarySessionReconcileReport = {
  adopted: number
  verified: number
  unverified: number
  failedLaunches: number
  releasedBindings: number
  endedRuns: number
}

/** A starting owner: adopt what Orca's ledger proves started, close what it proves failed, else unknown. */
function reconcileStarting(
  deps: PrimarySessionReconcileDeps,
  owner: PrimarySessionRecord,
  report: PrimarySessionReconcileReport,
  timestamp: string
): void {
  const row = deps.ledger.read(owner.launchOperationId)
  if (row.kind === 'failed') {
    moveOwner(deps.db, owner.ownerId, 'stopped', 'launch_failed_no_effects', timestamp)
    report.failedLaunches += 1
    return
  }
  const outcome = row.kind === 'succeeded' ? row.result.outcome : null
  const paneKey = outcome?.kind === 'terminal' ? (outcome.paneKey ?? null) : null
  const handle = paneKey ? deps.terminal.getTerminalHandleForPaneKey(paneKey) : null
  const incarnation = handle ? deps.terminal.getTerminalProcessIncarnation(handle) : null
  if (row.kind !== 'succeeded' || !paneKey || !handle || !incarnation) {
    moveOwner(deps.db, owner.ownerId, 'unverifiable', 'launch_outcome_unknown', timestamp)
    report.unverified += 1
    return
  }
  // Why: the ledger names the pane, but not the process it started; adopt it as unverifiable.
  getPrimarySessionStore(deps.db).markRunning(owner.ownerId, {
    terminalHandle: handle,
    paneKey,
    processIncarnation: incarnation,
    launchTokenSha256:
      deps.terminal.getOrchestrationDispatchAuthority(handle)?.launchTokenHash ?? null,
    launchLedger: 'orca',
    receipt: { adoptedAfterRestart: true, mode: 'terminal' },
    timestamp
  })
  moveOwner(deps.db, owner.ownerId, 'unverifiable', 'reconciled_after_restart', timestamp)
  report.adopted += 1
}

async function reconcileLive(
  deps: PrimarySessionReconcileDeps,
  owner: PrimarySessionRecord,
  report: PrimarySessionReconcileReport,
  timestamp: string
): Promise<void> {
  if (owner.state === 'stopping') {
    moveOwner(deps.db, owner.ownerId, 'unverifiable', 'stop_interrupted', timestamp)
    report.unverified += 1
    return
  }
  const status = await readPrimarySessionStatus(deps.terminal, owner)
  const verified = status.kind === 'live' || status.kind === 'agent_absent'
  if (verified) {
    if (owner.state === 'unverifiable') {
      promoteVerifiedOwner(getPrimarySessionStore(deps.db), owner, status, timestamp)
      report.verified += 1
    }
    return
  }
  if (owner.state === 'running') {
    moveOwner(deps.db, owner.ownerId, 'unverifiable', 'reconciled_after_restart', timestamp)
    report.unverified += 1
  }
}

/** A launching run whose launch did not finish before the restart is never resumed or relaunched. */
function reconcileLaunchingRuns(deps: PrimarySessionReconcileDeps, timestamp: string): void {
  const sessions = getPrimarySessionStore(deps.db)
  for (const run of getWorkflowRunStore(deps.db).listByStatus(['launching'], RECONCILE_LIMIT)) {
    const owner = sessions.latestForRun(run.runId)
    const noEffects = owner === null || owner.state === 'stopped'
    moveWorkflowRun(
      deps.db,
      run.runId,
      noEffects ? 'failed' : 'unverifiable',
      noEffects ? 'launch_refused' : 'launch_outcome_unknown',
      timestamp
    )
  }
}

/** An exit recorded on the owner but never on its run (every retry failed): the run ends now. */
function endRunsOfExitedOwners(deps: PrimarySessionReconcileDeps, timestamp: string): number {
  const sessions = getPrimarySessionStore(deps.db)
  let ended = 0
  for (const run of getWorkflowRunStore(deps.db).listByStatus(['active'], RECONCILE_LIMIT)) {
    const owner = sessions.latestForRun(run.runId)
    if (owner?.state === 'exited' && owner.endReason === PRIMARY_EXIT_REASON) {
      moveWorkflowRun(deps.db, run.runId, 'failed', PRIMARY_EXIT_REASON, timestamp)
      ended += 1
    }
  }
  return ended
}

/** Ended owners whose Orca run is still bound to a pane: the B4 fence would hold that pane forever. */
function releaseStaleBindings(deps: PrimarySessionReconcileDeps): number {
  const rows = deps.db.db
    .prepare(
      `SELECT ps.owner_id AS owner_id FROM primary_sessions ps JOIN runs r ON r.id = ps.run_id
        WHERE ps.state IN ('stopped', 'exited') AND r.coordinator_pane_key IS NOT NULL
          AND ps.generation = (SELECT MAX(generation) FROM primary_sessions WHERE run_id = ps.run_id)
        ORDER BY ps.sequence LIMIT ?`
    )
    .all(RECONCILE_LIMIT)
  const sessions = getPrimarySessionStore(deps.db)
  let released = 0
  for (const row of rows) {
    const owner = sessions.get(String(row.owner_id))
    if (owner && releaseEndedPrimaryBinding(deps.db, owner)) {
      released += 1
    }
  }
  return released
}

/**
 * Runs once at startup. It never calls `admitAgentLaunchOperation` and never launches: it settles
 * owners and runs from Orca's ledger and the panes' own evidence, then re-arms the exit watches.
 */
export async function reconcilePrimarySessions(
  deps: PrimarySessionReconcileDeps
): Promise<PrimarySessionReconcileReport> {
  const timestamp = clockTimestamp(deps.clock)
  const report: PrimarySessionReconcileReport = {
    adopted: 0,
    verified: 0,
    unverified: 0,
    failedLaunches: 0,
    releasedBindings: 0,
    endedRuns: 0
  }
  const sessions = getPrimarySessionStore(deps.db)
  for (const owner of sessions.listLive(RECONCILE_LIMIT)) {
    if (owner.state === 'starting') {
      reconcileStarting(deps, owner, report, timestamp)
    } else {
      await reconcileLive(deps, owner, report, timestamp)
    }
  }
  reconcileLaunchingRuns(deps, timestamp)
  report.endedRuns = endRunsOfExitedOwners(deps, timestamp)
  report.releasedBindings = releaseStaleBindings(deps)
  for (const owner of sessions.listLive(RECONCILE_LIMIT)) {
    deps.exitWatches?.watch(owner)
  }
  return report
}
