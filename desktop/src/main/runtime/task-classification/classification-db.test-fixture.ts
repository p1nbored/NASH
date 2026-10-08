// FIXTURE_ONLY: a memory database holding one Workbench request, its active app run and TaskSpecs.
// Every id, hash, path and model is synthetic; nothing here touches a network, a CLI or a credential.
import { randomUUID } from 'node:crypto'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getTaskSpecStore, type TaskSpecRecord } from '../orchestration/db/task-spec-store'
import { getWorkbenchRequestStore } from '../orchestration/db/workbench-request-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import type { WorkbenchLocalWorkspace } from '../workbench-local-workspace'

export const FIXTURE_CLASSIFY_WORKSPACE: WorkbenchLocalWorkspace = {
  workspaceId: 'folder:fixture-classify',
  projectId: 'fixture-group',
  projectKind: 'folder-group',
  hostId: 'local',
  path: '/fixture/classify'
}
export const FIXTURE_RUN_TABLE = { version: 1, sha256: 'b'.repeat(64) } as const
export const FIXTURE_TASK_OBJECTIVE =
  'Add a retry button to the queue view and cover it with a test.'
const FIXTURE_EPOCH_MS = Date.parse('2026-10-05T09:00:00.000Z')

export function fixtureClassifyTime(offsetSeconds = 0): string {
  return new Date(FIXTURE_EPOCH_MS + offsetSeconds * 1000).toISOString()
}

export type ClassificationDbHarness = {
  readonly owner: OrchestrationDb
  readonly runId: string
  readonly requestId: string
}

/** A Workbench request (production spend needs one) and its active app run. */
export function createClassificationDbHarness(): ClassificationDbHarness {
  const owner = new OrchestrationDb(':memory:')
  const requestId = getWorkbenchRequestStore(owner).submit(
    'fixture-ui',
    {
      workspaceId: FIXTURE_CLASSIFY_WORKSPACE.workspaceId,
      objective: 'Classify the fixture TaskSpecs.',
      idempotencyKey: randomUUID()
    },
    FIXTURE_CLASSIFY_WORKSPACE
  ).request.requestId
  const orcaRun = owner.createRun({
    objective: 'Fixture run objective.',
    coordinatorHandle: null,
    coordinatorPaneKey: null
  })
  const runs = getWorkflowRunStore(owner)
  runs.create({
    runId: orcaRun.id,
    requestId,
    workspaceId: FIXTURE_CLASSIFY_WORKSPACE.workspaceId,
    workspaceBinding: 'a'.repeat(64),
    requestedAccess: 'read_only',
    routingTableVersion: FIXTURE_RUN_TABLE.version,
    routingTableSha256: FIXTURE_RUN_TABLE.sha256,
    coordinatorAgent: 'claude',
    coordinatorModel: 'claude-opus-5-5',
    coordinatorEffort: 'max',
    timestamp: fixtureClassifyTime()
  })
  runs.transition({
    runId: orcaRun.id,
    from: 'launching',
    to: 'active',
    expectedRevision: 1,
    reason: null,
    timestamp: fixtureClassifyTime(1)
  })
  return { owner, runId: orcaRun.id, requestId }
}

/** One Orca task and its English TaskSpec, proposed the way the primary session proposes it. */
export function proposeFixtureTask(
  harness: ClassificationDbHarness,
  objective: string = FIXTURE_TASK_OBJECTIVE
): TaskSpecRecord & { readonly objective: string } {
  const { record } = getTaskSpecStore(harness.owner).propose({
    runId: harness.runId,
    objective,
    expectedOutputs: ['A retry button in the queue view.'],
    acceptanceCriteria: ['A unit test clicks the button and sees the request queued again.'],
    machineChecks: [],
    constraints: ['Change no other view.'],
    accessNeed: 'read_only',
    isolationNeed: 'none',
    workflowName: null,
    timestamp: fixtureClassifyTime(2)
  })
  return { ...record, objective }
}
