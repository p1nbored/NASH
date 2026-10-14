import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import {
  ensureAutopilotRuntimeSchema,
  legacyAutopilotDefinitions
} from './autopilot-runtime-schema'
import { insertRawRun, insertRawTaskSpec, fixtureTime } from './autopilot-runtime.test-fixture'

describe('autopilot runtime v4 routing migration', () => {
  let owner: OrchestrationDb | undefined
  afterEach(() => owner?.close())

  it.each([2, 3] as const)(
    'preserves v%s runs, routes, references and sequence high-water marks',
    (version) => {
      owner = new OrchestrationDb(':memory:')
      const db = owner.db
      ensureWorkbenchRequestSchema(db)
      for (const definition of legacyAutopilotDefinitions(version)) {
        db.exec(definition.sql)
      }
      db.prepare('INSERT INTO autopilot_runtime_schema VALUES (1, ?)').run(version)
      insertRawRun(db, 'run_v3', 'request_v3')
      insertRawTaskSpec(db, 'task_v3', 'run_v3')
      db.prepare(`INSERT INTO task_classifications
      (classification_id, task_id, attempt, outcome, needs_delegation, task_type, created_at)
      VALUES ('classification_v3', 'task_v3', 1, 'classified', 1, 'software_engineering', ?)`).run(
        fixtureTime()
      )
      db.prepare(`INSERT INTO task_routes
      (sequence, route_id, classification_id, routing_table_version, routing_table_sha256,
       target, model, policy_level, status, reasons, created_at)
      VALUES (7, 'route_v3', 'classification_v3', 1, ?, 'codex_cli', 'gpt-6.1-sol', 'high', 'available', '[]', ?)`).run(
        'a'.repeat(64),
        fixtureTime()
      )
      db.exec("UPDATE sqlite_sequence SET seq = 100 WHERE name = 'task_routes'")
      db.exec('CREATE TABLE external_run_reference (run_id TEXT REFERENCES workflow_runs(run_id))')
      db.exec("INSERT INTO external_run_reference VALUES ('run_v3')")
      const beforeRun = db.prepare('SELECT * FROM workflow_runs').all()
      const beforeRoute = db.prepare('SELECT * FROM task_routes').all()
      const beforeVersion = db.pragma('user_version', { simple: true })

      ensureAutopilotRuntimeSchema(db)

      expect(db.prepare('SELECT * FROM workflow_runs').all()).toEqual(beforeRun)
      expect(db.prepare('SELECT * FROM task_routes').all()).toEqual(beforeRoute)
      expect(
        db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'task_routes'").get()
      ).toEqual({ seq: 100 })
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(db.pragma('user_version', { simple: true })).toBe(beforeVersion)
      db.exec("UPDATE workflow_runs SET coordinator_agent = 'gemini'")
      db.exec("UPDATE task_routes SET target = 'gemini_cli'")
      expect(() => ensureAutopilotRuntimeSchema(db)).not.toThrow()
    }
  )
})
