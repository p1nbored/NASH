import type { CoordinatorStatus, CoordinatorRun } from '../../types'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'

// ── Coordinator Runs ──

export function createCoordinatorRun(
  this: OrchestrationDb,
  run: {
    spec: string
    coordinatorHandle: string
    pollIntervalMs?: number
  }
): CoordinatorRun {
  const id = generateId('run')
  this.db
    .prepare(
      "INSERT INTO coordinator_runs (id, spec, status, coordinator_handle, poll_interval_ms) VALUES (?, ?, 'running', ?, ?)"
    )
    .run(id, run.spec, run.coordinatorHandle, run.pollIntervalMs ?? 2000)
  return this.db.prepare('SELECT * FROM coordinator_runs WHERE id = ?').get(id) as CoordinatorRun
}

export function getCoordinatorRun(this: OrchestrationDb, id: string): CoordinatorRun | undefined {
  return this.db.prepare('SELECT * FROM coordinator_runs WHERE id = ?').get(id) as
    | CoordinatorRun
    | undefined
}

export function updateCoordinatorRun(
  this: OrchestrationDb,
  id: string,
  status: CoordinatorStatus
): CoordinatorRun | undefined {
  const completedAt =
    status === 'completed' || status === 'failed' ? new Date().toISOString() : null
  this.db
    .prepare(
      'UPDATE coordinator_runs SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?'
    )
    .run(status, completedAt, id)
  return this.getCoordinatorRun(id)
}

export function getActiveCoordinatorRun(this: OrchestrationDb): CoordinatorRun | undefined {
  return this.db
    .prepare(
      "SELECT * FROM coordinator_runs WHERE status = 'running' ORDER BY created_at DESC LIMIT 1"
    )
    .get() as CoordinatorRun | undefined
}

export type CoordinatorRunStoreMethods = {
  createCoordinatorRun: typeof createCoordinatorRun
  getCoordinatorRun: typeof getCoordinatorRun
  updateCoordinatorRun: typeof updateCoordinatorRun
  getActiveCoordinatorRun: typeof getActiveCoordinatorRun
}

export function attachCoordinatorRunStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createCoordinatorRun,
    getCoordinatorRun,
    updateCoordinatorRun,
    getActiveCoordinatorRun
  })
}
