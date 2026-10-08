import type { Mock } from 'vitest'
import {
  WorkbenchPermissionDecisionViewSchema,
  type WorkbenchPermissionDecisionView
} from '../../../../shared/rpc-contract/permission-relay-params'
import {
  PrimarySessionViewSchema,
  WorkflowRunViewSchema,
  type PrimarySessionView,
  type WorkflowRunView
} from '../../../../shared/workflow-run/workflow-run-view'

// FIXTURE_ONLY: synthetic run and permission views for Workbench renderer tests.
export const FIXTURE_PANE_LEAF = '0f6b8a52-3c1d-4e7a-9b2c-5d4e3f2a1b0c'
export const FIXTURE_IDEMPOTENCY_KEY = '3a642de6-28cc-41b7-bc05-8fa216d92977'

type RpcMock = Mock<(target: unknown, method: string, params?: unknown) => Promise<unknown>>
export type RpcHandler = (params: Record<string, unknown>) => unknown

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {}
}

/** Answers each RPC method from its handler; an unexpected method fails the call loudly. */
export function routeRpc(rpc: RpcMock, handlers: Record<string, RpcHandler>): void {
  rpc.mockImplementation(async (_target, method, params) => {
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
    if (!handler) {
      throw new Error(`unexpected ${method}`)
    }
    return handler(toRecord(params))
  })
}

export function callsTo(rpc: RpcMock, method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

export function primarySession(overrides: Partial<PrimarySessionView> = {}): PrimarySessionView {
  return PrimarySessionViewSchema.parse({
    generation: 1,
    state: 'running',
    permissionMode: 'manual',
    model: 'claude-fixture-model',
    effort: 'high',
    paneKey: `tab-primary:${FIXTURE_PANE_LEAF}`,
    endReason: null,
    startedAt: '2026-10-03T12:01:00.000Z',
    updatedAt: '2026-10-03T12:01:00.000Z',
    endedAt: null,
    live: null,
    ...overrides
  })
}

export function runView(
  sequence = 1,
  overrides: Partial<WorkflowRunView> = {},
  workspaceId = 'local-workspace'
): WorkflowRunView {
  return WorkflowRunViewSchema.parse({
    runId: `run-${sequence}`,
    requestId: `request-${sequence}`,
    origin: 'desktop',
    workspaceId,
    objective: `Fixture objective ${sequence}`,
    status: 'active',
    revision: 2,
    requestedAccess: 'read_only',
    routingTable: { version: 1, sha256: 'a'.repeat(64) },
    coordinator: { agent: 'claude', model: 'claude-fixture-model', effort: 'high' },
    endReason: null,
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:01:00.000Z',
    endedAt: null,
    primary: primarySession(),
    ...overrides
  })
}

export function runList(runs: WorkflowRunView[] = [], hasMore = false) {
  return { runs, hasMore }
}

export function permissionView(
  overrides: Partial<WorkbenchPermissionDecisionView> = {}
): WorkbenchPermissionDecisionView {
  return WorkbenchPermissionDecisionViewSchema.parse({
    decisionId: 'decision-1',
    runId: 'run-1',
    agentId: null,
    toolName: 'Bash',
    summary: 'Bash: pnpm test src/receipt.test.ts',
    status: 'pending',
    decidedBy: null,
    createdAt: '2026-10-03T12:02:00.000Z',
    deadlineAt: '2026-10-03T12:06:00.000Z',
    decidedAt: null,
    desktopOnly: false,
    answerable: true,
    ...overrides
  })
}
