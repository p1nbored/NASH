import { z } from 'zod'
import type { AwaitingValidationEntry } from '../orchestration/db/app-attempt-queries'
import { getExecutorProcessStore } from '../orchestration/db/executor-process-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getTaskRouteStore, type TaskRouteRecord } from '../orchestration/db/task-route-store'
import type { TaskSpecRecord } from '../orchestration/db/task-spec-record'
import { getTaskSpecStore } from '../orchestration/db/task-spec-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { placementFromEvidence } from '../task-execution/attempt-workspace'
import { readSessionReport, type SessionReport } from './session-report'
import type { AttemptEvidence, ResolvedWorkspace } from './validation-context'

// Read-only facts about one claimed attempt; every decision goes through the task validation port.

/** Wired by the host; a workspace that is remote, missing or unknown resolves to null. */
export type ValidationRootsPort = {
  resolveWorkspace(workspaceId: string): Promise<ResolvedWorkspace | null>
  /** The absolute directory a recorded, app-relative run directory names, or null. */
  resolveRunDirectory(relativeRunDirectory: string): string | null
}

export type AttemptFacts = {
  readonly evidence: AttemptEvidence
  readonly spec: TaskSpecRecord
  /** The English objective Orca's task row holds. */
  readonly objective: string
  /** The model that did the work: the route's, or the coordinator's when the route inherits it. */
  readonly workModel: string
  /** Who ran the attempt by its route; null for a task the primary kept (not delegated). */
  readonly routeTarget: TaskRouteRecord['target']
  readonly workspaceId: string
  /** The primary's task-report for an in-session attempt; null for an attempt that ran in a process. */
  readonly sessionReport: SessionReport | null
}

const StartOptionsSchema = z.object({ route_id: z.string() })
const SQLITE_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** Orca's own rows use SQLite's `datetime('now')`, which is UTC without a zone marker. */
function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(SQLITE_UTC.test(value) ? `${value.replace(' ', 'T')}Z` : value)
  return Number.isNaN(parsed) ? null : parsed
}

function routeIdOf(startOptions: string | undefined): string | null {
  try {
    const parsed = StartOptionsSchema.safeParse(JSON.parse(startOptions ?? ''))
    return parsed.success ? parsed.data.route_id : null
  } catch {
    return null
  }
}

function workModelOf(route: TaskRouteRecord | null, coordinatorModel: string): string {
  return route?.model && route.model !== 'inherit' ? route.model : coordinatorModel
}

export function createAttemptReader(
  owner: OrchestrationDb,
  roots: ValidationRootsPort
): { read(entry: AwaitingValidationEntry): Promise<AttemptFacts | null> } {
  const specs = getTaskSpecStore(owner)
  const executors = getExecutorProcessStore(owner)
  const routes = getTaskRouteStore(owner)
  const runs = getWorkflowRunStore(owner)
  return {
    async read(entry) {
      const spec = specs.get(entry.taskId)
      const task = owner.getTask(entry.taskId)
      const dispatch = owner.getDispatchContextById(entry.dispatchId)
      const run = runs.get(entry.runId)
      if (!spec || !task || !dispatch || !run) {
        return null
      }
      const executor = executors.get(entry.dispatchId)
      const routeId =
        executor?.routeId ?? routeIdOf(owner.getWorkerDispatch(entry.dispatchId)?.start_options)
      const route = routeId ? routes.get(routeId) : routes.latestForTask(entry.taskId)
      const placement = placementFromEvidence(executor?.executableEvidence ?? null)
      // D-025: a write attempt is validated in the worktree it wrote in, never the run worktree.
      const workspaceId =
        placement?.mode === 'own_worktree' ? placement.worktree.worktreeId : run.workspaceId
      return {
        spec,
        objective: task.spec,
        workModel: workModelOf(route, run.coordinatorModel),
        routeTarget: route?.target ?? null,
        workspaceId: run.workspaceId,
        sessionReport: executor ? null : readSessionReport(owner, entry),
        evidence: {
          taskId: entry.taskId,
          runId: entry.runId,
          dispatchId: entry.dispatchId,
          executor,
          startedAtMs: parseTimestamp(executor?.startedAt ?? dispatch.created_at),
          workspace: await roots.resolveWorkspace(workspaceId),
          placement,
          runDirectory: executor ? roots.resolveRunDirectory(executor.runDirectory) : null
        }
      }
    }
  }
}
