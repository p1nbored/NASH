import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import {
  AUTOPILOT_RUN_SCHEMA_DEFINITIONS,
  type AutopilotSchemaDefinition
} from './autopilot-run-schema-definition'
import { AUTOPILOT_TASK_SCHEMA_DEFINITIONS } from './autopilot-task-schema-definition'
import { AUTOPILOT_MESSAGE_SCHEMA_DEFINITIONS } from './autopilot-message-schema-definition'
import { requireIdleAutopilotConnection } from './autopilot-store-input'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'

export const AUTOPILOT_RUNTIME_SCHEMA_VERSION_CURRENT = 1

/** Every v1 object in creation order; the exact-SQL check compares each one. */
export const AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS: readonly AutopilotSchemaDefinition[] = [
  ...AUTOPILOT_RUN_SCHEMA_DEFINITIONS,
  ...AUTOPILOT_TASK_SCHEMA_DEFINITIONS,
  ...AUTOPILOT_MESSAGE_SCHEMA_DEFINITIONS
]

const SCHEMA_TABLE = 'autopilot_runtime_schema'
const CURRENT_TABLES = AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.filter((definition) =>
  definition.sql.startsWith('CREATE TABLE')
).map((definition) => definition.name)
// Why: the version table is checked before its version is read, so a drifted table is never trusted.
const SCHEMA_TABLE_DEFINITIONS = AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.filter(
  (definition) => definition.name === SCHEMA_TABLE
)

function recoveryRequired(message: string): OrchestrationError {
  return new OrchestrationError('autopilot_recovery_required', message)
}

function schemaSignature(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** Exact-SQL check: whitespace-insensitive, otherwise byte-for-byte. */
function verifyDefinitions(
  db: Database.Database,
  definitions: readonly AutopilotSchemaDefinition[]
): void {
  for (const definition of definitions) {
    const stored = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(definition.name)
    if (
      typeof stored?.sql !== 'string' ||
      schemaSignature(stored.sql) !== schemaSignature(definition.sql)
    ) {
      throw recoveryRequired('Autopilot schema layout is unsupported. No migration was applied.')
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
    throw recoveryRequired('Autopilot schema is incomplete.')
  }
  verifyDefinitions(db, SCHEMA_TABLE_DEFINITIONS)
  const stored = db.prepare('SELECT version FROM autopilot_runtime_schema WHERE id = 1').get()
  if (stored?.version !== AUTOPILOT_RUNTIME_SCHEMA_VERSION_CURRENT) {
    throw recoveryRequired('Autopilot schema version is unsupported. Nothing was written.')
  }
  if (
    present.size !== CURRENT_TABLES.length ||
    !CURRENT_TABLES.every((name) => present.has(name))
  ) {
    throw recoveryRequired('Autopilot schema is incomplete.')
  }
  verifyDefinitions(db, AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS)
}

/**
 * Creates the v1 family, or verifies an existing one and fails closed without changes. Adds new
 * objects only: no Orca object changes and user_version is never written. The Workbench family must
 * exist before task_classifications or clef_classification_spend is written (they reference it).
 */
export function ensureAutopilotRuntimeSchema(db: Database.Database): void {
  requireIdleAutopilotConnection(db)
  runLifecycleWriteTransaction(db, 'autopilot_schema', () => {
    const present = presentTables(db)
    if (present.size > 0) {
      verifyExisting(db, present)
      return
    }
    for (const definition of AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS) {
      db.exec(definition.sql)
    }
    db.prepare('INSERT INTO autopilot_runtime_schema VALUES (1, ?)').run(
      AUTOPILOT_RUNTIME_SCHEMA_VERSION_CURRENT
    )
  })
}
