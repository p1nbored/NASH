import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import {
  getWorkbenchRequestStore,
  WORKBENCH_PENDING_REQUEST_LIMIT,
  type WorkbenchRequestStore
} from './workbench-request-store'
import type { WorkbenchLocalWorkspace } from '../../workbench-local-workspace'

// FIXTURE_ONLY: these catalogs and objectives do not describe a real project.
const workspace: WorkbenchLocalWorkspace = {
  workspaceId: 'fixture-repo::/fixture/repo',
  projectId: 'fixture-project',
  projectKind: 'project',
  hostId: 'local',
  path: '/fixture/repo'
}
const principal = 'fixture-desktop'
const input = () => ({
  workspaceId: workspace.workspaceId,
  objective: '  Preserve exact objective bytes.\r\nSecond line.  ',
  idempotencyKey: randomUUID()
})

describe('Workbench requests in the existing orchestration database', () => {
  let owner: OrchestrationDb
  let store: WorkbenchRequestStore

  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    store = getWorkbenchRequestStore(owner)
  })
  afterEach(() => owner.close())

  const counts = () => ({
    requests: owner.db.prepare('SELECT count(*) AS n FROM workbench_requests').get()?.n,
    events: owner.db.prepare('SELECT count(*) AS n FROM workbench_request_events').get()?.n,
    settings: owner.db.prepare('SELECT count(*) AS n FROM workbench_request_settings').get()?.n
  })
  const list = () =>
    store.list(principal, { workspaceId: workspace.workspaceId, limit: 50 }, workspace)
  const stored = (requestId: string) =>
    owner.db
      .prepare(
        `SELECT r.status, r.revision, s.requested_access FROM workbench_requests r
        JOIN workbench_request_settings s ON s.request_id = r.request_id WHERE r.request_id = ?`
      )
      .get(requestId)
  const conflict = expect.objectContaining({ code: 'workbench_idempotency_conflict' })

  it('records a received request with its settings and creates no run, task, dispatch or message', () => {
    expect(getWorkbenchRequestStore(owner)).toBe(store)
    const legacyTables = ['runs', 'tasks', 'dispatch_contexts', 'messages']
    const legacyCounts = legacyTables.map(
      (table) => owner.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n
    )
    const submitted = input()
    const result = store.submit(principal, submitted, workspace)
    expect(result).toEqual({
      duplicate: false,
      request: {
        schemaVersion: 1,
        requestId: expect.any(String),
        sequence: 1,
        workspaceId: workspace.workspaceId,
        objective: submitted.objective,
        status: 'ROUTING',
        revision: 1,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        accepted: true,
        deliveryState: 'not_delivered',
        permissionState: 'not_requested',
        routingBlocker: null,
        workflowRunId: null,
        taskId: null,
        modelProfileId: null,
        executionSurface: null,
        pluginOperationId: null,
        clefDecisionId: null
      }
    })
    expect(stored(result.request.requestId)).toEqual({
      status: 'RECEIVED',
      revision: 1,
      requested_access: 'read_only'
    })
    expect(counts()).toEqual({ requests: 1, events: 1, settings: 1 })
    expect(
      legacyTables.map((table) => owner.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)
    ).toEqual(legacyCounts)
    expect(list().requests).toEqual([result.request])
  })

  it('stores the requested access', () => {
    const request = store.submit(
      principal,
      { ...input(), requestedAccess: 'workspace_write' },
      workspace
    ).request
    expect(stored(request.requestId)).toMatchObject({
      requested_access: 'workspace_write'
    })
  })

  it('replays the exact key without another event, request or settings row', () => {
    const params = input()
    const first = store.submit(principal, params, workspace)
    expect(store.submit(principal, params, workspace)).toEqual({ ...first, duplicate: true })
    expect(store.submit(principal, { ...params, requestedAccess: 'read_only' }, workspace)).toEqual(
      { ...first, duplicate: true }
    )
    expect(counts()).toEqual({ requests: 1, events: 1, settings: 1 })
  })

  it('treats the same key with different access as an idempotency conflict', () => {
    const params = input()
    store.submit(principal, params, workspace)
    expect(() =>
      store.submit(principal, { ...params, requestedAccess: 'workspace_write' }, workspace)
    ).toThrow(conflict)
    const writer = { ...input(), requestedAccess: 'workspace_write' as const }
    store.submit(principal, writer, workspace)
    expect(() =>
      store.submit(principal, { ...writer, requestedAccess: undefined }, workspace)
    ).toThrow(conflict)
    expect(counts()).toEqual({ requests: 2, events: 2, settings: 2 })
  })

  it('round-trips Unicode, combining marks and CRLF, rejecting lossy input before writes', () => {
    const params = { ...input(), objective: 'Fixture \u{1F680} é\r\n  ' }
    const first = store.submit(principal, params, workspace)
    expect(first.request.objective).toBe(params.objective)
    expect(store.submit(principal, params, workspace).request).toEqual(first.request)
    expect(() =>
      store.submit(principal, { ...input(), objective: 'Fixture \uD800' }, workspace)
    ).toThrow('valid Unicode')
    expect(() =>
      store.submit(principal, { ...input(), objective: 'Fixture\0tail' }, workspace)
    ).toThrow('null characters')
    expect(counts()).toEqual({ requests: 1, events: 1, settings: 1 })
  })

  it('rejects changed objective bytes, workspace identity or project binding for a used key', () => {
    const params = input()
    store.submit(principal, params, workspace)
    expect(() =>
      store.submit(principal, { ...params, objective: params.objective.trim() }, workspace)
    ).toThrow('different request bytes or scope')
    const other = { ...workspace, workspaceId: 'folder:fixture-folder' }
    expect(() =>
      store.submit(principal, { ...params, workspaceId: other.workspaceId }, other)
    ).toThrow('different request bytes or scope')
    expect(() =>
      store.submit(principal, params, { ...workspace, projectId: 'replacement-project' })
    ).toThrow('different request bytes or scope')
    expect(counts()).toEqual({ requests: 1, events: 1, settings: 1 })
  })

  it('does not transfer history or cancellation authority to a remapped project', () => {
    const request = store.submit(principal, input(), workspace).request
    const remapped = { ...workspace, projectId: 'replacement-project' }
    expect(
      store.list(principal, { workspaceId: workspace.workspaceId, limit: 50 }, remapped).requests
    ).toEqual([])
    expect(() =>
      store.cancel(
        principal,
        { workspaceId: workspace.workspaceId, requestId: request.requestId, expectedRevision: 1 },
        remapped
      )
    ).toThrow('not found')
    expect(counts()).toEqual({ requests: 1, events: 1, settings: 1 })
  })

  it('scopes listing, cancellation and keys to the authenticated principal', () => {
    const params = input()
    const first = store.submit(principal, params, workspace).request
    expect(
      store.list('other-caller', { workspaceId: workspace.workspaceId, limit: 50 }, workspace)
        .requests
    ).toEqual([])
    expect(() =>
      store.cancel(
        'other-caller',
        { workspaceId: workspace.workspaceId, requestId: first.requestId, expectedRevision: 1 },
        workspace
      )
    ).toThrow('not found')
    expect(store.submit('other-caller', params, workspace).duplicate).toBe(false)
    expect(list().requests).toEqual([first])
  })

  it('rolls back the request and its event when the settings row cannot be written', () => {
    owner.db
      .exec(`CREATE TRIGGER fixture_reject_settings BEFORE INSERT ON workbench_request_settings
      BEGIN SELECT RAISE(ABORT, 'fixture settings failure'); END`)
    const params = input()
    expect(() => store.submit(principal, params, workspace)).toThrow('fixture settings failure')
    expect(counts()).toEqual({ requests: 0, events: 0, settings: 0 })
    expect(owner.db.isTransaction).toBe(false)
    owner.db.exec('DROP TRIGGER fixture_reject_settings')
    expect(store.submit(principal, params, workspace).duplicate).toBe(false)
  })

  it('fails closed when a stored request has lost its settings row', () => {
    const params = input()
    const request = store.submit(principal, params, workspace).request
    owner.db
      .prepare('DELETE FROM workbench_request_settings WHERE request_id = ?')
      .run(request.requestId)
    expect(() => store.submit(principal, params, workspace)).toThrow(
      expect.objectContaining({ code: 'workbench_recovery_required' })
    )
  })

  it('uses revision fencing and keeps exactly one cancellation event on replay', () => {
    const params = input()
    const request = store.submit(principal, params, workspace).request
    const cancel = {
      workspaceId: workspace.workspaceId,
      requestId: request.requestId,
      expectedRevision: 1
    }
    expect(() => store.cancel(principal, { ...cancel, expectedRevision: 2 }, workspace)).toThrow(
      'revision changed'
    )
    expect(counts()).toEqual({ requests: 1, events: 1, settings: 1 })
    const canceled = store.cancel(principal, cancel, workspace)
    expect(canceled).toMatchObject({
      changed: true,
      request: { status: 'CANCELED', revision: 2, deliveryState: 'not_delivered' }
    })
    expect(store.cancel(principal, cancel, workspace)).toEqual({ ...canceled, changed: false })
    expect(store.submit(principal, params, workspace)).toEqual({
      request: canceled.request,
      duplicate: true
    })
    expect(counts()).toEqual({ requests: 1, events: 2, settings: 1 })
  })

  it('rolls cancellation back if its audit event cannot commit', () => {
    const request = store.submit(principal, input(), workspace).request
    owner.db.exec(`CREATE TRIGGER fixture_reject_cancel BEFORE INSERT ON workbench_request_events
      WHEN NEW.kind = 'canceled' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END`)
    expect(() =>
      store.cancel(
        principal,
        { workspaceId: workspace.workspaceId, requestId: request.requestId, expectedRevision: 1 },
        workspace
      )
    ).toThrow('fixture audit failure')
    expect(list().requests).toEqual([request])
    expect(counts()).toEqual({ requests: 1, events: 1, settings: 1 })
  })

  it('pages by immutable sequence without repeats after a newer insertion', () => {
    const requests = Array.from(
      { length: 5 },
      () => store.submit(principal, input(), workspace).request
    )
    const first = store.list(principal, { workspaceId: workspace.workspaceId, limit: 2 }, workspace)
    expect(first.requests).toEqual([requests[4], requests[3]])
    store.submit(principal, input(), workspace)
    const next = store.list(
      principal,
      {
        workspaceId: workspace.workspaceId,
        limit: 2,
        beforeSequence: first.nextBeforeSequence ?? undefined
      },
      workspace
    )
    expect(next.requests).toEqual([requests[2], requests[1]])
    const last = store.list(
      principal,
      {
        workspaceId: workspace.workspaceId,
        limit: 2,
        beforeSequence: next.nextBeforeSequence ?? undefined
      },
      workspace
    )
    expect(last.requests).toEqual([requests[0]])
    expect(last.nextBeforeSequence).toBeNull()
  })

  it('allows key replay, a remapped binding and cancellation recovery at pending capacity', () => {
    const params = input()
    const request = store.submit(principal, params, workspace).request
    for (let count = 1; count < WORKBENCH_PENDING_REQUEST_LIMIT; count++) {
      store.submit(principal, input(), workspace)
    }
    expect(() => store.submit(principal, input(), workspace)).toThrow('capacity')
    expect(store.submit(principal, params, workspace).duplicate).toBe(true)
    expect(
      store.submit(principal, input(), { ...workspace, projectId: 'replacement-project' }).duplicate
    ).toBe(false)
    store.cancel(
      principal,
      { workspaceId: workspace.workspaceId, requestId: request.requestId, expectedRevision: 1 },
      workspace
    )
    expect(store.submit(principal, input(), workspace).duplicate).toBe(false)
  })

  it('rejects uncommitted outer transactions without returning an acceptance', () => {
    owner.db.exec('BEGIN IMMEDIATE')
    expect(() => store.submit(principal, input(), workspace)).toThrow('idle database')
    expect(list).toThrow('idle database')
    expect(owner.db.isTransaction).toBe(true)
    owner.db.exec('ROLLBACK')
    expect(counts()).toEqual({ requests: 0, events: 0, settings: 0 })
  })

  it('rejects direct invalid inputs and inconsistent admitted scope', () => {
    expect(() => store.submit('  ', input(), workspace)).toThrow('Authenticated')
    expect(() => store.submit(principal, { ...input(), objective: '  ' }, workspace)).toThrow()
    expect(() => store.submit(principal, input(), { ...workspace, workspaceId: 'other' })).toThrow(
      'inconsistent'
    )
    expect(counts()).toEqual({ requests: 0, events: 0, settings: 0 })
  })

  it('reports the routing summary and dispatch capability it is given on list', () => {
    const params = { workspaceId: workspace.workspaceId, limit: 50 }
    expect(store.list(principal, params, workspace)).toMatchObject({
      capabilities: { submit: true, cancelPending: true, dispatch: false },
      blocker: 'not_configured'
    })
    expect(
      store.list(principal, params, workspace, { status: 'ready', dispatch: true })
    ).toMatchObject({ capabilities: { dispatch: true }, blocker: 'ready' })
    expect(
      store.list(principal, params, workspace, { status: 'circuit_open', dispatch: true })
    ).toMatchObject({ capabilities: { dispatch: false }, blocker: 'circuit_open' })
  })

  it('reads one request only inside the caller and workspace scope', () => {
    const request = store.submit(principal, input(), workspace).request
    const target = { workspaceId: workspace.workspaceId, requestId: request.requestId }
    expect(store.get(principal, target, workspace)).toEqual(request)
    expect(() => store.get('other-caller', target, workspace)).toThrow('not found')
    expect(() =>
      store.get(principal, target, { ...workspace, projectId: 'replacement-project' })
    ).toThrow('not found')
  })
})
