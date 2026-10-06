import type { OrchestrationDb } from '../orchestration/db'
import { isEquivalentPaneKey } from '../orchestration/db/pane-key-match'
import type { PrimarySessionRecord } from '../orchestration/db/primary-session-store'

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
