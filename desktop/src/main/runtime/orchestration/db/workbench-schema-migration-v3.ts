import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { WORKBENCH_DEFAULT_REQUEST_ACCESS } from '../../../../shared/workbench-request'
import {
  WORKBENCH_REQUEST_SCHEMA_DEFINITIONS,
  WORKBENCH_SCHEMA_VERSION_CURRENT
} from './workbench-request-schema-definition'

const SCHEMA_TABLE = 'workbench_request_schema'
/** Dropped children first; their indexes go with them. */
const V2_ONLY_TABLES = [
  'workbench_route_overrides',
  'workbench_dispatch_intents',
  'workbench_route_decisions',
  'workbench_request_outbox'
] as const
const REBUILT_TABLES = ['workbench_request_events', 'workbench_requests'] as const
const SEQUENCED_TABLES = ['workbench_requests', 'workbench_request_events'] as const
/** Every table whose foreign key points at a rebuilt table, checked before the migration commits. */
const REFERENCING_TABLES = [
  'workbench_request_events',
  'workbench_request_settings',
  'workbench_clef_spend',
  'workbench_clef_raw_responses'
] as const
const REQUESTS_COPY = 'temp.workbench_v2_requests_copy'
const EVENTS_COPY = 'temp.workbench_v2_events_copy'

function countOf(db: Database.Database, sql: string): number {
  return Number(db.prepare(sql).get()?.n)
}

/** U2: decisions, intents, overrides and routed requests have no v3 form, so they block the migration. */
function refuseUnmigratableRows(db: Database.Database): void {
  const held = countOf(
    db,
    `SELECT (SELECT count(*) FROM workbench_route_decisions)
      + (SELECT count(*) FROM workbench_dispatch_intents)
      + (SELECT count(*) FROM workbench_route_overrides)
      + (SELECT count(*) FROM workbench_requests WHERE status NOT IN ('ROUTING_BLOCKED', 'ROUTING', 'CANCELED')) AS n`
  )
  if (held > 0) {
    throw new OrchestrationError(
      'workbench_recovery_required',
      'Workbench v2 data holds route decisions, dispatch intents, overrides or routed requests, which are not migrated to v3. Nothing was changed.'
    )
  }
}

function readHighWaterMarks(db: Database.Database): ReadonlyMap<string, number> {
  const rows = db
    .prepare(`SELECT name, seq FROM sqlite_sequence WHERE name IN (?, ?)`)
    .all(...SEQUENCED_TABLES)
  return new Map(rows.map((row) => [String(row.name), Number(row.seq)]))
}

// Why: dropping a table forgets its AUTOINCREMENT mark, and list cursors must never reuse a sequence.
function restoreHighWaterMarks(db: Database.Database, marks: ReadonlyMap<string, number>): void {
  for (const [name, seq] of marks) {
    const updated = db
      .prepare('UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = ?')
      .run(seq, name)
    if (Number(updated.changes) === 0) {
      db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(name, seq)
    }
  }
}

function rebuildRequestFamily(db: Database.Database): void {
  db.exec(`CREATE TEMP TABLE workbench_v2_requests_copy AS SELECT * FROM main.workbench_requests`)
  db.exec(
    `CREATE TEMP TABLE workbench_v2_events_copy AS SELECT * FROM main.workbench_request_events`
  )
  for (const table of [...V2_ONLY_TABLES, ...REBUILT_TABLES]) {
    db.exec(`DROP TABLE main.${table}`)
  }
  for (const definition of WORKBENCH_REQUEST_SCHEMA_DEFINITIONS) {
    if (definition.name !== SCHEMA_TABLE) {
      db.exec(definition.sql)
    }
  }
}

/** ROUTING_BLOCKED and ROUTING become an unlaunched RECEIVED at the next revision; CANCELED stays. */
function refillRequestFamily(db: Database.Database, timestamp: string): void {
  db.prepare(`INSERT INTO main.workbench_requests (sequence, request_id, workspace_id,
    workspace_binding, principal_id, idempotency_key, input_hash, objective, status, revision,
    created_at, updated_at)
    SELECT sequence, request_id, workspace_id, workspace_binding, principal_id, idempotency_key,
      input_hash, objective,
      CASE status WHEN 'CANCELED' THEN 'CANCELED' ELSE 'RECEIVED' END,
      CASE status WHEN 'CANCELED' THEN revision ELSE revision + 1 END,
      created_at,
      CASE status WHEN 'CANCELED' THEN updated_at ELSE ? END
    FROM ${REQUESTS_COPY} ORDER BY sequence`).run(timestamp)
  db.exec(`INSERT INTO main.workbench_request_events (sequence, request_id, kind, revision,
    recorded_at, input_hash)
    SELECT sequence, request_id, kind, revision, recorded_at, input_hash FROM ${EVENTS_COPY}
    ORDER BY sequence`)
}

function recordRequeuedRequests(db: Database.Database, timestamp: string): void {
  db.prepare(`INSERT INTO main.workbench_request_events (request_id, kind, revision, recorded_at,
    input_hash)
    SELECT r.request_id, 'migrated', r.revision, ?, r.input_hash FROM main.workbench_requests r
    JOIN ${REQUESTS_COPY} c ON c.request_id = r.request_id
    WHERE c.status <> 'CANCELED' ORDER BY r.sequence`).run(timestamp)
  db.prepare(`INSERT INTO main.workbench_request_settings (request_id, requested_access,
    deliverable_language) SELECT request_id, ?, NULL FROM main.workbench_requests ORDER BY sequence`).run(
    WORKBENCH_DEFAULT_REQUEST_ACCESS
  )
}

function requireNoDanglingReferences(db: Database.Database): void {
  for (const table of REFERENCING_TABLES) {
    if (db.prepare(`PRAGMA main.foreign_key_check(${table})`).all().length > 0) {
      throw new OrchestrationError(
        'workbench_recovery_required',
        'A Workbench row references a missing request or reservation. The v3 migration was rolled back.'
      )
    }
  }
}

/**
 * v2 to v3 (D-016 section 1.2, U2). Runs inside the schema transaction after the exact v2 layout
 * was verified; any failure rolls every step back. Spend and raw-response rows are never touched.
 */
export function migrateWorkbenchSchemaV2ToV3(db: Database.Database, timestamp: string): void {
  refuseUnmigratableRows(db)
  const marks = readHighWaterMarks(db)
  // Why deferred: the parent table is rebuilt under its own name while child rows still point at it.
  db.exec('PRAGMA defer_foreign_keys = ON')
  rebuildRequestFamily(db)
  refillRequestFamily(db, timestamp)
  restoreHighWaterMarks(db, marks)
  recordRequeuedRequests(db, timestamp)
  db.exec(`DROP TABLE ${REQUESTS_COPY}`)
  db.exec(`DROP TABLE ${EVENTS_COPY}`)
  db.prepare(`UPDATE ${SCHEMA_TABLE} SET version = ? WHERE id = 1`).run(
    WORKBENCH_SCHEMA_VERSION_CURRENT
  )
  requireNoDanglingReferences(db)
}
