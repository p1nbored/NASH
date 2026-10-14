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

export const AUTOPILOT_RUNTIME_SCHEMA_VERSION_CURRENT = 4

/** Every current object in creation order; the exact-SQL check compares each one. */
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
  return sql
    .replace(/CREATE TABLE "([a-z_]+)"/g, 'CREATE TABLE $1')
    .replace(/\s+/g, ' ')
    .trim()
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
  if (stored?.version === 2 || stored?.version === 3) {
    verifyDefinitions(db, legacyAutopilotDefinitions(stored.version))
    if (stored.version === 2) {
      replaceFamilyTable(db, 'permission_decisions')
    }
    replaceFamilyTable(db, 'workflow_runs')
    replaceFamilyTable(db, 'task_routes')
    db.prepare('UPDATE autopilot_runtime_schema SET version = ? WHERE id = 1').run(
      AUTOPILOT_RUNTIME_SCHEMA_VERSION_CURRENT
    )
    verifyDefinitions(db, AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS)
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw recoveryRequired('Autopilot migration could not preserve foreign key references.')
    }
    return
  }
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

/** Frozen predecessor CHECK lists; all other family definitions must still match exactly. */
export function legacyAutopilotDefinitions(version: 2 | 3): readonly AutopilotSchemaDefinition[] {
  return AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.map((definition) => {
    let sql = definition.sql
    if (definition.name === 'workflow_runs') {
      sql = sql.replace(
        /coordinator_agent IN \([^)]*\)/,
        "coordinator_agent IN ('claude', 'codex')"
      )
    }
    if (definition.name === 'task_routes') {
      sql = sql.replace(
        /target IN \([^)]*\)/,
        "target IN ('claude_primary', 'claude_subagent', 'claude_workflow', 'codex_cli', 'agy_cli')"
      )
    }
    if (version === 2 && definition.name === 'permission_decisions') {
      sql = sql.replaceAll(", 'primary'", '')
    }
    return { ...definition, sql }
  })
}

function replaceFamilyTable(db: Database.Database, name: string): void {
  const definition = AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.find((entry) => entry.name === name)!
  const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(name)?.seq
  const indexes = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND tbl_name = ? AND sql IS NOT NULL"
    )
    .all(name)
  db.exec(definition.sql.replace(`CREATE TABLE ${name}`, `CREATE TABLE ${name}_next`))
  db.exec(`INSERT INTO ${name}_next SELECT * FROM ${name}`)
  db.exec(`DROP TABLE ${name}`)
  db.exec(`ALTER TABLE ${name}_next RENAME TO ${name}`)
  if (typeof sequence === 'number') {
    db.prepare('UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = ?').run(sequence, name)
  } else {
    db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(name)
  }
  for (const index of indexes) {
    if (typeof index.sql === 'string') {
      db.exec(index.sql)
    }
  }
}

/**
 * Creates the current family or verifies an existing matching layout without migration. Adds new
 * objects only: no Orca object changes and user_version is never written. The Workbench family must
 * exist before task_classifications or clef_classification_spend is written (they reference it).
 */
export function ensureAutopilotRuntimeSchema(db: Database.Database): void {
  requireIdleAutopilotConnection(db)
  // SQLite's table-rebuild procedure requires FK enforcement off before BEGIN; check it before commit.
  const foreignKeys = db.pragma('foreign_keys', { simple: true })
  const present = presentTables(db)
  if (present.has(SCHEMA_TABLE)) {
    verifyDefinitions(db, SCHEMA_TABLE_DEFINITIONS)
  }
  const version = present.has(SCHEMA_TABLE)
    ? db.prepare('SELECT version FROM autopilot_runtime_schema WHERE id = 1').get()?.version
    : undefined
  const migrating = version === 2 || version === 3
  if (migrating) {
    db.pragma('foreign_keys = OFF')
  }
  try {
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
  } finally {
    if (migrating) {
      db.pragma(`foreign_keys = ${foreignKeys === 1 ? 'ON' : 'OFF'}`)
    }
  }
}
