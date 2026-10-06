import { createHash } from 'node:crypto'
import Database from '../../../sqlite/sync-database'
import type { WorkbenchLocalWorkspace } from '../../workbench-local-workspace'
import { workbenchWorkspaceBinding } from './workbench-request-scope'
import { WORKBENCH_V2_SCHEMA_DEFINITIONS } from './workbench-schema-v2-definitions'

// FIXTURE_ONLY: a pre-D-016 v2 database as the v2 intake and route stores wrote it; no real data.
export const FIXTURE_V2_WORKSPACE: WorkbenchLocalWorkspace = {
  workspaceId: 'folder:fixture-v2',
  projectId: 'fixture-group',
  projectKind: 'folder-group',
  hostId: 'local',
  path: '/fixture/v2'
}
export const FIXTURE_V2_PRINCIPAL = 'fixture-ui'
export const FIXTURE_V2_TIME = '2026-10-04T09:00:00.000Z'
export const FIXTURE_V2_REQUEST_HIGH_WATER = 40
export const FIXTURE_V2_EVENT_HIGH_WATER = 90

export const FIXTURE_V2_REQUESTS = [
  {
    requestId: 'fixture-v2-blocked',
    key: '0b6f6e1e-1d0b-4a8c-9a59-7f1d7f2c1a01',
    objective: 'Fixture blocked objective.',
    status: 'ROUTING_BLOCKED',
    revision: 1,
    outbox: 'pending',
    events: [
      ['accepted', 1],
      ['routing_blocked', 1]
    ]
  },
  {
    requestId: 'fixture-v2-routing',
    key: '0b6f6e1e-1d0b-4a8c-9a59-7f1d7f2c1a02',
    objective: 'Fixture routing objective.\r\n',
    status: 'ROUTING',
    revision: 2,
    outbox: 'claimed',
    events: [
      ['accepted', 1],
      ['routing_blocked', 1],
      ['routing_started', 2]
    ]
  },
  {
    requestId: 'fixture-v2-canceled',
    key: '0b6f6e1e-1d0b-4a8c-9a59-7f1d7f2c1a03',
    objective: 'Fixture canceled objective.',
    status: 'CANCELED',
    revision: 2,
    outbox: 'withdrawn',
    events: [
      ['accepted', 1],
      ['routing_blocked', 1],
      ['canceled', 2]
    ]
  }
] as const

const sha256 = (bytes: string | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

/** The hash the v2 store computed, so a migrated key must still replay. */
export function fixtureV2InputHash(objective: string): string {
  const binding = workbenchWorkspaceBinding(FIXTURE_V2_WORKSPACE.workspaceId, FIXTURE_V2_WORKSPACE)
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: FIXTURE_V2_WORKSPACE.workspaceId,
      workspaceBinding: binding,
      objective
    })
  )
}

function seedRequests(db: Database.Database): void {
  const binding = workbenchWorkspaceBinding(FIXTURE_V2_WORKSPACE.workspaceId, FIXTURE_V2_WORKSPACE)
  for (const request of FIXTURE_V2_REQUESTS) {
    const hash = fixtureV2InputHash(request.objective)
    const blocked = request.status === 'ROUTING_BLOCKED'
    db.prepare(`INSERT INTO workbench_requests (request_id, workspace_id, workspace_binding,
      principal_id, idempotency_key, input_hash, objective, status, revision, created_at, updated_at,
      blocker_reason, blocker_detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      request.requestId,
      FIXTURE_V2_WORKSPACE.workspaceId,
      binding,
      FIXTURE_V2_PRINCIPAL,
      request.key,
      hash,
      request.objective,
      request.status,
      request.revision,
      FIXTURE_V2_TIME,
      FIXTURE_V2_TIME,
      blocked ? 'classifier_unavailable' : null,
      blocked ? 'not_configured' : null
    )
    for (const [kind, revision] of request.events) {
      db.prepare(
        'INSERT INTO workbench_request_events (request_id, kind, revision, recorded_at, input_hash) VALUES (?, ?, ?, ?, ?)'
      ).run(request.requestId, kind, revision, FIXTURE_V2_TIME, hash)
    }
    db.prepare('INSERT INTO workbench_request_outbox VALUES (?, ?, ?, ?)').run(
      request.requestId,
      request.outbox,
      request.revision,
      hash
    )
  }
}

function seedSpendAndRawResponses(db: Database.Database): void {
  db.prepare(`INSERT INTO workbench_clef_spend (reservation_id, request_id, purpose, attempt,
    price_basis_version, estimated_input_tokens, reserved_micro_usd, reserved_neurons, state, utc_day,
    reserved_at) VALUES ('spend_fixture_v2_1', 'fixture-v2-routing', 'production', 1, 1, 1000, 1360,
    124, 'reserved', '2026-10-04', ?)`).run(FIXTURE_V2_TIME)
  db.prepare(`INSERT INTO workbench_clef_spend (reservation_id, request_id, purpose, attempt,
    price_basis_version, estimated_input_tokens, reserved_micro_usd, reserved_neurons, state,
    input_tokens, output_tokens, output_cost, spent_micro_usd, spent_neurons, utc_day, reserved_at,
    closed_at) VALUES ('spend_fixture_v2_verify', NULL, 'verification', NULL, 1, 800, 1204, 100,
    'settled', 700, 40, 'cost_unknown', 1100, 90, '2026-10-04', ?, ?)`).run(
    FIXTURE_V2_TIME,
    FIXTURE_V2_TIME
  )
  const requestBody = new TextEncoder().encode('{"model":"fixture"}')
  const responseBody = new TextEncoder().encode('{"success":true}')
  db.prepare(`INSERT INTO workbench_clef_raw_responses (raw_response_id, request_id,
    spend_reservation_id, http_status, request_body, request_body_sha256, response_body,
    response_body_sha256, received_at) VALUES ('raw_fixture_v2_1', 'fixture-v2-routing',
    'spend_fixture_v2_1', 200, ?, ?, ?, ?, ?)`).run(
    requestBody,
    sha256(requestBody),
    responseBody,
    sha256(responseBody),
    FIXTURE_V2_TIME
  )
}

/** Writes the exact v2 layout and its rows into `db`, next to whatever it already holds. */
export function seedFixtureV2Workbench(db: Database.Database): void {
  for (const definition of WORKBENCH_V2_SCHEMA_DEFINITIONS) {
    db.exec(definition.sql)
  }
  db.exec('INSERT INTO workbench_request_schema VALUES (1, 2)')
  seedRequests(db)
  seedSpendAndRawResponses(db)
  // Why: high-water marks above the stored rows prove the migration keeps both sequences.
  db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'workbench_requests'").run(
    FIXTURE_V2_REQUEST_HIGH_WATER
  )
  db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'workbench_request_events'").run(
    FIXTURE_V2_EVENT_HIGH_WATER
  )
}

export function createFixtureV2Database(): Database.Database {
  const db = new Database(':memory:')
  seedFixtureV2Workbench(db)
  return db
}

/** Runs a raw write with foreign keys off, as an older build or a manual edit could have left it. */
function withoutForeignKeys(db: Database.Database, sql: string): void {
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.exec(sql)
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

/** Rows v3 does not migrate (U2): each one must make the migration fail closed. */
export const FIXTURE_V2_UNMIGRATABLE_ROWS = {
  decision: (db: Database.Database) =>
    db.exec(`INSERT INTO workbench_route_decisions (decision_id, request_id, request_revision,
      decision_source, outcome, record, created_at) VALUES ('rd_fixture_v2', 'fixture-v2-blocked', 1,
      'local_gate', 'blocked', '{}', '${FIXTURE_V2_TIME}')`),
  intent: (db: Database.Database) =>
    withoutForeignKeys(
      db,
      `INSERT INTO workbench_dispatch_intents (intent_id, request_id, decision_id, generation,
      input_hash, scope_hash, state, created_at) VALUES ('intent_fixture_v2', 'fixture-v2-blocked',
      'rd_fixture_missing', 1, 'fixture-input', 'fixture-scope', 'issued', '${FIXTURE_V2_TIME}')`
    ),
  override: (db: Database.Database) =>
    db.exec(`INSERT INTO workbench_route_overrides (override_id, request_id, tuple_id, principal_id,
      attestation, reason_code, created_at) VALUES ('override_fixture_v2', 'fixture-v2-blocked',
      'codex_assistant:codex_exec', 'fixture-ui', 'fixture-attestation', 'fixture_reason',
      '${FIXTURE_V2_TIME}')`),
  routed: (db: Database.Database) =>
    withoutForeignKeys(
      db,
      `UPDATE workbench_requests SET status = 'ROUTED', model_profile_id = 'codex_assistant',
      execution_surface = 'codex_exec', clef_decision_id = 'rd_fixture_missing'
      WHERE request_id = 'fixture-v2-routing'`
    )
} as const

/** A spend row whose request does not exist; only a write with foreign keys off can leave one. */
export function insertFixtureV2DanglingSpend(db: Database.Database): void {
  withoutForeignKeys(
    db,
    `INSERT INTO workbench_clef_spend (reservation_id, request_id, purpose, attempt,
    price_basis_version, estimated_input_tokens, reserved_micro_usd, reserved_neurons, state, utc_day,
    reserved_at) VALUES ('spend_fixture_v2_dangling', 'fixture-v2-missing', 'production', 1, 1, 10,
    20, 2, 'reserved', '2026-10-04', '${FIXTURE_V2_TIME}')`
  )
}
