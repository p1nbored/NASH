import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { readWorkflowRunOrigin } from './workflow-run-origin'
import { seedPrimaryRun } from './primary-session.test-fixture'
import { createIntakeEvidenceTables, recordIntakePrincipal } from './run-message.test-fixture'

describe('workflow run origin', () => {
  let db: OrchestrationDb
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })
  afterEach(() => db.close())

  it('reports a missing run as not found', () => {
    expect(readWorkflowRunOrigin(db, 'run_missing')).toEqual({ found: false })
  })

  it('reads unknown when no intake table exists, and creates none', () => {
    const { run } = seedPrimaryRun(db)
    expect(readWorkflowRunOrigin(db, run.runId)).toEqual({
      found: true,
      origin: 'unknown',
      requestId: run.requestId
    })
    const tables = db.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('workbench_requests', 'dot_ingress_requests')"
      )
      .all()
    expect(tables).toEqual([])
  })

  it.each([
    ['dot-ingress', 'dot'],
    ['local-desktop-ui', 'desktop'],
    ['someone-else', 'unknown']
  ] as const)('maps the intake principal %s to %s', (principal, origin) => {
    createIntakeEvidenceTables(db)
    const { run } = seedPrimaryRun(db)
    recordIntakePrincipal(db, run.requestId, principal)
    expect(readWorkflowRunOrigin(db, run.runId)).toMatchObject({ found: true, origin })
  })

  it('reads a dot ingress link as dot', () => {
    createIntakeEvidenceTables(db)
    const { run } = seedPrimaryRun(db)
    db.db
      .prepare('INSERT INTO dot_ingress_requests (workbench_request_id) VALUES (?)')
      .run(run.requestId)
    expect(readWorkflowRunOrigin(db, run.runId)).toMatchObject({ origin: 'dot' })
  })

  it('reads conflicting evidence as unknown, so dot is refused rather than trusted', () => {
    createIntakeEvidenceTables(db)
    const { run } = seedPrimaryRun(db)
    recordIntakePrincipal(db, run.requestId, 'local-desktop-ui')
    db.db
      .prepare('INSERT INTO dot_ingress_requests (workbench_request_id) VALUES (?)')
      .run(run.requestId)
    expect(readWorkflowRunOrigin(db, run.runId)).toMatchObject({ origin: 'unknown' })
  })
})
