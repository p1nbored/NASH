import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'
import { requireIdleWorkbenchConnection } from './workbench-connection-guard'
import {
  WORKBENCH_SCHEMA_DEFINITIONS,
  WORKBENCH_SCHEMA_VERSION_CURRENT,
  type WorkbenchSchemaDefinition
} from './workbench-request-schema-definition'

const SCHEMA_TABLE = 'workbench_request_schema'

function tablesOf(definitions: readonly WorkbenchSchemaDefinition[]): string[] {
  return definitions
    .filter((definition) => definition.sql.startsWith('CREATE TABLE'))
    .map((definition) => definition.name)
}

const CURRENT_TABLES = tablesOf(WORKBENCH_SCHEMA_DEFINITIONS)
// Why: the version table is checked before its version is read, so a drifted table is never trusted.
const SCHEMA_TABLE_DEFINITIONS = WORKBENCH_SCHEMA_DEFINITIONS.filter(
  (definition) => definition.name === SCHEMA_TABLE
)

function incomplete(): OrchestrationError {
  return new OrchestrationError('workbench_recovery_required', 'Workbench schema is incomplete.')
}

// Why: pre-release v1 and unknown layouts are refused, as Orca refuses unreleased dev layouts.
function unsupportedVersion(): OrchestrationError {
  return new OrchestrationError(
    'workbench_recovery_required',
    'Workbench schema version is unsupported.'
  )
}

function schemaSignature(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** Exact-SQL check: whitespace-insensitive, otherwise byte-for-byte. */
function verifyWorkbenchDefinitions(
  db: Database.Database,
  definitions: readonly WorkbenchSchemaDefinition[]
): void {
  for (const definition of definitions) {
    const stored = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(definition.name)
    if (
      typeof stored?.sql !== 'string' ||
      schemaSignature(stored.sql) !== schemaSignature(definition.sql)
    ) {
      throw new OrchestrationError(
        'workbench_recovery_required',
        'Workbench schema layout is unsupported. No migration was applied.'
      )
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

function requireExactLayout(
  db: Database.Database,
  present: ReadonlySet<string>,
  definitions: readonly WorkbenchSchemaDefinition[]
): void {
  const expected = tablesOf(definitions)
  if (present.size !== expected.length || !expected.every((name) => present.has(name))) {
    throw incomplete()
  }
  verifyWorkbenchDefinitions(db, definitions)
}

function readVersion(db: Database.Database, present: ReadonlySet<string>): unknown {
  if (!present.has(SCHEMA_TABLE)) {
    throw incomplete()
  }
  verifyWorkbenchDefinitions(db, SCHEMA_TABLE_DEFINITIONS)
  return db.prepare(`SELECT version FROM ${SCHEMA_TABLE} WHERE id = 1`).get()?.version
}

/**
 * Creates or verifies the current Workbench layout.
 */
export function ensureWorkbenchRequestSchema(db: Database.Database): void {
  requireIdleWorkbenchConnection(db)
  runLifecycleWriteTransaction(db, 'workbench_schema', () => {
    const present = presentTables(db)
    if (present.size === 0) {
      for (const definition of WORKBENCH_SCHEMA_DEFINITIONS) {
        db.exec(definition.sql)
      }
      db.prepare(`INSERT INTO ${SCHEMA_TABLE} VALUES (1, ?)`).run(WORKBENCH_SCHEMA_VERSION_CURRENT)
      return
    }
    const version = readVersion(db, present)
    if (version !== WORKBENCH_SCHEMA_VERSION_CURRENT) {
      throw unsupportedVersion()
    }
    requireExactLayout(db, present, WORKBENCH_SCHEMA_DEFINITIONS)
  })
}
