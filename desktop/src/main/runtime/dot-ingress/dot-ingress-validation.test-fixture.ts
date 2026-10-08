// FIXTURE_ONLY: every id, hash, path and model below is synthetic and describes no real run.
import type { AppRunHarness } from '../orchestration/db/app-attempt.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { submitDotRequest } from './dot-ingress-intake'
import { fixtureUuid, type DotHarness } from './dot-ingress-service.test-fixture'

export type DotValidationRun = { readonly harness: AppRunHarness; readonly dotRequestId: string }

/** An Orca run with its workflow run, started for `requestId` (a Workbench request id). */
export function seedWorkflowRun(dot: DotHarness, requestId: string): AppRunHarness {
  const orcaRun = dot.owner.createRun({
    objective: 'Fixture run objective.',
    coordinatorHandle: null,
    coordinatorPaneKey: null
  })
  const runs = getWorkflowRunStore(dot.owner)
  runs.create({
    runId: orcaRun.id,
    requestId,
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
  return { owner: dot.owner, runId: orcaRun.id }
}

/**
 * A dot request whose Workbench request started an Orca run the task fixtures can use: the door
 * records the request without launching, and the run is created here under its request id.
 */
export async function dotStartedRun(dot: DotHarness, key = 1): Promise<DotValidationRun> {
  dot.door.launch = 'received'
  const { record } = await submitDotRequest(
    dot.deps,
    dot.submitRequest({ idempotencyKey: fixtureUuid(key) })
  )
  if (record.workbenchRequestId === null) {
    throw new Error('the fixture door did not accept the request')
  }
  return {
    harness: seedWorkflowRun(dot, record.workbenchRequestId),
    dotRequestId: record.dotRequestId
  }
}
