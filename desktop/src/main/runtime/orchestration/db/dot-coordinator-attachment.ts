import type Database from '../../../sqlite/sync-database'
import type { OrchestrationDb } from './orchestration-db'
import { OrchestrationError } from '../orchestration-error'
import { readDotWorkspaceMaxAccess } from './dot-ingress-workspace-access'

const SQL = `CREATE TABLE dot_coordinator_attachments (
  run_id TEXT PRIMARY KEY NOT NULL,
  dot_request_id TEXT UNIQUE NOT NULL REFERENCES dot_ingress_requests(dot_request_id),
  attached_at TEXT NOT NULL
)`

export function ensureDotCoordinatorAttachments(db: Database.Database): void {
  const current = db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'dot_coordinator_attachments'")
    .get()
  if (!current) {
    db.exec(SQL)
    return
  }
  if (String(current.sql).replace(/\s+/g, ' ').trim() !== SQL.replace(/\s+/g, ' ').trim()) {
    throw new OrchestrationError(
      'dot_recovery_required',
      'Unsupported coordinator attachment schema.'
    )
  }
}

export function dotCoordinatorAttachment(
  db: OrchestrationDb,
  filter: { runId: string } | { dotRequestId: string }
): { runId: string; dotRequestId: string } | null {
  if (
    !db.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'dot_coordinator_attachments'").get()
  ) {
    return null
  }
  const byRun = 'runId' in filter
  const row = db.db
    .prepare(`SELECT a.run_id, a.dot_request_id FROM dot_coordinator_attachments a
    JOIN dot_ingress_requests r ON r.dot_request_id = a.dot_request_id
    WHERE ${byRun ? 'a.run_id' : 'a.dot_request_id'} = ? AND r.state = 'submitted'`)
    .get(byRun ? filter.runId : filter.dotRequestId)
  return row ? { runId: String(row.run_id), dotRequestId: String(row.dot_request_id) } : null
}

export function dotCoordinatorControlEnabled(db: OrchestrationDb, dotRequestId: string): boolean {
  const row = db.db
    .prepare(`SELECT r.workspace_ref, r.requested_access FROM dot_ingress_requests r
    JOIN dot_ingress_workspaces w ON w.workspace_ref = r.workspace_ref
    JOIN dot_ingress_settings s ON s.id = 1
    WHERE r.dot_request_id = ? AND r.state = 'submitted' AND w.enabled = 1 AND s.enabled = 1
      AND w.workspace_binding = r.workspace_binding`)
    .get(dotRequestId)
  return Boolean(
    row &&
    (row.requested_access === 'read_only' ||
      readDotWorkspaceMaxAccess(db.db, String(row.workspace_ref)) === 'workspace_write')
  )
}
