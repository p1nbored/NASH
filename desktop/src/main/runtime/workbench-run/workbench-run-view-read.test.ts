import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { DOT_INGRESS_PRINCIPAL_ID } from '../../../shared/dot-ingress/dot-ingress-limits'
import {
  PRIMARY_SESSION_VIEW_PERMISSION_MODES,
  PRIMARY_SESSION_VIEW_STATES,
  RUN_MESSAGE_VIEW_OUTCOMES,
  RUN_MESSAGE_VIEW_STATES,
  WORKFLOW_RUN_VIEW_ACCESS_LEVELS,
  WORKFLOW_RUN_VIEW_EFFORTS,
  WORKFLOW_RUN_VIEW_STATUSES
} from '../../../shared/workflow-run/workflow-run-view'
import {
  RUN_MESSAGE_OUTCOMES,
  RUN_MESSAGE_STATES
} from '../orchestration/db/autopilot-message-schema-definition'
import {
  AUTOPILOT_EFFORT_LEVELS,
  PRIMARY_SESSION_PERMISSION_MODES,
  PRIMARY_SESSION_STATES,
  WORKFLOW_RUN_ACCESS_LEVELS,
  WORKFLOW_RUN_STATUSES
} from '../orchestration/db/autopilot-run-schema-definition'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import { issueWorkbenchDesktopCaller } from '../workbench-caller'
import { settleWorkbenchLaunches, waitForWorkbenchLaunch } from '../workbench-intake-launch'
import { submitWorkbenchRequest } from '../workbench-intake-submit'
import { createFakePrimarySessionRuntime, seedLaunchedRun } from '../workbench-intake.test-fixture'
import {
  FIXTURE_ONLY_PRINCIPAL,
  FIXTURE_ONLY_WORKSPACE,
  createRuntimeHarness,
  type RuntimeHarness
} from '../workbench-routing/workbench-runtime.test-fixture'
import { setPrimarySessionRuntime } from '../workflow-run/primary-session-runtime'
import type { PrimarySessionStatus } from '../workflow-run/primary-session-status'
import {
  listWorkflowRunViews,
  requireWorkflowRun,
  toPrimarySessionLiveView,
  workflowRunView
} from './workbench-run-view-read'

let harness: RuntimeHarness | null = null

afterEach(async () => {
  await settleWorkbenchLaunches()
  setPrimarySessionRuntime(null)
  harness?.close()
  harness = null
})

function setup() {
  harness = createRuntimeHarness()
  setPrimarySessionRuntime(createFakePrimarySessionRuntime(harness.owner).runtime)
  return harness
}

const DESKTOP_PRINCIPAL = issueWorkbenchDesktopCaller().principalId

async function launch(
  h: RuntimeHarness,
  principalId = DESKTOP_PRINCIPAL,
  objective = 'Inspect this change.'
) {
  const target = {
    owner: h.owner,
    store: h.requests,
    principalId,
    workspace: FIXTURE_ONLY_WORKSPACE
  }
  const { request } = submitWorkbenchRequest(target, {
    workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
    objective,
    idempotencyKey: randomUUID()
  })
  await waitForWorkbenchLaunch(request.requestId)
  const run = getWorkflowRunStore(h.owner).getByRequestId(request.requestId)
  if (!run) {
    throw new Error('fixture run')
  }
  return run
}

describe('the shared view names exactly the values main stores', () => {
  it.each([
    ['run statuses', WORKFLOW_RUN_VIEW_STATUSES, WORKFLOW_RUN_STATUSES],
    ['access levels', WORKFLOW_RUN_VIEW_ACCESS_LEVELS, WORKFLOW_RUN_ACCESS_LEVELS],
    ['efforts', WORKFLOW_RUN_VIEW_EFFORTS, AUTOPILOT_EFFORT_LEVELS],
    ['owner states', PRIMARY_SESSION_VIEW_STATES, PRIMARY_SESSION_STATES],
    ['permission modes', PRIMARY_SESSION_VIEW_PERMISSION_MODES, PRIMARY_SESSION_PERMISSION_MODES],
    ['message outcomes', RUN_MESSAGE_VIEW_OUTCOMES, RUN_MESSAGE_OUTCOMES],
    ['message states', RUN_MESSAGE_VIEW_STATES, RUN_MESSAGE_STATES]
  ])('%s', (_name, shared, main) => {
    expect([...shared]).toEqual([...main])
  })
})

describe('workflowRunView', () => {
  it('shows a launched desktop run with its objective and primary, and nothing internal', async () => {
    const h = setup()
    const run = await launch(h)
    const view = workflowRunView(h.owner, run)
    expect(view).toMatchObject({
      runId: run.runId,
      requestId: run.requestId,
      origin: 'desktop',
      objective: 'Inspect this change.',
      status: 'active',
      coordinator: { model: 'claude-opus-5-5', effort: 'max' },
      primary: { generation: 1, state: 'running', paneKey: `pane_${run.runId}:1`, live: null }
    })
    const text = JSON.stringify(view)
    for (const internal of [
      run.workspaceBinding,
      `terminal_${run.runId}`,
      `incarnation_${run.runId}`,
      'a'.repeat(64)
    ]) {
      expect(text).not.toContain(internal)
    }
  })

  it('names dot as the origin of a dot submission', async () => {
    const h = setup()
    const run = await launch(h, DOT_INGRESS_PRINCIPAL_ID)
    expect(workflowRunView(h.owner, run).origin).toBe('dot')
  })

  it('reads a run with no receipt as unknown origin with no objective', () => {
    const h = setup()
    const run = seedLaunchedRun(h.owner, {
      requestId: 'request_without_receipt',
      workspaceId: FIXTURE_ONLY_WORKSPACE.workspaceId,
      workspaceBinding: 'c'.repeat(64),
      objective: 'x',
      requestedAccess: 'read_only',
      deliverableLanguage: null
    })
    expect(workflowRunView(h.owner, run)).toMatchObject({ origin: 'unknown', objective: null })
  })

  it('maps every live status and drops the handle', () => {
    const statuses: PrimarySessionStatus[] = [
      { kind: 'live', handle: 'term_a', activity: 'working' },
      { kind: 'agent_absent', handle: 'term_a' },
      { kind: 'unverifiable', reason: 'status_unreadable' },
      { kind: 'starting' },
      { kind: 'ended', state: 'stopped' }
    ]
    expect(statuses.map(toPrimarySessionLiveView)).toEqual([
      { kind: 'live', activity: 'working' },
      { kind: 'agent_absent' },
      { kind: 'unverifiable', reason: 'status_unreadable' },
      { kind: 'starting' },
      { kind: 'ended', state: 'stopped' }
    ])
  })

  it('refuses an unknown run id', () => {
    const h = setup()
    expect(() => requireWorkflowRun(h.owner, 'run_missing')).toThrow(
      expect.objectContaining({ code: 'workbench_run_not_found' })
    )
  })
})

describe('listWorkflowRunViews', () => {
  it('lists newest first, pages with hasMore and filters by workspace', async () => {
    const h = setup()
    const runs: WorkflowRunRecord[] = []
    for (let index = 0; index < 3; index += 1) {
      runs.push(await launch(h, FIXTURE_ONLY_PRINCIPAL, `Plan item ${index}.`))
    }
    const page = listWorkflowRunViews(h.owner, { limit: 2 })
    expect(page.hasMore).toBe(true)
    // Why by id: the fixture stamps every run with the same time, so the id breaks the tie.
    expect(page.runs.map((run) => run.runId)).toEqual([runs[2]?.runId, runs[1]?.runId])
    const all = listWorkflowRunViews(h.owner, { limit: 10 })
    expect(all.hasMore).toBe(false)
    expect(all.runs.map((run) => run.primary?.live)).toEqual([null, null, null])
    expect(listWorkflowRunViews(h.owner, { workspaceId: 'other::repo', limit: 10 }).runs).toEqual(
      []
    )
  })
})
