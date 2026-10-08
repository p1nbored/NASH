import type { ClefStateInput } from '../../clef/clef-state-builder'
import type { LiveRunPrimary } from '../../routing-table/availability/route-availability-types'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getTaskSpecStore } from '../orchestration/db/task-spec-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'

/** The TaskSpec being classified and the run facts its spend, records and route lookup need. */
export type ClassificationSubject = {
  readonly taskId: string
  readonly runId: string
  /** The run's Workbench request: production spend rows and raw responses belong to it. */
  readonly requestId: string
  readonly workspaceId: string
  /** The table the run launched with; a TaskSpec the primary keeps names it, since nothing is looked up. */
  readonly runTable: { readonly version: number; readonly sha256: string }
  readonly liveRunPrimary: LiveRunPrimary | null
  /** The TaskSpec fields passed to Clef. */
  readonly taskSpec: ClefStateInput
}

/** Reads one TaskSpec and its run; refuses a task with no TaskSpec, or one whose run is not active. */
export function loadClassificationSubject(
  owner: OrchestrationDb,
  taskId: string
): ClassificationSubject {
  const spec = getTaskSpecStore(owner).get(taskId)
  const task = spec === null || spec.orphaned ? undefined : owner.getTask(taskId)
  if (spec === null || task === undefined) {
    throw new OrchestrationError(
      'autopilot_task_spec_not_found',
      'The task has no TaskSpec to classify.'
    )
  }
  const run = getWorkflowRunStore(owner).get(spec.runId)
  if (run === null) {
    throw new OrchestrationError('autopilot_run_not_found', 'The run was not found.')
  }
  if (run.status !== 'active') {
    throw new OrchestrationError(
      'autopilot_run_not_live',
      'A TaskSpec is classified only while its run is active.'
    )
  }
  const primary = getPrimarySessionStore(owner).findLiveByRun(run.runId)
  return {
    taskId,
    runId: run.runId,
    requestId: run.requestId,
    workspaceId: run.workspaceId,
    runTable: { version: run.routingTableVersion, sha256: run.routingTableSha256 },
    // Why running only: an unverifiable owner is no evidence that the session's login is live (D-020).
    liveRunPrimary:
      primary?.state === 'running'
        ? {
            runId: run.runId,
            ownerId: primary.ownerId,
            agent: run.coordinatorAgent,
            model: run.coordinatorModel,
            effort: run.coordinatorEffort
          }
        : null,
    taskSpec: {
      objective: task.spec,
      expectedOutputs: spec.expectedOutputs,
      acceptanceCriteria: spec.acceptanceCriteria,
      explicitConstraints: spec.constraints
    }
  }
}
