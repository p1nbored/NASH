import type { OrchestrationDb } from '../orchestration/db'
import { isEquivalentPaneKey } from '../orchestration/db/pane-key-match'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'

/** Native binding owns coordinator membership; cached owner rows may lag a run switch. */
export function isPrimaryBoundToRun(db: OrchestrationDb, owner: PrimarySessionRecord): boolean {
  return (
    db.getCurrentRunForCoordinator({
      terminalHandle: owner.terminalHandle,
      paneKey: owner.paneKey,
      orcaSessionId: null
    })?.id === owner.runId
  )
}

/** Retires the metadata lease only, without claiming that the coordinator process died. */
export function retireUnboundPrimaryOwner(
  db: OrchestrationDb,
  owner: PrimarySessionRecord,
  timestamp: string
): boolean {
  if (
    !owner.paneKey ||
    (owner.state !== 'running' && owner.state !== 'unverifiable') ||
    isPrimaryBoundToRun(db, owner)
  ) {
    return false
  }
  getPrimarySessionStore(db).transition({
    ownerId: owner.ownerId,
    from: owner.state,
    to: 'exited',
    reason: 'coordinator_rebound',
    timestamp
  })
  return true
}

/**
 * B4 fences a pane that Orca still binds to an app run, even after its primary ended. Once the owner is
 * stopped or exited, this clears that run's coordinator binding through Orca's own `bindRun`, which
 * also moves unread direct mail to the run mailbox and fences unacknowledged deliveries. A binding that
 * already names another pane is left alone.
 */
export function releaseEndedPrimaryBinding(
  db: OrchestrationDb,
  owner: PrimarySessionRecord
): boolean {
  if ((owner.state !== 'stopped' && owner.state !== 'exited') || owner.paneKey === null) {
    return false
  }
  const run = db.getRun(owner.runId)
  const boundPane = run?.coordinator_pane_key ?? null
  if (boundPane === null || !isEquivalentPaneKey(boundPane, owner.paneKey)) {
    return false
  }
  db.bindRun({ runId: owner.runId, coordinatorHandle: null, coordinatorPaneKey: null })
  return true
}
