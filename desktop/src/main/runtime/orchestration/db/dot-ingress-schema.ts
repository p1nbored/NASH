import type Database from '../../../sqlite/sync-database'
import {
  DOT_INGRESS_SCHEMA_DEFINITIONS,
  type DotIngressSchemaDefinition
} from './dot-ingress-schema-definition'
import { dotIngressError, requireIdleDotConnection } from './dot-ingress-store-input'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'

export const DOT_INGRESS_SCHEMA_VERSION_CURRENT = 1

const SCHEMA_TABLE = 'dot_ingress_schema'
const CURRENT_TABLES = DOT_INGRESS_SCHEMA_DEFINITIONS.filter((definition) =>
  definition.sql.startsWith('CREATE TABLE')
).map((definition) => definition.name)
// Why: the version table is checked before its version is read, so a drifted table is never trusted.
const SCHEMA_TABLE_DEFINITIONS = DOT_INGRESS_SCHEMA_DEFINITIONS.filter(
  (definition) => definition.name === SCHEMA_TABLE
)

function schemaSignature(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** Exact-SQL check: whitespace-insensitive, otherwise byte-for-byte. */
function verifyDefinitions(
  db: Database.Database,
  definitions: readonly DotIngressSchemaDefinition[]
): void {
  for (const definition of definitions) {
    const stored = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(definition.name)
    if (
      typeof stored?.sql !== 'string' ||
      schemaSignature(stored.sql) !== schemaSignature(definition.sql)
    ) {
      throw dotIngressError('dot_recovery_required')
    }
  }
}

function presentTables(db: Database.Database): Set<string> {
  const placeholders = CURRENT_TABLES.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
    .all(...CURRENT_TABLES)
  return new Set(rows.map((row) => String(row.name)))
}

function verifyExisting(db: Database.Database, present: ReadonlySet<string>): void {
  if (!present.has(SCHEMA_TABLE)) {
    throw dotIngressError('dot_recovery_required')
  }
  verifyDefinitions(db, SCHEMA_TABLE_DEFINITIONS)
  const stored = db.prepare('SELECT version FROM dot_ingress_schema WHERE id = 1').get()
  if (stored?.version !== DOT_INGRESS_SCHEMA_VERSION_CURRENT) {
    throw dotIngressError('dot_recovery_required')
  }
  if (
    present.size !== CURRENT_TABLES.length ||
    !CURRENT_TABLES.every((name) => present.has(name))
  ) {
    throw dotIngressError('dot_recovery_required')
  }
  verifyDefinitions(db, DOT_INGRESS_SCHEMA_DEFINITIONS)
}

/**
 * Creates the current family, or verifies an existing one and fails closed without changes. Adds new
 * objects only: no Orca object changes and user_version is never written.
 */
export function ensureDotIngressSchema(db: Database.Database): void {
  requireIdleDotConnection(db)
  runLifecycleWriteTransaction(db, 'dot_ingress_schema', () => {
    const present = presentTables(db)
    if (present.size > 0) {
      verifyExisting(db, present)
      return
    }
    for (const definition of DOT_INGRESS_SCHEMA_DEFINITIONS) {
      db.exec(definition.sql)
    }
    db.prepare('INSERT INTO dot_ingress_schema VALUES (1, ?)').run(
      DOT_INGRESS_SCHEMA_VERSION_CURRENT
    )
  })
}
