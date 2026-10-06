import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import {
  DOT_DEFAULT_REQUEST_ACCESS,
  DOT_REQUEST_ACCESS_LEVELS,
  type DotRequestAccess
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import {
  DotRequestAccessSchema,
  DotWorkspaceRefSchema
} from '../../../../shared/dot-ingress/dot-ingress-params'
import { sqlStringList } from './autopilot-run-schema-definition'
import { dotIngressError, parseDotInput, parseDotRow } from './dot-ingress-store-input'

// The per-workspace access ceiling: the most access a dot request to the workspace may state. The user
// sets it when enabling the workspace; it defaults to read_only. A sibling table keeps the frozen
// dot_ingress layout unchanged, and it exists only once a user raised a ceiling: absent means read_only.

const TABLE = 'dot_ingress_workspace_access'

export type DotMaxAccess = DotRequestAccess
/** Optional on enable: omitting it sets the ceiling back to read_only. */
export const DotMaxAccessSchema = DotRequestAccessSchema.default(DOT_DEFAULT_REQUEST_ACCESS)

export const DOT_WORKSPACE_ACCESS_DEFINITION = `CREATE TABLE ${TABLE} (
  workspace_ref TEXT PRIMARY KEY NOT NULL REFERENCES dot_ingress_workspaces (workspace_ref),
  max_access TEXT NOT NULL CHECK (max_access IN (${sqlStringList(DOT_REQUEST_ACCESS_LEVELS)})),
  updated_at TEXT NOT NULL
)`

const AccessRowSchema = z.object({ max_access: z.enum(DOT_REQUEST_ACCESS_LEVELS) })

function signature(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** False when absent; throws when present with any other layout, so a drifted table is never trusted. */
function verifiedTablePresent(db: Database.Database): boolean {
  const stored = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(TABLE)
  if (!stored) {
    return false
  }
  if (
    typeof stored.sql !== 'string' ||
    signature(stored.sql) !== signature(DOT_WORKSPACE_ACCESS_DEFINITION)
  ) {
    throw dotIngressError('dot_recovery_required')
  }
  return true
}

export function readDotWorkspaceMaxAccess(
  db: Database.Database,
  workspaceRef: string
): DotMaxAccess {
  const ref = parseDotInput(DotWorkspaceRefSchema, workspaceRef, 'workspace reference')
  if (!verifiedTablePresent(db)) {
    return DOT_DEFAULT_REQUEST_ACCESS
  }
  const row = db.prepare(`SELECT max_access FROM ${TABLE} WHERE workspace_ref = ?`).get(ref)
  return row ? parseDotRow(AccessRowSchema, row).max_access : DOT_DEFAULT_REQUEST_ACCESS
}

/**
 * Stores the ceiling inside the caller's transaction, so it commits or rolls back with the enable.
 * The default needs no row while the table does not exist yet.
 */
export function writeDotWorkspaceMaxAccess(
  db: Database.Database,
  input: { workspaceRef: string; maxAccess: DotMaxAccess; timestamp: string }
): void {
  if (!verifiedTablePresent(db)) {
    if (input.maxAccess === DOT_DEFAULT_REQUEST_ACCESS) {
      return
    }
    db.exec(DOT_WORKSPACE_ACCESS_DEFINITION)
  }
  db.prepare(
    `INSERT INTO ${TABLE} (workspace_ref, max_access, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (workspace_ref) DO UPDATE SET max_access = excluded.max_access, updated_at = excluded.updated_at`
  ).run(input.workspaceRef, input.maxAccess, input.timestamp)
}
