import type { RouteBlocker } from '../../../src/shared/clef/clef-route-contract'
import type { WorkbenchListResult, WorkbenchRequest } from '../../../src/shared/workbench-request'
import type { WorkflowRunView } from '../../../src/shared/workflow-run/workflow-run-view'
import type { WorkbenchPermissionDecisionView } from '../../../src/shared/rpc-contract/permission-relay-params'
import {
  answerOutcome,
  endedRuns,
  messageOutcome,
  overviewPrompts,
  overviewRuns
} from './scenario-workbench-runs'
import { createTaskWindowFixture } from './scenario-workbench-tasks'

// FIXTURE_ONLY Workbench RPC answers. The run and permission methods are not registered in the app
// until package E1, so the harness answers them here; nothing contacts a runtime.
export const WORKBENCH_FIXTURE_VARIANTS = ['overview', 'ended', 'errors', 'empty'] as const
export type WorkbenchFixtureVariant = (typeof WORKBENCH_FIXTURE_VARIANTS)[number]

export type WorkbenchFixtureReply =
  | { ok: true; result: unknown }
  | { ok: false; code: string; message: string }

type FixtureState = {
  runs: readonly WorkflowRunView[]
  prompts: readonly WorkbenchPermissionDecisionView[]
  requests: readonly WorkbenchRequest[]
}

type RequestLaunchState = { revision: number; workflowRunId: string | null } & (
  | { status: 'ROUTING_BLOCKED'; routingBlocker: RouteBlocker }
  | { status: 'ROUTING' | 'ROUTED' | 'CANCELED'; routingBlocker: null }
)

function request(
  workspaceId: string,
  sequence: number,
  objective: string,
  launch: RequestLaunchState
): WorkbenchRequest {
  const at = new Date(Date.UTC(2026, 9, 3, 10, 30 + sequence, 0)).toISOString()
  return {
    schemaVersion: 1,
    requestId: `fixture-request-${String(sequence).padStart(3, '0')}`,
    sequence,
    workspaceId,
    objective,
    createdAt: at,
    updatedAt: at,
    accepted: true,
    deliveryState: 'not_delivered',
    permissionState: 'not_requested',
    taskId: null,
    modelProfileId: null,
    executionSurface: null,
    pluginOperationId: null,
    clefDecisionId: null,
    ...launch
  }
}

function overviewRequests(workspaceId: string): WorkbenchRequest[] {
  return [
    request(workspaceId, 7, 'Rename the receipt fixtures.', {
      status: 'CANCELED',
      routingBlocker: null,
      workflowRunId: null,
      revision: 2
    }),
    request(workspaceId, 5, 'Bind progress claims to validated execution receipts.', {
      status: 'ROUTING',
      routingBlocker: null,
      workflowRunId: null,
      revision: 2
    }),
    request(workspaceId, 4, '请把收据校验接到受保护的验证器，保留原始证据。', {
      status: 'ROUTING_BLOCKED',
      routingBlocker: { reason: 'launch_blocked', detail: 'launch_unverifiable' },
      workflowRunId: 'fixture-run-004',
      revision: 3
    }),
    request(workspaceId, 2, 'Summarize the open review threads.', {
      status: 'ROUTING_BLOCKED',
      routingBlocker: { reason: 'launch_blocked', detail: 'coordinator_route_unavailable' },
      workflowRunId: null,
      revision: 3
    })
  ]
}

function initialState(workspaceId: string, variant: WorkbenchFixtureVariant): FixtureState {
  switch (variant) {
    case 'overview':
    case 'errors':
      return {
        runs: overviewRuns(workspaceId),
        prompts: overviewPrompts(),
        requests: overviewRequests(workspaceId)
      }
    case 'ended':
      return { runs: endedRuns(workspaceId), prompts: [], requests: [] }
    case 'empty':
      return { runs: [], prompts: [], requests: [] }
  }
}

function listResult(requests: readonly WorkbenchRequest[]): WorkbenchListResult {
  return {
    requests: [...requests],
    nextBeforeSequence: null,
    capabilities: { submit: true, cancelPending: true, dispatch: false },
    blocker: 'not_configured'
  }
}

function ok(result: unknown): WorkbenchFixtureReply {
  return { ok: true, result }
}

function failure(code: string, message: string): WorkbenchFixtureReply {
  return { ok: false, code, message }
}

function field(params: unknown, key: string): string {
  if (typeof params !== 'object' || params === null) {
    return ''
  }
  const value = Object.entries(params).find(([name]) => name === key)?.[1]
  return typeof value === 'string' ? value : ''
}

export function readWorkbenchFixtureVariant(search: string): WorkbenchFixtureVariant {
  const value = new URLSearchParams(search).get('workbench')
  return WORKBENCH_FIXTURE_VARIANTS.find((variant) => variant === value) ?? 'overview'
}

export function createWorkbenchFixture(workspaceId: string, variant: WorkbenchFixtureVariant) {
  // Why mutable: this is the fake server; captures click Stop or Allow and the next poll must agree.
  let state = initialState(workspaceId, variant)
  const taskWindow = createTaskWindowFixture()

  function stopRun(runId: string): WorkbenchFixtureReply {
    const target = state.runs.find((candidate) => candidate.runId === runId)
    if (!target) {
      return failure('workbench_run_not_found', 'The run was not found.')
    }
    if (target.status === 'unverifiable') {
      return failure(
        'workbench_run_stop_unconfirmed',
        'The session could not be confirmed stopped, so the run is still open. Close its terminal tab and try again.'
      )
    }
    const stopped: WorkflowRunView = {
      ...target,
      status: 'canceled',
      endReason: 'user_canceled',
      primary: target.primary
        ? { ...target.primary, state: 'stopped', endReason: 'user_canceled', live: null }
        : null
    }
    state = {
      ...state,
      runs: state.runs.map((candidate) => (candidate.runId === runId ? stopped : candidate))
    }
    return ok({ run: stopped, changed: true })
  }

  function answer(params: unknown): WorkbenchFixtureReply {
    const view = state.prompts.find(
      (candidate) => candidate.decisionId === field(params, 'decisionId')
    )
    if (!view) {
      return ok({ outcome: 'not_found', decision: null })
    }
    const result = answerOutcome(view, field(params, 'decision') === 'deny' ? 'deny' : 'allow')
    const next = result.decision
    state = {
      ...state,
      prompts:
        next?.status === 'pending'
          ? state.prompts.map((candidate) =>
              candidate.decisionId === view.decisionId ? next : candidate
            )
          : state.prompts.filter((candidate) => candidate.decisionId !== view.decisionId)
    }
    return ok(result)
  }

  return (method: string, params: unknown): WorkbenchFixtureReply | null => {
    if (
      variant === 'errors' &&
      (method === 'workbench.runs.list' || method === 'workbench.permission.list')
    ) {
      return failure('method_not_found', `${method} is not registered in this build yet.`)
    }
    switch (method) {
      case 'workbench.requests.list':
        return ok(listResult(state.requests))
      case 'workbench.runs.list':
        return ok({ runs: state.runs, hasMore: false })
      case 'workbench.runs.show': {
        const shown = state.runs.find((candidate) => candidate.runId === field(params, 'runId'))
        return shown
          ? ok({ run: shown })
          : failure('workbench_run_not_found', 'The run was not found.')
      }
      case 'workbench.runs.stop':
        return stopRun(field(params, 'runId'))
      case 'workbench.runs.message':
        return ok(messageOutcome(field(params, 'text')))
      case 'workbench.permission.list':
        return ok({ decisions: state.prompts })
      case 'workbench.permission.answer':
        return answer(params)
      case 'workbench.runs.tasks':
        return taskWindow.tasks(field(params, 'runId'))
      case 'workbench.attempts.transcript.read':
        return taskWindow.read(params)
      default:
        return null
    }
  }
}
