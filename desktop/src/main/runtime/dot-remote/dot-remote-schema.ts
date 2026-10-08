import type Database from '../../sqlite/sync-database'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  DOT_REMOTE_SCHEMA_DEFINITIONS,
  type DotRemoteSchemaDefinition
} from './dot-remote-schema-definition'

/** The current remote event and item schema. */
export const DOT_REMOTE_SCHEMA_VERSION = 2

export const DOT_REMOTE_RECOVERY_REQUIRED = 'dot_remote_recovery_required'

const SCHEMA_TABLE = 'dot_remote_schema'
const FAMILY_NAMES: readonly string[] = DOT_REMOTE_SCHEMA_DEFINITIONS.map((entry) => entry.name)
// Why: the version table is checked before its version is read, so a drifted table is never trusted.
const SCHEMA_TABLE_DEFINITIONS = DOT_REMOTE_SCHEMA_DEFINITIONS.filter(
  (definition) => definition.name === SCHEMA_TABLE
)

function recoveryRequired(): OrchestrationError {
  return new OrchestrationError(
    DOT_REMOTE_RECOVERY_REQUIRED,
    'The remote access tables do not match this version of the app. Nothing was changed.'
  )
}

/** The remote family runs its own transactions; a caller inside one would nest them. */
export function requireIdleDotRemoteConnection(db: Database.Database): void {
  if (db.isTransaction) {
    throw new OrchestrationError(
      'dot_remote_transaction_unavailable',
      'Remote access requires an idle database connection.'
    )
  }
}

export function runDotRemoteWrite<T>(
  db: Database.Database,
  savepoint: string,
  operation: () => T
): T {
  requireIdleDotRemoteConnection(db)
  return runLifecycleWriteTransaction(db, savepoint, operation)
}

function signature(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function verifyDefinitions(
  db: Database.Database,
  definitions: readonly DotRemoteSchemaDefinition[]
): void {
  for (const definition of definitions) {
    const stored = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(definition.name)
    if (typeof stored?.sql !== 'string' || signature(stored.sql) !== signature(definition.sql)) {
      throw recoveryRequired()
    }
  }
}

function presentObjects(db: Database.Database): Set<string> {
  const placeholders = FAMILY_NAMES.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`)
    .all(...FAMILY_NAMES)
  return new Set(rows.map((row) => String(row.name)))
}

function verifyExisting(db: Database.Database, present: ReadonlySet<string>): void {
  if (!present.has(SCHEMA_TABLE)) {
    throw recoveryRequired()
  }
  verifyDefinitions(db, SCHEMA_TABLE_DEFINITIONS)
  const stored = db.prepare('SELECT version FROM dot_remote_schema WHERE id = 1').get()
  if (stored?.version !== DOT_REMOTE_SCHEMA_VERSION || present.size !== FAMILY_NAMES.length) {
    throw recoveryRequired()
  }
  verifyDefinitions(db, DOT_REMOTE_SCHEMA_DEFINITIONS)
}

/**
 * Creates every object at the current version or verifies an existing family and fails closed without changes. user_version is never written.
 */
export function ensureDotRemoteSchema(db: Database.Database): void {
  runDotRemoteWrite(db, 'dot_remote_schema', () => {
    const present = presentObjects(db)
    if (present.size > 0) {
      verifyExisting(db, present)
      return
    }
    for (const definition of DOT_REMOTE_SCHEMA_DEFINITIONS) {
      db.exec(definition.sql)
    }
    db.prepare('INSERT INTO dot_remote_schema VALUES (1, ?)').run(DOT_REMOTE_SCHEMA_VERSION)
  })
}
