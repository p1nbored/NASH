import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getWorkbenchRequestStore, type WorkbenchRequestStore } from './workbench-request-store'
import {
  routeFixturePrincipal as principal,
  routeFixtureSubmitInput as input,
  routeFixtureWorkspace as workspace
} from './workbench-route-test-fixture'

const LAUNCH_REFUSED = { reason: 'launch_blocked', detail: 'launch_refused' } as const
const ROUTE_UNAVAILABLE = {
  reason: 'launch_blocked',
  detail: 'coordinator_route_unavailable'
} as const

describe('Workbench launch transitions for the single intake door', () => {
  let owner: OrchestrationDb
  let store: WorkbenchRequestStore

  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    store = getWorkbenchRequestStore(owner)
  })
  afterEach(() => owner.close())

  const submit = () => store.submit(principal, input(), workspace).request
  const target = (requestId: string, expectedRevision: number) => ({
    workspaceId: workspace.workspaceId,
    requestId,
    expectedRevision
  })
  const raw = (requestId: string) =>
    owner.db
      .prepare(
        'SELECT status, revision, blocker_reason, blocker_detail, workflow_run_id FROM workbench_requests WHERE request_id = ?'
      )
      .get(requestId)
  const events = (requestId: string) =>
    owner.db
      .prepare(
        'SELECT kind, revision FROM workbench_request_events WHERE request_id = ? ORDER BY sequence'
      )
      .all(requestId)
      .map((row) => `${String(row.kind)}@${String(row.revision)}`)
  const code = (code: string) => expect.objectContaining({ code })
  const expectUnchanged = (requestId: string, action: () => unknown, expected: string) => {
    const before = { row: raw(requestId), events: events(requestId) }
    expect(action).toThrow(code(expected))
    expect({ row: raw(requestId), events: events(requestId) }).toEqual(before)
    expect(owner.db.isTransaction).toBe(false)
  }

  it('moves RECEIVED to LAUNCHING to LAUNCHED and links the workflow run', () => {
    const request = submit()
    const launching = store.advance(principal, target(request.requestId, 1), workspace, {
      to: 'LAUNCHING'
    })
    expect(launching).toMatchObject({ status: 'ROUTING', revision: 2, workflowRunId: null })
    const launched = store.advance(principal, target(request.requestId, 2), workspace, {
      to: 'LAUNCHED',
      workflowRunId: 'run_fixture_1'
    })
    expect(launched).toMatchObject({
      status: 'ROUTED',
      revision: 3,
      routingBlocker: null,
      workflowRunId: 'run_fixture_1',
      modelProfileId: null,
      executionSurface: null,
      clefDecisionId: null
    })
    expect(raw(request.requestId)).toMatchObject({ status: 'LAUNCHED', revision: 3 })
    expect(events(request.requestId)).toEqual(['accepted@1', 'launch_started@2', 'launched@3'])
  })

  it('blocks a failed launch with one launch blocker, keeping a run that was created', () => {
    const request = submit()
    store.advance(principal, target(request.requestId, 1), workspace, { to: 'LAUNCHING' })
    const blocked = store.advance(principal, target(request.requestId, 2), workspace, {
      to: 'LAUNCH_BLOCKED',
      blocker: LAUNCH_REFUSED,
      workflowRunId: 'run_fixture_failed'
    })
    expect(blocked).toMatchObject({
      status: 'ROUTING_BLOCKED',
      routingBlocker: LAUNCH_REFUSED,
      workflowRunId: 'run_fixture_failed'
    })
    expect(events(request.requestId).at(-1)).toBe('launch_blocked@3')
  })

  it('blocks a received request before any launch when its coordinator route is unavailable', () => {
    const request = submit()
    expect(
      store.advance(principal, target(request.requestId, 1), workspace, {
        to: 'LAUNCH_BLOCKED',
        blocker: ROUTE_UNAVAILABLE
      })
    ).toMatchObject({
      status: 'ROUTING_BLOCKED',
      routingBlocker: ROUTE_UNAVAILABLE,
      workflowRunId: null
    })
  })

  it.each([
    [
      'a blocker that is not a launch blocker',
      { to: 'LAUNCH_BLOCKED', blocker: { reason: 'ambiguous', detail: 'low_margin' } }
    ],
    [
      'an unknown blocker detail',
      { to: 'LAUNCH_BLOCKED', blocker: { reason: 'launch_blocked', detail: 'free text' } }
    ],
    ['a launch without its run', { to: 'LAUNCHED' }],
    ['a blank run id', { to: 'LAUNCHED', workflowRunId: '' }],
    ['a run on a launching move', { to: 'LAUNCHING', workflowRunId: 'run_fixture_1' }],
    ['a stored status as the target', { to: 'RECEIVED' }],
    ['a caller-chosen binding', { to: 'LAUNCHING', modelProfileId: 'codex_assistant' }]
  ])('refuses %s and changes nothing', (_label, change) => {
    const request = submit()
    expectUnchanged(
      request.requestId,
      // Why: JSON round trip stands in for a caller that skipped typing.
      () =>
        store.advance(
          principal,
          target(request.requestId, 1),
          workspace,
          JSON.parse(JSON.stringify(change))
        ),
      'workbench_invalid_input'
    )
  })

  it.each([
    ['RECEIVED', 'LAUNCHED'],
    ['LAUNCHED', 'LAUNCHING'],
    ['LAUNCHED', 'LAUNCH_BLOCKED'],
    ['CANCELED', 'LAUNCHING']
  ] as const)('refuses the edge %s to %s', (from, to) => {
    const request = submit()
    let revision = 1
    if (from === 'LAUNCHED') {
      store.advance(principal, target(request.requestId, 1), workspace, { to: 'LAUNCHING' })
      store.advance(principal, target(request.requestId, 2), workspace, {
        to: 'LAUNCHED',
        workflowRunId: 'run_fixture_edge'
      })
      revision = 3
    }
    if (from === 'CANCELED') {
      store.cancel(principal, target(request.requestId, 1), workspace)
      revision = 2
    }
    const change =
      to === 'LAUNCHED'
        ? ({ to, workflowRunId: 'run_fixture_skip' } as const)
        : to === 'LAUNCH_BLOCKED'
          ? ({ to, blocker: LAUNCH_REFUSED } as const)
          : ({ to } as const)
    expectUnchanged(
      request.requestId,
      () => store.advance(principal, target(request.requestId, revision), workspace, change),
      'workbench_invalid_transition'
    )
  })

  it('fences every move on the revision the caller observed', () => {
    const request = submit()
    store.advance(principal, target(request.requestId, 1), workspace, { to: 'LAUNCHING' })
    expectUnchanged(
      request.requestId,
      () => store.advance(principal, target(request.requestId, 1), workspace, { to: 'LAUNCHING' }),
      'workbench_revision_conflict'
    )
  })

  it('moves only requests inside the caller and admitted-workspace scope', () => {
    const request = submit()
    const move = { to: 'LAUNCHING' } as const
    expectUnchanged(
      request.requestId,
      () => store.advance('fixture-other-caller', target(request.requestId, 1), workspace, move),
      'workbench_request_not_found'
    )
    expectUnchanged(
      request.requestId,
      () =>
        store.advance(
          principal,
          target(request.requestId, 1),
          { ...workspace, projectId: 'fixture-remapped' },
          move
        ),
      'workbench_request_not_found'
    )
  })

  it('links one workflow run to at most one request', () => {
    const first = submit()
    const second = submit()
    for (const request of [first, second]) {
      store.advance(principal, target(request.requestId, 1), workspace, { to: 'LAUNCHING' })
    }
    store.advance(principal, target(first.requestId, 2), workspace, {
      to: 'LAUNCHED',
      workflowRunId: 'run_fixture_shared'
    })
    expect(() =>
      store.advance(principal, target(second.requestId, 2), workspace, {
        to: 'LAUNCHED',
        workflowRunId: 'run_fixture_shared'
      })
    ).toThrow('UNIQUE')
    expect(raw(second.requestId)).toMatchObject({ status: 'LAUNCHING', revision: 2 })
  })

  it('cancels received and launch-blocked requests in the store', () => {
    const received = submit()
    expect(store.cancel(principal, target(received.requestId, 1), workspace)).toMatchObject({
      changed: true,
      request: { status: 'CANCELED', revision: 2 }
    })
    const blocked = submit()
    store.advance(principal, target(blocked.requestId, 1), workspace, {
      to: 'LAUNCH_BLOCKED',
      blocker: ROUTE_UNAVAILABLE
    })
    expect(store.cancel(principal, target(blocked.requestId, 2), workspace)).toMatchObject({
      changed: true,
      request: { status: 'CANCELED', revision: 3, routingBlocker: null }
    })
    expect(raw(blocked.requestId)).toMatchObject({ blocker_reason: null, blocker_detail: null })
  })

  it.each(['LAUNCHING', 'LAUNCHED'] as const)(
    'refuses a plain cancel of a %s request, which belongs to its run',
    (status) => {
      const request = submit()
      store.advance(principal, target(request.requestId, 1), workspace, { to: 'LAUNCHING' })
      let revision = 2
      if (status === 'LAUNCHED') {
        store.advance(principal, target(request.requestId, 2), workspace, {
          to: 'LAUNCHED',
          workflowRunId: 'run_fixture_cancel'
        })
        revision = 3
      }
      expectUnchanged(
        request.requestId,
        () => store.cancel(principal, target(request.requestId, revision), workspace),
        'workbench_request_handed_off'
      )
    }
  )

  it('lets the door cancel a launched request after its run stopped, keeping the run link', () => {
    const request = submit()
    store.advance(principal, target(request.requestId, 1), workspace, { to: 'LAUNCHING' })
    store.advance(principal, target(request.requestId, 2), workspace, {
      to: 'LAUNCHED',
      workflowRunId: 'run_fixture_stopped'
    })
    expect(
      store.advance(principal, target(request.requestId, 3), workspace, { to: 'CANCELED' })
    ).toMatchObject({ status: 'CANCELED', revision: 4, workflowRunId: 'run_fixture_stopped' })
    expect(events(request.requestId).at(-1)).toBe('canceled@4')
  })

  it('refuses a move inside an uncommitted outer transaction', () => {
    const request = submit()
    owner.db.exec('BEGIN IMMEDIATE')
    expect(() =>
      store.advance(principal, target(request.requestId, 1), workspace, { to: 'LAUNCHING' })
    ).toThrow(code('workbench_transaction_unavailable'))
    owner.db.exec('ROLLBACK')
    expect(raw(request.requestId)).toMatchObject({ status: 'RECEIVED', revision: 1 })
  })
})
