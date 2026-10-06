import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  DOT_REMOTE_SCHEMA_DEFINITIONS,
  type DotRemoteSchemaDefinition
} from './dot-remote-schema-definition'
import { DOT_REMOTE_SCHEMA_V1_DEFINITIONS } from './dot-remote-schema-v1'
import { DOT_REMOTE_SCHEMA_VERSION, ensureDotRemoteSchema } from './dot-remote-schema'

// Pins the exact layouts: changing any definition without a new schema version fails here first.
// v1 gained the pairing lifetime column before any build shipped it; v2 (G7) adds the validation
// decision event and item kinds, and a v1 family is migrated in place.
const SCHEMA_V1_SHA256 = 'a7a3140a4855be61f613f2a8ff7c736ef6817599123d65855a492474629aae82'
const SCHEMA_V2_SHA256 = 'b9276875496367705f77f7223249611ee2367b2a45f3dc80c7ed6f74dab7a83f'
const T = '2026-10-05T12:00:00.000Z'
const REQUEST = '30000000-0000-4000-8000-000000000001'

function layoutHash(definitions: readonly DotRemoteSchemaDefinition[]): string {
  const text = definitions
    .map((definition) => definition.sql.replace(/\s+/g, ' ').trim())
    .join('\n')
  return createHash('sha256').update(text).digest('hex')
}

function createVersionOne(owner: OrchestrationDb): void {
  for (const definition of DOT_REMOTE_SCHEMA_V1_DEFINITIONS) {
    owner.db.exec(definition.sql)
  }
  owner.db.prepare('INSERT INTO dot_remote_schema VALUES (1, 1)').run()
}

function outboxRow(sequence: number | null, eventId: string, kind: string) {
  return [sequence, eventId, REQUEST, sequence ?? 9, kind, '{}', 1, 'sent', 1, 'applied', T, T]
}

const INSERT_OUTBOX = `INSERT INTO dot_remote_outbox (sequence, event_id, dot_request_id, source_revision, kind,
  body, generation, state, attempts, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
const INSERT_ITEM = `INSERT INTO dot_remote_items (item_id, kind, payload_sha256, generation, outcome,
  dot_request_id, acked, created_at, updated_at) VALUES (?, ?, ?, 1, '{"outcome":"expired"}', NULL, 1, ?, ?)`

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

function familyObjects(owner: OrchestrationDb): string[] {
  return owner.db
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'dot_remote_%' ORDER BY name")
    .all()
    .map((row) => String(row.name))
}

describe('dot remote schema family', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
  })
  afterEach(() => owner.close())

  it('creates only new dot_remote_ objects at the current version', () => {
    const before = owner.db
      .prepare("SELECT name, sql FROM sqlite_master WHERE instr(name, 'dot_remote_') = 0")
      .all()
    ensureDotRemoteSchema(owner.db)
    expect(familyObjects(owner)).toEqual(
      DOT_REMOTE_SCHEMA_DEFINITIONS.map((definition) => definition.name).sort()
    )
    expect(
      owner.db
        .prepare("SELECT name, sql FROM sqlite_master WHERE instr(name, 'dot_remote_') = 0")
        .all()
    ).toEqual(before)
    expect(owner.db.prepare('SELECT version FROM dot_remote_schema WHERE id = 1').get()).toEqual({
      version: DOT_REMOTE_SCHEMA_VERSION
    })
  })

  it('verifies an existing family on the next start without changing it', () => {
    ensureDotRemoteSchema(owner.db)
    ensureDotRemoteSchema(owner.db)
    expect(familyObjects(owner)).toHaveLength(DOT_REMOTE_SCHEMA_DEFINITIONS.length)
  })

  it('fails closed on a drifted table and changes nothing', () => {
    ensureDotRemoteSchema(owner.db)
    owner.db.exec('DROP TABLE dot_remote_artifact_refs')
    owner.db.exec('CREATE TABLE dot_remote_artifact_refs (artifact_ref TEXT)')
    expect(codeOf(() => ensureDotRemoteSchema(owner.db))).toBe('dot_remote_recovery_required')
  })

  it('fails closed on an unknown version', () => {
    ensureDotRemoteSchema(owner.db)
    owner.db.exec('UPDATE dot_remote_schema SET version = 99 WHERE id = 1')
    expect(codeOf(() => ensureDotRemoteSchema(owner.db))).toBe('dot_remote_recovery_required')
  })

  it('fails closed on a partial family', () => {
    ensureDotRemoteSchema(owner.db)
    owner.db.exec('DROP TABLE dot_remote_artifact_refs')
    expect(codeOf(() => ensureDotRemoteSchema(owner.db))).toBe('dot_remote_recovery_required')
  })

  it('pins the v1 layout it migrates from and the v2 layout', () => {
    expect(DOT_REMOTE_SCHEMA_VERSION).toBe(2)
    expect(layoutHash(DOT_REMOTE_SCHEMA_V1_DEFINITIONS)).toBe(SCHEMA_V1_SHA256)
    expect(layoutHash(DOT_REMOTE_SCHEMA_DEFINITIONS)).toBe(SCHEMA_V2_SHA256)
  })
})

describe('dot remote schema v1 to v2 migration', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
  })
  afterEach(() => owner.close())

  const all = (sql: string) => owner.db.prepare(sql).all()

  it('rebuilds the outbox and the item journal in place, keeping every row and the sequence', () => {
    createVersionOne(owner)
    owner.db
      .prepare('INSERT INTO dot_remote_requests VALUES (?, ?, 1, 4, 1, ?, ?)')
      .run(REQUEST, '10000000-0000-4000-8000-000000000001', T, T)
    owner.db
      .prepare(INSERT_OUTBOX)
      .run(...outboxRow(4, '60000000-0000-4000-8000-000000000004', 'request_status'))
    owner.db.prepare("UPDATE sqlite_sequence SET seq = 9 WHERE name = 'dot_remote_outbox'").run()
    owner.db
      .prepare(INSERT_ITEM)
      .run('10000000-0000-4000-8000-000000000002', 'message', 'c'.repeat(64), T, T)
    const outboxBefore = all('SELECT * FROM dot_remote_outbox')
    const itemsBefore = all('SELECT * FROM dot_remote_items')

    ensureDotRemoteSchema(owner.db)

    expect(owner.db.prepare('SELECT version FROM dot_remote_schema WHERE id = 1').get()).toEqual({
      version: 2
    })
    expect(familyObjects(owner)).toEqual(
      DOT_REMOTE_SCHEMA_DEFINITIONS.map((definition) => definition.name).sort()
    )
    expect(all('SELECT * FROM dot_remote_outbox')).toEqual(outboxBefore)
    expect(all('SELECT * FROM dot_remote_items')).toEqual(itemsBefore)
    expect(all("SELECT seq FROM sqlite_sequence WHERE name LIKE 'dot_remote_%'")).toEqual([
      { seq: 9 }
    ])
    owner.db
      .prepare(INSERT_OUTBOX)
      .run(
        ...outboxRow(null, '60000000-0000-4000-8000-000000000005', 'validation_decision_settled')
      )
    expect(
      all("SELECT sequence FROM dot_remote_outbox WHERE kind = 'validation_decision_settled'")
    ).toEqual([{ sequence: 10 }])
    owner.db
      .prepare(INSERT_ITEM)
      .run('10000000-0000-4000-8000-000000000003', 'validation_decision', 'd'.repeat(64), T, T)
    ensureDotRemoteSchema(owner.db)
    expect(familyObjects(owner)).toHaveLength(DOT_REMOTE_SCHEMA_DEFINITIONS.length)
  })

  it('migrates an empty version 1 family', () => {
    createVersionOne(owner)
    ensureDotRemoteSchema(owner.db)
    expect(owner.db.prepare('SELECT version FROM dot_remote_schema WHERE id = 1').get()).toEqual({
      version: 2
    })
    expect(all("SELECT name FROM sqlite_sequence WHERE name LIKE 'dot_remote_%'")).toEqual([])
  })

  it('fails closed on a drifted version 1 family and changes nothing', () => {
    createVersionOne(owner)
    owner.db.exec('DROP TABLE dot_remote_artifact_refs')
    owner.db.exec('CREATE TABLE dot_remote_artifact_refs (artifact_ref TEXT)')
    const before = all(
      "SELECT name, sql FROM sqlite_master WHERE name LIKE 'dot_remote_%' ORDER BY name"
    )
    expect(codeOf(() => ensureDotRemoteSchema(owner.db))).toBe('dot_remote_recovery_required')
    expect(
      all("SELECT name, sql FROM sqlite_master WHERE name LIKE 'dot_remote_%' ORDER BY name")
    ).toEqual(before)
    expect(owner.db.prepare('SELECT version FROM dot_remote_schema WHERE id = 1').get()).toEqual({
      version: 1
    })
  })

  it('refuses a version 2 kind in a version 1 family', () => {
    createVersionOne(owner)
    owner.db
      .prepare('INSERT INTO dot_remote_requests VALUES (?, ?, 1, 4, 1, ?, ?)')
      .run(REQUEST, '10000000-0000-4000-8000-000000000001', T, T)
    expect(() =>
      owner.db
        .prepare(INSERT_OUTBOX)
        .run(
          ...outboxRow(null, '60000000-0000-4000-8000-000000000005', 'validation_decision_settled')
        )
    ).toThrow()
  })
})
