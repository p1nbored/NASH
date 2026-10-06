import Database from '../../../sqlite/sync-database'

// FIXTURE_ONLY: the pre-release v1 layout, kept only to prove it is refused and never migrated.
export const FIXTURE_V1_SCHEMA_SQL = [
  'CREATE TABLE workbench_request_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
  `CREATE TABLE workbench_requests (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE NOT NULL,
      workspace_id TEXT NOT NULL,
      workspace_binding TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ROUTING_BLOCKED', 'CANCELED')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (principal_id, idempotency_key)
    )`,
  'CREATE INDEX workbench_request_scope ON workbench_requests (workspace_id, workspace_binding, principal_id, sequence DESC)',
  `CREATE TABLE workbench_request_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL REFERENCES workbench_requests(request_id),
      kind TEXT NOT NULL CHECK (kind IN ('accepted', 'routing_blocked', 'canceled')),
      revision INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      input_hash TEXT NOT NULL
    )`,
  'CREATE INDEX workbench_request_event_scope ON workbench_request_events (request_id, sequence)',
  `CREATE TABLE workbench_request_outbox (
      request_id TEXT PRIMARY KEY REFERENCES workbench_requests(request_id),
      state TEXT NOT NULL CHECK (state IN ('pending', 'withdrawn')),
      revision INTEGER NOT NULL,
      input_hash TEXT NOT NULL
    )`
] as const

const FIXTURE_TIME = '2026-10-03T12:00:00.000Z'

/** A v1 database holding one blocked and one canceled request, as the v1 intake store wrote them. */
export function createFixtureV1Database(): Database.Database {
  const db = new Database(':memory:')
  for (const sql of FIXTURE_V1_SCHEMA_SQL) {
    db.exec(sql)
  }
  db.exec('INSERT INTO workbench_request_schema VALUES (1, 1)')
  const insertRequest = db.prepare(`INSERT INTO workbench_requests
    (request_id, workspace_id, workspace_binding, principal_id, idempotency_key, input_hash, objective, status, revision, created_at, updated_at)
    VALUES (?, 'folder:fixture-v1', 'fixture-binding', 'fixture-ui', ?, 'fixture-hash', 'Fixture objective.', ?, ?, ?, ?)`)
  const insertEvent = db.prepare(
    "INSERT INTO workbench_request_events (request_id, kind, revision, recorded_at, input_hash) VALUES (?, ?, ?, ?, 'fixture-hash')"
  )
  const insertOutbox = db.prepare(
    "INSERT INTO workbench_request_outbox VALUES (?, ?, ?, 'fixture-hash')"
  )
  insertRequest.run(
    'fixture-v1-blocked',
    'fixture-key-1',
    'ROUTING_BLOCKED',
    1,
    FIXTURE_TIME,
    FIXTURE_TIME
  )
  insertEvent.run('fixture-v1-blocked', 'accepted', 1, FIXTURE_TIME)
  insertEvent.run('fixture-v1-blocked', 'routing_blocked', 1, FIXTURE_TIME)
  insertOutbox.run('fixture-v1-blocked', 'pending', 1)
  insertRequest.run(
    'fixture-v1-canceled',
    'fixture-key-2',
    'CANCELED',
    2,
    FIXTURE_TIME,
    FIXTURE_TIME
  )
  insertEvent.run('fixture-v1-canceled', 'accepted', 1, FIXTURE_TIME)
  insertEvent.run('fixture-v1-canceled', 'canceled', 2, FIXTURE_TIME)
  insertOutbox.run('fixture-v1-canceled', 'withdrawn', 2)
  // Why: a high-water mark above the stored rows proves a refused database keeps its sequences.
  db.exec("UPDATE sqlite_sequence SET seq = 40 WHERE name = 'workbench_requests'")
  return db
}
