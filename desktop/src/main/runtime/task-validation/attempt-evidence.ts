import { z } from 'zod'
import type { AwaitingValidationEntry } from '../orchestration/db/app-attempt-queries'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getTaskRouteStore, type TaskRouteRecord } from '../orchestration/db/task-route-store'
import type { TaskSpecRecord } from '../orchestration/db/task-spec-record'
import { getTaskSpecStore } from '../orchestration/db/task-spec-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { isNativeTaskAttempt } from '../workflow-run/app-run-policy'
import { readSessionReport, type SessionReport } from './session-report'
import type { AttemptEvidence, ResolvedWorkspace } from './validation-context'

// Read-only facts about one claimed attempt; every decision goes through the task validation port.

/** Wired by the host; a workspace that is remote, missing or unknown resolves to null. */
export type ValidationRootsPort = {
  resolveWorkspace(workspaceId: string): Promise<ResolvedWorkspace | null>
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
  /** The primary's task-report for this in-session attempt. */
  readonly sessionReport: SessionReport
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
  const routes = getTaskRouteStore(owner)
  const runs = getWorkflowRunStore(owner)
  return {
    async read(entry) {
      if (isNativeTaskAttempt(owner, entry.dispatchId)) {
        return null
      }
      const spec = specs.get(entry.taskId)
      const task = owner.getTask(entry.taskId)
      const dispatch = owner.getDispatchContextById(entry.dispatchId)
      const run = runs.get(entry.runId)
      if (!spec || !task || !dispatch || !run) {
        return null
      }
      const routeId = routeIdOf(owner.getWorkerDispatch(entry.dispatchId)?.start_options)
      const route = routeId ? routes.get(routeId) : routes.latestForTask(entry.taskId)
      return {
        spec,
        objective: task.spec,
        workModel: workModelOf(route, run.coordinatorModel),
        routeTarget: route?.target ?? null,
        workspaceId: run.workspaceId,
        sessionReport: readSessionReport(owner, entry),
        evidence: {
          taskId: entry.taskId,
          runId: entry.runId,
          dispatchId: entry.dispatchId,
          startedAtMs: parseTimestamp(dispatch.created_at),
          workspace: await roots.resolveWorkspace(run.workspaceId)
        }
      }
    }
  }
}
