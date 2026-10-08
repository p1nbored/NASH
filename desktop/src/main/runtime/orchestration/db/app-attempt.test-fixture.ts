// FIXTURE_ONLY: every id, hash, path and model below is synthetic and describes no real run.
import { OrchestrationDb } from './orchestration-db'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import { fixtureTime } from './autopilot-runtime.test-fixture'
import { getTaskSpecStore, type TaskSpecInput } from './task-spec-store'
import { getWorkflowRunStore } from './workflow-run-store'

export type AppRunHarness = { owner: OrchestrationDb; runId: string }

export const FIXTURE_OBJECTIVE = 'Summarize the repository layout in a short report.'

/** A memory database holding the Workbench family, one Orca run and its active workflow run. */
export function createAppRunHarness(): AppRunHarness {
  const owner = new OrchestrationDb(':memory:')
  ensureWorkbenchRequestSchema(owner.db)
  const orcaRun = owner.createRun({
    objective: 'Fixture run objective.',
    coordinatorHandle: null,
    coordinatorPaneKey: null
  })
  const runs = getWorkflowRunStore(owner)
  runs.create({
    runId: orcaRun.id,
    requestId: `request_${orcaRun.id}`,
    workspaceId: 'fixture-repo::/fixture/repo',
    workspaceBinding: 'a'.repeat(64),
    requestedAccess: 'read_only',
    routingTableVersion: 1,
    routingTableSha256: 'b'.repeat(64),
    coordinatorAgent: 'claude',
    coordinatorModel: 'claude-opus-5-5',
    coordinatorEffort: 'max',
    timestamp: fixtureTime()
  })
  runs.transition({
    runId: orcaRun.id,
    from: 'launching',
    to: 'active',
    expectedRevision: 1,
    reason: null,
    timestamp: fixtureTime(1)
  })
  return { owner, runId: orcaRun.id }
}

export function specInput(
  taskId: string,
  runId: string,
  overrides: Partial<TaskSpecInput> = {}
): TaskSpecInput {
  return {
    taskId,
    runId,
    expectedOutputs: ['A report named `report.md`.'],
    acceptanceCriteria: ['The report names every top-level folder.'],
    machineChecks: [{ kind: 'artifact_exists', path: 'report.md' }],
    constraints: ['Do not modify any source file.'],
    accessNeed: 'read_only',
    isolationNeed: 'none',
    workflowName: null,
    timestamp: fixtureTime(2),
    ...overrides
  }
}

/** An Orca task plus its TaskSpec; tasks with unmet dependencies stay pending in Orca. */
export function seedTask(
  harness: AppRunHarness,
  options: { deps?: string[]; spec?: Partial<TaskSpecInput> } = {}
): { taskId: string } {
  const task = harness.owner.createTask({
    spec: FIXTURE_OBJECTIVE,
    runId: harness.runId,
    deps: options.deps
  })
  getTaskSpecStore(harness.owner).insert(specInput(task.id, harness.runId, options.spec))
  return { taskId: task.id }
}
