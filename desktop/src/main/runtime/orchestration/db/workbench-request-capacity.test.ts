import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import {
  getWorkbenchRequestStore,
  WORKBENCH_PENDING_REQUEST_LIMIT,
  WORKBENCH_TOTAL_REQUEST_LIMIT
} from './workbench-request-store'
import type { WorkbenchLocalWorkspace } from '../../workbench-local-workspace'

// FIXTURE_ONLY: synthetic history exercises admission limits, not delivery evidence.
const workspace: WorkbenchLocalWorkspace = {
  workspaceId: 'folder:fixture-capacity',
  projectId: 'fixture-group',
  projectKind: 'folder-group',
  hostId: 'local',
  path: '/fixture/capacity'
}

describe('Workbench bounded retention and query shape', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
  })
  afterEach(() => owner.close())

  it('refuses new keys at total capacity while preserving replay and cancellation', () => {
    const store = getWorkbenchRequestStore(owner)
    const input = {
      workspaceId: workspace.workspaceId,
      objective: 'Capacity fixture.',
      idempotencyKey: randomUUID()
    }
    const request = store.submit('fixture-ui', input, workspace).request
    owner.db
      .prepare(`WITH RECURSIVE fixture_rows(n) AS (
      VALUES(1) UNION ALL SELECT n + 1 FROM fixture_rows WHERE n < ?
    ) INSERT INTO workbench_requests (
      request_id, workspace_id, workspace_binding, principal_id, idempotency_key,
      input_hash, objective, status, revision, created_at, updated_at
    ) SELECT 'fixture-history-' || n, 'folder:fixture-history', 'fixture-binding',
      'fixture-history', 'fixture-key-' || n, 'fixture-hash', 'Synthetic capacity row.',
      'CANCELED', 1, '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z' FROM fixture_rows`)
      .run(WORKBENCH_TOTAL_REQUEST_LIMIT - 1)
    expect(() =>
      store.submit('fixture-ui', { ...input, idempotencyKey: randomUUID() }, workspace)
    ).toThrow('capacity')
    expect(store.submit('fixture-ui', input, workspace)).toEqual({ request, duplicate: true })
    const canceled = store.cancel(
      'fixture-ui',
      {
        workspaceId: workspace.workspaceId,
        requestId: request.requestId,
        expectedRevision: 1
      },
      workspace
    ).request
    expect(canceled.status).toBe('CANCELED')
    expect(owner.db.prepare('SELECT count(*) AS n FROM workbench_requests').get()?.n).toBe(
      WORKBENCH_TOTAL_REQUEST_LIMIT
    )
    expect(owner.db.prepare('SELECT count(*) AS n FROM workbench_request_events').get()?.n).toBe(2)
  })

  it('counts received, launching and launch-blocked requests as pending, but not launched ones', () => {
    const store = getWorkbenchRequestStore(owner)
    const submit = (objective: string) =>
      store.submit(
        'fixture-ui',
        { workspaceId: workspace.workspaceId, objective, idempotencyKey: randomUUID() },
        workspace
      )
    const seed = submit('Seed.').request
    const seedRows = (count: number, status: string) =>
      owner.db
        .prepare(`WITH RECURSIVE fixture_rows(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM fixture_rows WHERE n < ?
      ) INSERT INTO workbench_requests (request_id, workspace_id, workspace_binding, principal_id,
        idempotency_key, input_hash, objective, status, revision, created_at, updated_at,
        blocker_reason, blocker_detail, workflow_run_id)
      SELECT ? || '-' || n, r.workspace_id, r.workspace_binding, r.principal_id, ? || '-key-' || n,
        'fixture-hash', 'Synthetic row.', ?, 1, r.created_at, r.updated_at,
        CASE WHEN ? = 'LAUNCH_BLOCKED' THEN 'launch_blocked' END,
        CASE WHEN ? = 'LAUNCH_BLOCKED' THEN 'launch_refused' END,
        CASE WHEN ? = 'LAUNCHED' THEN ? || '-run-' || n END
      FROM workbench_requests r, fixture_rows WHERE r.request_id = ?`)
        .run(count, status, status, status, status, status, status, status, seed.requestId)
    seedRows(WORKBENCH_PENDING_REQUEST_LIMIT - 4, 'RECEIVED')
    seedRows(1, 'LAUNCHING')
    seedRows(5, 'LAUNCHED')
    expect(submit('Room for one more.').duplicate).toBe(false)
    seedRows(1, 'LAUNCH_BLOCKED')
    expect(() => submit('Over pending capacity.')).toThrow('capacity')
  })

  it('indexes workspace-bound cursor reads instead of scanning the retained history', () => {
    getWorkbenchRequestStore(owner)
    const plan = owner.db
      .prepare(`EXPLAIN QUERY PLAN SELECT sequence FROM workbench_requests
      WHERE workspace_id = ? AND workspace_binding = ? AND principal_id = ? AND sequence < ?
      ORDER BY sequence DESC LIMIT ?`)
      .all(workspace.workspaceId, 'fixture-binding', 'fixture-ui', 500, 51)
    expect(plan.some((row) => String(row.detail).includes('workbench_request_scope'))).toBe(true)
    expect(plan.some((row) => String(row.detail).includes('USE TEMP B-TREE'))).toBe(false)
  })
})
