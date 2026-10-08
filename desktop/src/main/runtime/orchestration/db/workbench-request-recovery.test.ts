import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../sqlite/sync-database'
import { OrchestrationDb } from './orchestration-db'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import { getWorkbenchRequestStore } from './workbench-request-store'
import type { WorkbenchLocalWorkspace } from '../../workbench-local-workspace'
import {
  WORKBENCH_REQUEST_EVENT_KINDS,
  WORKBENCH_SCHEMA_DEFINITIONS,
  WORKBENCH_SCHEMA_VERSION_CURRENT,
  WORKBENCH_STORED_STATUSES,
  workbenchSqlList
} from './workbench-request-schema-definition'
import { WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES } from './workbench-route-schema-definition'

// FIXTURE_ONLY: isolated temporary storage, never an app profile.
const workspace: WorkbenchLocalWorkspace = {
  workspaceId: 'folder:fixture',
  projectId: 'fixture-group',
  projectKind: 'folder-group',
  hostId: 'local',
  path: '/fixture/folder'
}

describe('Workbench storage recovery', () => {
  let db: Database.Database | undefined
  let owner: OrchestrationDb | undefined
  let directory: string | undefined
  afterEach(() => {
    db?.close()
    db = undefined
    owner?.close()
    owner = undefined
    if (directory) {
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith('orca-workbench-fixture-')
      ) {
        throw new Error('Fixture cleanup escaped its temporary directory.')
      }
      rmSync(directory, { recursive: true, force: true })
      directory = undefined
    }
  })

  it('retains committed bytes, idempotency and cancellation through closing and reopening the owner', () => {
    directory = mkdtempSync(join(tmpdir(), 'orca-workbench-fixture-'))
    const path = join(directory, 'orchestration.db')
    owner = new OrchestrationDb(path)
    const store = getWorkbenchRequestStore(owner)
    const input = {
      workspaceId: workspace.workspaceId,
      objective: 'Persistent fixture request.\n',
      idempotencyKey: randomUUID()
    }
    const accepted = store.submit('fixture-ui', input, workspace).request
    owner.close()
    owner = new OrchestrationDb(path)
    const reopened = getWorkbenchRequestStore(owner)
    expect(reopened.submit('fixture-ui', input, workspace)).toEqual({
      request: accepted,
      duplicate: true
    })
    const canceled = reopened.cancel(
      'fixture-ui',
      {
        workspaceId: workspace.workspaceId,
        requestId: accepted.requestId,
        expectedRevision: 1
      },
      workspace
    ).request
    owner.close()
    owner = new OrchestrationDb(path)
    expect(getWorkbenchRequestStore(owner).submit('fixture-ui', input, workspace)).toEqual({
      request: canceled,
      duplicate: true
    })
    expect(owner.db.prepare('SELECT count(*) AS n FROM workbench_request_events').get()?.n).toBe(2)
  })

  it('refuses a partial schema without creating the missing tables or touching other data', () => {
    db = new Database(':memory:')
    db.exec(
      "CREATE TABLE fixture_existing (value TEXT); INSERT INTO fixture_existing VALUES ('keep'); CREATE TABLE workbench_requests (sequence INTEGER)"
    )
    expect(() => ensureWorkbenchRequestSchema(db!)).toThrow('incomplete')
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name)
    ).toEqual(['fixture_existing', 'workbench_requests'])
    expect(db.prepare('SELECT value FROM fixture_existing').get()?.value).toBe('keep')
    expect(db.isTransaction).toBe(false)
  })

  it('creates the v3 layout on an empty database', () => {
    db = new Database(':memory:')
    ensureWorkbenchRequestSchema(db)
    expect(db.prepare('SELECT version FROM workbench_request_schema').get()?.version).toBe(
      WORKBENCH_SCHEMA_VERSION_CURRENT
    )
    expect(WORKBENCH_SCHEMA_VERSION_CURRENT).toBe(3)
  })

  it('refuses future versions without applying a downgrade', () => {
    db = new Database(':memory:')
    ensureWorkbenchRequestSchema(db)
    db.exec('UPDATE workbench_request_schema SET version = 4 WHERE id = 1')
    const before = db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all()
    expect(() => ensureWorkbenchRequestSchema(db!)).toThrow('unsupported')
    expect(db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all()).toEqual(before)
    expect(db.prepare('SELECT version FROM workbench_request_schema').get()?.version).toBe(4)
  })

  it.each(['workbench_request_settings', 'workbench_clef_raw_responses'])(
    'refuses a v3 layout missing %s',
    (table) => {
      db = new Database(':memory:')
      ensureWorkbenchRequestSchema(db)
      db.exec(`DROP TABLE ${table}`)
      expect(() => ensureWorkbenchRequestSchema(db!)).toThrow('incomplete')
    }
  )

  it('refuses an unexpected layout even when a version claims to be supported', () => {
    db = new Database(':memory:')
    ensureWorkbenchRequestSchema(db)
    db.exec('ALTER TABLE workbench_requests ADD COLUMN fixture_unknown TEXT')
    expect(() => ensureWorkbenchRequestSchema(db!)).toThrow('layout is unsupported')
    expect(db.prepare('PRAGMA table_info(workbench_requests)').all().at(-1)?.name).toBe(
      'fixture_unknown'
    )
  })

  it.each([
    ['sequence INTEGER PRIMARY KEY AUTOINCREMENT', 'sequence INTEGER NOT NULL DEFAULT 1'],
    ['request_id TEXT UNIQUE NOT NULL', 'request_id TEXT NOT NULL'],
    ['UNIQUE (principal_id, idempotency_key)', 'CHECK (length(idempotency_key) > 0)'],
    [
      `status TEXT NOT NULL CHECK (status IN (${workbenchSqlList(WORKBENCH_STORED_STATUSES)}))`,
      'status TEXT NOT NULL'
    ],
    ["CHECK ((status = 'LAUNCH_BLOCKED') = (blocker_reason IS NOT NULL)),", ''],
    ["CHECK (status <> 'LAUNCHED' OR workflow_run_id IS NOT NULL),", ''],
    [
      "blocker_reason TEXT CHECK (blocker_reason IS NULL OR blocker_reason = 'launch_blocked')",
      'blocker_reason TEXT'
    ],
    [
      `kind TEXT NOT NULL CHECK (kind IN (${workbenchSqlList(WORKBENCH_REQUEST_EVENT_KINDS)}))`,
      'kind TEXT NOT NULL'
    ],
    [
      'request_id TEXT PRIMARY KEY NOT NULL REFERENCES workbench_requests(request_id)',
      'request_id TEXT PRIMARY KEY NOT NULL'
    ],
    ["CHECK (requested_access IN ('read_only', 'workspace_write'))", ''],
    ['CREATE UNIQUE INDEX workbench_request_run', 'CREATE INDEX workbench_request_run'],
    ["CHECK (purpose <> 'production' OR request_id IS NOT NULL),", ''],
    ['reserved_micro_usd INTEGER NOT NULL', 'reserved_micro_usd REAL NOT NULL'],
    ['UNIQUE (request_id, attempt),', ''],
    [
      `length(request_body) <= ${WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES}`,
      'length(request_body) >= 0'
    ]
  ])('refuses weakened v3 declarations: %s', (original, replacement) => {
    db = new Database(':memory:')
    for (const definition of WORKBENCH_SCHEMA_DEFINITIONS) {
      db.exec(definition.sql.replace(original, replacement))
    }
    expect(
      WORKBENCH_SCHEMA_DEFINITIONS.some((definition) => definition.sql.includes(original))
    ).toBe(true)
    db.exec(`INSERT INTO workbench_request_schema VALUES (1, ${WORKBENCH_SCHEMA_VERSION_CURRENT})`)
    const before = db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all()
    expect(() => ensureWorkbenchRequestSchema(db!)).toThrow('layout is unsupported')
    expect(db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all()).toEqual(before)
  })

  it('refuses a missing required cursor index without rebuilding it silently', () => {
    db = new Database(':memory:')
    ensureWorkbenchRequestSchema(db)
    db.exec('DROP INDEX workbench_request_scope')
    expect(() => ensureWorkbenchRequestSchema(db!)).toThrow('layout is unsupported')
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'workbench_request_scope'").get()
    ).toBeUndefined()
  })

  it("does not initialize schema inside someone else's uncommitted transaction", () => {
    db = new Database(':memory:')
    db.exec('BEGIN IMMEDIATE')
    expect(() => ensureWorkbenchRequestSchema(db!)).toThrow('idle database')
    expect(db.isTransaction).toBe(true)
    db.exec('ROLLBACK')
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'workbench_%'").all()
    ).toEqual([])
  })
})
