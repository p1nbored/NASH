// FIXTURE_ONLY: synthetic intake evidence; the columns mirror only what the origin read selects.
import type { OrchestrationDb } from '../orchestration/db'

/** Minimal stand-ins for the intake tables, so these tests do not depend on the Workbench schema. */
export function createIntakeEvidenceTables(db: OrchestrationDb): void {
  db.db.exec(
    'CREATE TABLE workbench_requests (request_id TEXT UNIQUE NOT NULL, principal_id TEXT NOT NULL)'
  )
  db.db.exec('CREATE TABLE dot_ingress_requests (workbench_request_id TEXT)')
}

export function recordIntakePrincipal(
  db: OrchestrationDb,
  requestId: string,
  principalId: string
): void {
  db.db
    .prepare('INSERT INTO workbench_requests (request_id, principal_id) VALUES (?, ?)')
    .run(requestId, principalId)
}

/** A manual timer queue: nothing runs until the test fires it. */
export function manualTimers() {
  let nextId = 1
  const pending = new Map<number, { fn: () => void; ms: number }>()
  return {
    timers: {
      schedule(fn: () => void, ms: number): () => void {
        const id = nextId++
        pending.set(id, { fn, ms })
        return () => {
          pending.delete(id)
        }
      }
    },
    pendingCount: () => pending.size,
    fireAll(): void {
      const due = [...pending.values()]
      pending.clear()
      for (const timer of due) {
        timer.fn()
      }
    }
  }
}
