import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { OrchestrationError } from '../orchestration-error'
import { getWorkbenchRequestStore, type WorkbenchRequestStore } from './workbench-request-store'
import {
  WORKBENCH_STORED_STATUSES,
  type WorkbenchStoredStatus
} from './workbench-request-schema-definition'
import {
  isWorkbenchRequestTransitionAllowed,
  transitionWorkbenchRequest,
  type WorkbenchRequestTransition
} from './workbench-request-transition'
import {
  routeFixturePrincipal as principal,
  routeFixtureSubmitInput as input,
  routeFixtureWorkspace as workspace
} from './workbench-route-test-fixture'

const NOW = '2026-10-05T12:30:00.000Z'
const LEGAL_EDGES = new Set([
  'RECEIVED>LAUNCHING',
  'RECEIVED>LAUNCH_BLOCKED',
  'RECEIVED>CANCELED',
  'LAUNCHING>LAUNCHED',
  'LAUNCHING>LAUNCH_BLOCKED',
  'LAUNCHING>CANCELED',
  'LAUNCHED>CANCELED',
  'LAUNCH_BLOCKED>CANCELED'
])
const ALL_PAIRS = WORKBENCH_STORED_STATUSES.flatMap((from) =>
  WORKBENCH_STORED_STATUSES.map((to) => [from, to] as const)
)
const BLOCKER = { reason: 'launch_blocked', detail: 'launch_refused' } as const

describe('Workbench request transition edges', () => {
  it.each(ALL_PAIRS)('%s to %s matches the edge allow-list', (from, to) => {
    expect(isWorkbenchRequestTransitionAllowed(from, to)).toBe(LEGAL_EDGES.has(`${from}>${to}`))
  })

  it('never returns to RECEIVED, the state only intake and migration write', () => {
    for (const from of WORKBENCH_STORED_STATUSES) {
      expect(isWorkbenchRequestTransitionAllowed(from, 'RECEIVED')).toBe(false)
    }
  })
})

describe('transitionWorkbenchRequest', () => {
  let owner: OrchestrationDb
  let requests: WorkbenchRequestStore

  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    requests = getWorkbenchRequestStore(owner)
  })
  afterEach(() => owner.close())

  const snapshot = (requestId: string) => ({
    request: owner.db
      .prepare('SELECT * FROM workbench_requests WHERE request_id = ?')
      .all(requestId),
    events: owner.db
      .prepare('SELECT * FROM workbench_request_events WHERE request_id = ? ORDER BY sequence')
      .all(requestId)
  })
  const attempt = (
    requestId: string,
    from: WorkbenchStoredStatus,
    to: WorkbenchStoredStatus,
    expectedRevision: number
  ) => {
    const transition: WorkbenchRequestTransition = {
      requestId,
      from,
      expectedRevision,
      to,
      blocker: to === 'LAUNCH_BLOCKED' ? BLOCKER : null,
      workflowRunId: to === 'LAUNCHED' ? 'run_fixture_1' : null,
      timestamp: NOW
    }
    return () => transitionWorkbenchRequest(owner.db, transition)
  }
  const expectRefused = (requestId: string, action: () => unknown, code: string) => {
    const before = snapshot(requestId)
    expect(action).toThrow(expect.objectContaining({ name: 'OrchestrationError', code }))
    expect(snapshot(requestId)).toEqual(before)
  }

  it.each(WORKBENCH_STORED_STATUSES)(
    'never moves a canceled request to %s, even at its exact revision',
    (to) => {
      const request = requests.submit(principal, input(), workspace).request
      const target = { workspaceId: workspace.workspaceId, requestId: request.requestId }
      requests.cancel(principal, { ...target, expectedRevision: 1 }, workspace)
      expectRefused(
        request.requestId,
        attempt(request.requestId, 'CANCELED', to, 2),
        'workbench_invalid_transition'
      )
    }
  )

  it('refuses skipping the launch from received straight to launched', () => {
    const request = requests.submit(principal, input(), workspace).request
    expectRefused(
      request.requestId,
      attempt(request.requestId, 'RECEIVED', 'LAUNCHED', 1),
      'workbench_invalid_transition'
    )
  })

  it('moves one allowed edge, bumps the revision once and records its event', () => {
    const request = requests.submit(principal, input(), workspace).request
    expect(attempt(request.requestId, 'RECEIVED', 'LAUNCHING', 1)()).toBe(2)
    expect(
      owner.db
        .prepare('SELECT status, revision, updated_at FROM workbench_requests WHERE request_id = ?')
        .get(request.requestId)
    ).toEqual({ status: 'LAUNCHING', revision: 2, updated_at: NOW })
    expect(snapshot(request.requestId).events.map((event) => event.kind)).toEqual([
      'accepted',
      'launch_started'
    ])
  })

  it('rolls nothing forward when the stored row does not match the caller fence', () => {
    const request = requests.submit(principal, input(), workspace).request
    expectRefused(
      request.requestId,
      attempt(request.requestId, 'RECEIVED', 'LAUNCHING', 7),
      'workbench_revision_conflict'
    )
    expectRefused(
      request.requestId,
      attempt(request.requestId, 'LAUNCHING', 'LAUNCHED', 1),
      'workbench_revision_conflict'
    )
  })

  it('reports the refused edge as an OrchestrationError a renderer may see', () => {
    const request = requests.submit(principal, input(), workspace).request
    const refused = attempt(request.requestId, 'CANCELED', 'LAUNCHING', 1)
    expect(refused).toThrow(OrchestrationError)
    expect(refused).toThrow('Request cannot move from CANCELED to LAUNCHING.')
  })
})
