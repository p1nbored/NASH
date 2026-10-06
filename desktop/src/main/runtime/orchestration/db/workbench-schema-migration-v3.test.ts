import { afterEach, describe, expect, it } from 'vitest'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationDb } from './orchestration-db'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import {
  WORKBENCH_SCHEMA_DEFINITIONS,
  WORKBENCH_SCHEMA_VERSION_CURRENT
} from './workbench-request-schema-definition'
import { WorkbenchRequestStore } from './workbench-request-store'
import {
  FIXTURE_V2_EVENT_HIGH_WATER,
  FIXTURE_V2_PRINCIPAL,
  FIXTURE_V2_REQUEST_HIGH_WATER,
  FIXTURE_V2_REQUESTS,
  FIXTURE_V2_TIME,
  FIXTURE_V2_UNMIGRATABLE_ROWS,
  FIXTURE_V2_WORKSPACE,
  createFixtureV2Database,
  fixtureV2InputHash,
  insertFixtureV2DanglingSpend,
  seedFixtureV2Workbench
} from './workbench-request-schema-v2.test-fixture'

const NOW = new Date('2026-10-05T08:00:00.000Z')
const KEPT = [
  'workbench_clef_spend',
  'workbench_clef_spend_day',
  'workbench_clef_raw_responses',
  'workbench_clef_raw_response_scope'
]
const RETIRED = [
  'workbench_request_outbox',
  'workbench_route_decisions',
  'workbench_route_decision_scope',
  'workbench_dispatch_intents',
  'workbench_route_overrides',
  'workbench_route_override_scope'
]

const migrate = (db: Database.Database) => ensureWorkbenchRequestSchema(db, () => NOW)
const rows = (db: Database.Database, sql: string, ...params: string[]) =>
  db.prepare(sql).all(...params)
const schemaSql = (db: Database.Database, names: readonly string[]) =>
  rows(
    db,
    `SELECT name, sql FROM sqlite_master WHERE name IN (${names.map(() => '?').join(', ')}) ORDER BY name`,
    ...names
  )
const workbenchNames = (db: Database.Database) =>
  rows(db, "SELECT name FROM sqlite_master WHERE name LIKE 'workbench_%' ORDER BY name").map(
    (row) => String(row.name)
  )
const version = (db: Database.Database) =>
  db.prepare('SELECT version FROM workbench_request_schema').get()?.version
const sequences = (db: Database.Database) =>
  Object.fromEntries(
    rows(db, "SELECT name, seq FROM sqlite_sequence WHERE name LIKE 'workbench_%'").map((row) => [
      String(row.name),
      Number(row.seq)
    ])
  )
/** Every workbench object and row, so a refused migration can be shown to change nothing. */
function snapshot(db: Database.Database) {
  const tables = rows(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'workbench_%' ORDER BY name"
  ).map((row) => String(row.name))
  return {
    schema: rows(
      db,
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"
    ),
    rows: tables.map((table) => rows(db, `SELECT * FROM ${table} ORDER BY rowid`)),
    sequences: sequences(db)
  }
}

describe('Workbench v2 to v3 migration', () => {
  let db: Database.Database | undefined
  let owner: OrchestrationDb | undefined
  afterEach(() => {
    db?.close()
    db = undefined
    owner?.close()
    owner = undefined
  })

  it('migrates an exact v2 database and keeps spend and raw responses byte-identical', () => {
    db = createFixtureV2Database()
    const keptSchema = schemaSql(db, KEPT)
    const spend = rows(db, 'SELECT * FROM workbench_clef_spend ORDER BY sequence')
    const raw = rows(db, 'SELECT * FROM workbench_clef_raw_responses ORDER BY sequence')
    migrate(db)
    expect(version(db)).toBe(WORKBENCH_SCHEMA_VERSION_CURRENT)
    expect(WORKBENCH_SCHEMA_VERSION_CURRENT).toBe(3)
    expect(workbenchNames(db)).toEqual(
      WORKBENCH_SCHEMA_DEFINITIONS.map((definition) => definition.name).sort()
    )
    for (const retired of RETIRED) {
      expect(workbenchNames(db)).not.toContain(retired)
    }
    expect(schemaSql(db, KEPT)).toEqual(keptSchema)
    expect(rows(db, 'SELECT * FROM workbench_clef_spend ORDER BY sequence')).toEqual(spend)
    expect(rows(db, 'SELECT * FROM workbench_clef_raw_responses ORDER BY sequence')).toEqual(raw)
    expect(db.isTransaction).toBe(false)
  })

  it('maps ROUTING_BLOCKED and ROUTING to an unlaunched RECEIVED and keeps CANCELED', () => {
    db = createFixtureV2Database()
    const before = rows(
      db,
      'SELECT request_id, sequence, objective, input_hash FROM workbench_requests ORDER BY sequence'
    )
    migrate(db)
    expect(
      rows(
        db,
        'SELECT request_id, status, revision, updated_at, blocker_reason, blocker_detail, workflow_run_id FROM workbench_requests ORDER BY sequence'
      )
    ).toEqual([
      {
        request_id: 'fixture-v2-blocked',
        status: 'RECEIVED',
        revision: 2,
        updated_at: NOW.toISOString(),
        blocker_reason: null,
        blocker_detail: null,
        workflow_run_id: null
      },
      {
        request_id: 'fixture-v2-routing',
        status: 'RECEIVED',
        revision: 3,
        updated_at: NOW.toISOString(),
        blocker_reason: null,
        blocker_detail: null,
        workflow_run_id: null
      },
      {
        request_id: 'fixture-v2-canceled',
        status: 'CANCELED',
        revision: 2,
        updated_at: FIXTURE_V2_TIME,
        blocker_reason: null,
        blocker_detail: null,
        workflow_run_id: null
      }
    ])
    expect(
      rows(
        db,
        'SELECT request_id, sequence, objective, input_hash FROM workbench_requests ORDER BY sequence'
      )
    ).toEqual(before)
    expect(rows(db, 'SELECT * FROM workbench_request_settings ORDER BY request_id')).toEqual(
      FIXTURE_V2_REQUESTS.map((request) => ({
        request_id: request.requestId,
        requested_access: 'read_only',
        deliverable_language: null
      })).sort((a, b) => a.request_id.localeCompare(b.request_id))
    )
  })

  it('keeps every v2 event and appends one migrated event per requeued request', () => {
    db = createFixtureV2Database()
    const v2Events = rows(db, 'SELECT * FROM workbench_request_events ORDER BY sequence')
    migrate(db)
    const events = rows(db, 'SELECT * FROM workbench_request_events ORDER BY sequence')
    expect(events.slice(0, v2Events.length)).toEqual(v2Events)
    expect(events.slice(v2Events.length)).toEqual([
      {
        sequence: FIXTURE_V2_EVENT_HIGH_WATER + 1,
        request_id: 'fixture-v2-blocked',
        kind: 'migrated',
        revision: 2,
        recorded_at: NOW.toISOString(),
        input_hash: fixtureV2InputHash(FIXTURE_V2_REQUESTS[0].objective)
      },
      {
        sequence: FIXTURE_V2_EVENT_HIGH_WATER + 2,
        request_id: 'fixture-v2-routing',
        kind: 'migrated',
        revision: 3,
        recorded_at: NOW.toISOString(),
        input_hash: fixtureV2InputHash(FIXTURE_V2_REQUESTS[1].objective)
      }
    ])
  })

  it('keeps the sequence high-water marks, so no cursor value is ever reused', () => {
    db = createFixtureV2Database()
    migrate(db)
    expect(sequences(db)).toMatchObject({
      workbench_requests: FIXTURE_V2_REQUEST_HIGH_WATER,
      workbench_request_events: FIXTURE_V2_EVENT_HIGH_WATER + 2
    })
    const store = new WorkbenchRequestStore(db)
    const fresh = store.submit(
      FIXTURE_V2_PRINCIPAL,
      {
        workspaceId: FIXTURE_V2_WORKSPACE.workspaceId,
        objective: 'A request after the migration.',
        idempotencyKey: '0b6f6e1e-1d0b-4a8c-9a59-7f1d7f2c1a99'
      },
      FIXTURE_V2_WORKSPACE
    ).request
    expect(fresh.sequence).toBe(FIXTURE_V2_REQUEST_HIGH_WATER + 1)
  })

  it('serves migrated rows through the store and still replays their v2 idempotency keys', () => {
    db = createFixtureV2Database()
    migrate(db)
    const store = new WorkbenchRequestStore(db)
    const listed = store.list(
      FIXTURE_V2_PRINCIPAL,
      { workspaceId: FIXTURE_V2_WORKSPACE.workspaceId, limit: 50 },
      FIXTURE_V2_WORKSPACE
    ).requests
    expect(listed.map((request) => [request.requestId, request.status, request.revision])).toEqual([
      ['fixture-v2-canceled', 'CANCELED', 2],
      ['fixture-v2-routing', 'ROUTING', 3],
      ['fixture-v2-blocked', 'ROUTING', 2]
    ])
    for (const request of FIXTURE_V2_REQUESTS) {
      const replay = store.submit(
        FIXTURE_V2_PRINCIPAL,
        {
          workspaceId: FIXTURE_V2_WORKSPACE.workspaceId,
          objective: request.objective,
          idempotencyKey: request.key
        },
        FIXTURE_V2_WORKSPACE
      )
      expect(replay).toMatchObject({ duplicate: true, request: { requestId: request.requestId } })
    }
  })

  it('is applied once: a second open verifies the v3 layout and writes nothing', () => {
    db = createFixtureV2Database()
    migrate(db)
    const after = snapshot(db)
    migrate(db)
    expect(snapshot(db)).toEqual(after)
  })

  it('leaves foreign keys enforced and their deferral off', () => {
    db = createFixtureV2Database()
    migrate(db)
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
    expect(db.prepare('PRAGMA defer_foreign_keys').get()?.defer_foreign_keys).toBe(0)
  })

  it.each(['decision', 'intent', 'override', 'routed'] as const)(
    'fails closed on a v2 database holding a %s and changes nothing (U2)',
    (kind) => {
      db = createFixtureV2Database()
      FIXTURE_V2_UNMIGRATABLE_ROWS[kind](db)
      const before = snapshot(db)
      expect(() => migrate(db!)).toThrow(
        expect.objectContaining({
          code: 'workbench_recovery_required',
          message: expect.stringContaining('not migrated')
        })
      )
      expect(snapshot(db)).toEqual(before)
      expect(version(db)).toBe(2)
      expect(db.isTransaction).toBe(false)
    }
  )

  it('refuses a drifted v2 layout without migrating it', () => {
    db = createFixtureV2Database()
    db.exec('ALTER TABLE workbench_request_outbox ADD COLUMN fixture_extra TEXT')
    const before = snapshot(db)
    expect(() => migrate(db!)).toThrow('layout is unsupported')
    expect(snapshot(db)).toEqual(before)
  })

  it('refuses a v2 database missing a v2 table', () => {
    db = createFixtureV2Database()
    db.exec('DROP TABLE workbench_route_overrides')
    const before = snapshot(db)
    expect(() => migrate(db!)).toThrow('incomplete')
    expect(snapshot(db)).toEqual(before)
  })

  it('rolls the whole migration back when a dangling reference survives the rebuild', () => {
    db = createFixtureV2Database()
    insertFixtureV2DanglingSpend(db)
    const before = snapshot(db)
    expect(() => migrate(db!)).toThrow(
      expect.objectContaining({ code: 'workbench_recovery_required' })
    )
    expect(snapshot(db)).toEqual(before)
    expect(db.isTransaction).toBe(false)
    expect(rows(db, 'SELECT name FROM sqlite_temp_master')).toEqual([])
  })

  it("never touches Orca's own tables or user_version", () => {
    owner = new OrchestrationDb(':memory:')
    seedFixtureV2Workbench(owner.db)
    const orca = () =>
      rows(
        owner!.db,
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'workbench_%' AND name NOT LIKE 'sqlite_autoindex_workbench_%' ORDER BY name"
      )
    const orcaBefore = orca()
    const userVersion = owner.db.prepare('PRAGMA user_version').get()?.user_version
    ensureWorkbenchRequestSchema(owner.db, () => NOW)
    expect(orca()).toEqual(orcaBefore)
    expect(owner.db.prepare('PRAGMA user_version').get()?.user_version).toBe(userVersion)
    expect(version(owner.db)).toBe(3)
  })
})
