import type Database from '../../sqlite/sync-database'
import { DOT_REMOTE_SCHEMA_DEFINITIONS } from './dot-remote-schema-definition'

// v1 to v2 (G7). SQLite cannot change a CHECK in place, so the outbox and the item journal are
// rebuilt under their own names with every row; the outbox keeps its AUTOINCREMENT high-water mark,
// so no event sequence is ever reused. Runs inside the caller's write transaction.

const REBUILT_TABLES = ['dot_remote_outbox', 'dot_remote_items'] as const
const OUTBOX_INDEX = 'dot_remote_outbox_state'

function sqlOf(name: string): string {
  const definition = DOT_REMOTE_SCHEMA_DEFINITIONS.find((entry) => entry.name === name)
  if (!definition) {
    throw new Error(`No dot remote definition named ${name}.`)
  }
  return definition.sql
}

/** The caller has verified the exact v1 layout; renaming moves the outbox index with its table. */
export function migrateDotRemoteSchemaV1(db: Database.Database, version: number): void {
  for (const table of REBUILT_TABLES) {
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_v1`)
    db.exec(sqlOf(table))
    db.exec(`INSERT INTO ${table} SELECT * FROM ${table}_v1`)
  }
  db.prepare("DELETE FROM sqlite_sequence WHERE name = 'dot_remote_outbox'").run()
  db.prepare(
    "INSERT INTO sqlite_sequence (name, seq) SELECT 'dot_remote_outbox', seq FROM sqlite_sequence WHERE name = 'dot_remote_outbox_v1'"
  ).run()
  for (const table of REBUILT_TABLES) {
    db.exec(`DROP TABLE ${table}_v1`)
  }
  db.exec(sqlOf(OUTBOX_INDEX))
  db.prepare('UPDATE dot_remote_schema SET version = ? WHERE id = 1').run(version)
}
