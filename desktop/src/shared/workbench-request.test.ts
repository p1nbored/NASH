import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_DEFAULT_REQUEST_ACCESS,
  WORKBENCH_LIST_MAX_LIMIT,
  WORKBENCH_NOT_CONFIGURED_BLOCKER,
  WORKBENCH_REQUEST_ACCESS_LEVELS,
  WORKBENCH_REQUEST_STATUSES,
  WorkbenchCancelResultSchema,
  WorkbenchListResultSchema,
  WorkbenchObjectiveSchema,
  WorkbenchRequestAccessSchema,
  WorkbenchWorkspaceIdSchema,
  WorkbenchRequestIdSchema,
  WorkbenchRequestSchema,
  WorkbenchSubmitResultSchema,
  type WorkbenchRequest
} from './workbench-request'

const LAUNCH_BLOCKER = {
  reason: 'launch_blocked',
  detail: 'coordinator_route_unavailable'
} as const

const blockedRequest = {
  schemaVersion: 1,
  requestId: 'd059ca24-0f93-4c06-b317-dc2a95d6920b',
  sequence: 1,
  workspaceId: 'repo::/workspace/app',
  objective: '  Inspect the parser.\nKeep the existing architecture.\n',
  status: 'ROUTING_BLOCKED',
  revision: 3,
  createdAt: '2026-10-03T12:00:00.000Z',
  updatedAt: '2026-10-03T12:00:00.000Z',
  accepted: true,
  deliveryState: 'not_delivered',
  routingBlocker: LAUNCH_BLOCKER,
  permissionState: 'not_requested',
  workflowRunId: null,
  taskId: null,
  modelProfileId: null,
  executionSurface: null,
  pluginOperationId: null,
  clefDecisionId: null
} satisfies WorkbenchRequest

const canceledRequest = {
  ...blockedRequest,
  status: 'CANCELED',
  revision: 4,
  updatedAt: '2026-10-03T12:01:00.000Z',
  routingBlocker: null
} satisfies WorkbenchRequest

const routingRequest = {
  ...blockedRequest,
  status: 'ROUTING',
  revision: 1,
  routingBlocker: null
} satisfies WorkbenchRequest

const routedRequest = {
  ...blockedRequest,
  status: 'ROUTED',
  revision: 3,
  routingBlocker: null,
  workflowRunId: 'run_fixture_1'
} satisfies WorkbenchRequest

// Why: the renderer queue fixture still builds a pre-D-016 routed record; it must keep parsing.
const legacyRoutedFixture = {
  ...routedRequest,
  workflowRunId: null,
  modelProfileId: 'codex_assistant',
  executionSurface: 'codex_exec',
  pluginOperationId: null,
  clefDecisionId: 'rd_fixture'
} satisfies WorkbenchRequest

describe('WorkbenchRequestSchema', () => {
  it('preserves valid Unicode and whitespace without normalization', () => {
    const objective = '  Fixture \u{1F680} é\r\n  '
    expect(WorkbenchObjectiveSchema.parse(objective)).toBe(objective)
  })

  it.each(['\uD800', '\uDC00', 'Fixture \uD800 text', 'Fixture\0text'])(
    'rejects malformed Unicode before lossy persistence: %s',
    (objective) => {
      expect(WorkbenchObjectiveSchema.safeParse(objective).success).toBe(false)
      expect(WorkbenchWorkspaceIdSchema.safeParse(objective).success).toBe(false)
      expect(WorkbenchRequestIdSchema.safeParse(objective).success).toBe(false)
    }
  )

  it('keeps exactly the four view statuses the renderer switches over', () => {
    expect(WORKBENCH_REQUEST_STATUSES).toEqual(['ROUTING_BLOCKED', 'ROUTING', 'ROUTED', 'CANCELED'])
  })

  it('accepts launch-blocked, received, launched and canceled projections with the objective intact', () => {
    for (const record of [blockedRequest, routingRequest, routedRequest, canceledRequest]) {
      expect(WorkbenchRequestSchema.parse(record)).toEqual(record)
    }
  })

  it('still parses the legacy routed renderer fixture, so its record type is unchanged', () => {
    expect(WorkbenchRequestSchema.parse(legacyRoutedFixture)).toEqual(legacyRoutedFixture)
  })

  it('exposes the not-configured intake blocker as a frozen reason and detail', () => {
    expect(WORKBENCH_NOT_CONFIGURED_BLOCKER).toEqual({
      reason: 'classifier_unavailable',
      detail: 'not_configured'
    })
    expect(Object.isFrozen(WORKBENCH_NOT_CONFIGURED_BLOCKER)).toBe(true)
    expect(
      WorkbenchRequestSchema.parse({
        ...blockedRequest,
        routingBlocker: WORKBENCH_NOT_CONFIGURED_BLOCKER
      }).routingBlocker
    ).toEqual(WORKBENCH_NOT_CONFIGURED_BLOCKER)
  })

  it.each([
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'APPROVED',
    'DISPATCHED',
    'RECEIVED',
    'LAUNCHING',
    'LAUNCHED',
    'LAUNCH_BLOCKED'
  ])('rejects stored, execution or approval status %s on the wire', (status) => {
    expect(WorkbenchRequestSchema.safeParse({ ...blockedRequest, status }).success).toBe(false)
  })

  it('requires the routing blocker only while blocked', () => {
    expect(
      WorkbenchRequestSchema.safeParse({ ...blockedRequest, routingBlocker: null }).success
    ).toBe(false)
    for (const record of [canceledRequest, routingRequest, routedRequest]) {
      expect(
        WorkbenchRequestSchema.safeParse({ ...record, routingBlocker: LAUNCH_BLOCKER }).success
      ).toBe(false)
    }
  })

  it.each([
    'CLEF_NOT_CONFIGURED',
    { reason: 'launch_blocked' },
    { reason: 'rule_fallback', detail: 'not_configured' },
    { reason: 'launch_blocked', detail: 'next_best_tuple' },
    { reason: 'launch_blocked', detail: 'launch_refused', rationale: 'free text' }
  ])('rejects a blocker outside the reason and detail enums: %j', (routingBlocker) => {
    expect(WorkbenchRequestSchema.safeParse({ ...blockedRequest, routingBlocker }).success).toBe(
      false
    )
  })

  it.each([
    ['accepted', false],
    ['deliveryState', 'delivered'],
    ['permissionState', 'approved']
  ])('rejects unearned state in %s', (field, value) => {
    for (const record of [blockedRequest, routingRequest, routedRequest, canceledRequest]) {
      expect(WorkbenchRequestSchema.safeParse({ ...record, [field]: value }).success).toBe(false)
    }
  })

  it.each(['workflowRunId', 'taskId'])('carries %s as a bounded identifier or null', (field) => {
    expect(WorkbenchRequestSchema.safeParse({ ...canceledRequest, [field]: 'run_1' }).success).toBe(
      true
    )
    for (const value of ['', 'x'.repeat(513), 7]) {
      expect(WorkbenchRequestSchema.safeParse({ ...canceledRequest, [field]: value }).success).toBe(
        false
      )
    }
  })

  it.each(['modelProfileId', 'executionSurface', 'pluginOperationId', 'clefDecisionId'])(
    'keeps the retired binding field %s as a bounded nullable string',
    (field) => {
      expect(WorkbenchRequestSchema.safeParse({ ...routingRequest, [field]: null }).success).toBe(
        true
      )
      expect(
        WorkbenchRequestSchema.safeParse({ ...routingRequest, [field]: 'fixture_value' }).success
      ).toBe(true)
      for (const value of ['', 'x'.repeat(129), 3]) {
        expect(
          WorkbenchRequestSchema.safeParse({ ...routingRequest, [field]: value }).success
        ).toBe(false)
      }
      const missing = Object.fromEntries(
        Object.entries(routingRequest).filter(([key]) => key !== field)
      )
      expect(WorkbenchRequestSchema.safeParse(missing).success).toBe(false)
    }
  )

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid sequence and revision %s',
    (value) => {
      expect(WorkbenchRequestSchema.safeParse({ ...blockedRequest, sequence: value }).success).toBe(
        false
      )
      expect(WorkbenchRequestSchema.safeParse({ ...blockedRequest, revision: value }).success).toBe(
        false
      )
    }
  )

  it('rejects malformed timestamps, unsupported schema versions and extra fields', () => {
    expect(
      WorkbenchRequestSchema.safeParse({ ...blockedRequest, createdAt: 'yesterday' }).success
    ).toBe(false)
    expect(
      WorkbenchRequestSchema.safeParse({ ...blockedRequest, updatedAt: '2026-10-03' }).success
    ).toBe(false)
    expect(WorkbenchRequestSchema.safeParse({ ...blockedRequest, schemaVersion: 2 }).success).toBe(
      false
    )
    expect(WorkbenchRequestSchema.safeParse({ ...blockedRequest, approved: true }).success).toBe(
      false
    )
    expect(
      WorkbenchRequestSchema.safeParse({ ...routedRequest, requestedAccess: 'read_only' }).success
    ).toBe(false)
  })
})

describe('requested access', () => {
  it('offers read_only and workspace_write, defaulting to read_only', () => {
    expect(WORKBENCH_REQUEST_ACCESS_LEVELS).toEqual(['read_only', 'workspace_write'])
    expect(WORKBENCH_DEFAULT_REQUEST_ACCESS).toBe('read_only')
    expect(WorkbenchRequestAccessSchema.safeParse('full_access').success).toBe(false)
    expect(WorkbenchRequestAccessSchema.safeParse('READ_ONLY').success).toBe(false)
  })
})

describe('Workbench result contracts', () => {
  const list = {
    requests: [routedRequest, routingRequest, blockedRequest, canceledRequest],
    nextBeforeSequence: null,
    capabilities: { submit: true, cancelPending: true, dispatch: false },
    blocker: 'not_configured'
  }

  it('keeps request acceptance separate from delivery and dispatch capability', () => {
    expect(WorkbenchListResultSchema.parse(list)).toEqual(list)
    expect(
      WorkbenchSubmitResultSchema.parse({ request: routingRequest, duplicate: false })
    ).toEqual({ request: routingRequest, duplicate: false })
    expect(WorkbenchCancelResultSchema.parse({ request: canceledRequest, changed: true })).toEqual({
      request: canceledRequest,
      changed: true
    })
  })

  it('reports dispatch capability as a boolean only while routing is ready', () => {
    const ready = {
      ...list,
      blocker: 'ready',
      capabilities: { ...list.capabilities, dispatch: true }
    }
    expect(WorkbenchListResultSchema.parse(ready)).toEqual(ready)
    expect(
      WorkbenchListResultSchema.safeParse({ ...ready, capabilities: list.capabilities }).success
    ).toBe(true)
    expect(WorkbenchListResultSchema.safeParse({ ...ready, blocker: 'circuit_open' }).success).toBe(
      false
    )
  })

  it.each(['CLEF_NOT_CONFIGURED', 'classifier_unavailable', 'configured', null])(
    'rejects a top-level blocker that is not a routing status: %s',
    (blocker) => {
      expect(WorkbenchListResultSchema.safeParse({ ...list, blocker }).success).toBe(false)
    }
  )

  it('rejects dispatch claims, invalid cursors and oversized pages', () => {
    expect(
      WorkbenchListResultSchema.safeParse({
        ...list,
        capabilities: { ...list.capabilities, dispatch: true }
      }).success
    ).toBe(false)
    expect(WorkbenchListResultSchema.safeParse({ ...list, nextBeforeSequence: 0 }).success).toBe(
      false
    )
    expect(
      WorkbenchListResultSchema.safeParse({
        ...list,
        requests: Array.from({ length: WORKBENCH_LIST_MAX_LIMIT + 1 }, () => blockedRequest)
      }).success
    ).toBe(false)
  })

  it('validates replay and cancellation receipts without accepting extra authority', () => {
    expect(
      WorkbenchSubmitResultSchema.safeParse({ request: canceledRequest, duplicate: true }).success
    ).toBe(true)
    expect(
      WorkbenchSubmitResultSchema.safeParse({
        request: routingRequest,
        duplicate: false,
        approved: true
      }).success
    ).toBe(false)
    expect(
      WorkbenchCancelResultSchema.safeParse({ request: canceledRequest, changed: 'yes' }).success
    ).toBe(false)
  })
})
