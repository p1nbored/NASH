import {
  WorkflowRunViewSchema,
  type PrimarySessionLiveView,
  type PrimarySessionView,
  type WorkflowRunView
} from '../../../shared/workflow-run/workflow-run-view'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { PrimarySessionStatus } from '../workflow-run/primary-session-status'
import { readWorkflowRunOrigin } from '../workflow-run/workflow-run-origin'

/** The live status without the terminal handle, which stays in main. */
export function toPrimarySessionLiveView(status: PrimarySessionStatus): PrimarySessionLiveView {
  switch (status.kind) {
    case 'live':
      return { kind: 'live', activity: status.activity }
    case 'agent_absent':
      return { kind: 'agent_absent' }
    case 'unverifiable':
      return { kind: 'unverifiable', reason: status.reason }
    case 'starting':
      return { kind: 'starting' }
    case 'ended':
      return { kind: 'ended', state: status.state }
  }
}

function primaryView(
  owner: PrimarySessionRecord,
  live: PrimarySessionStatus | null
): PrimarySessionView {
  return {
    generation: owner.generation,
    state: owner.state,
    permissionMode: owner.permissionMode,
    model: owner.requestedModel,
    effort: owner.requestedEffort,
    paneKey: owner.paneKey,
    endReason: owner.endReason,
    startedAt: owner.startedAt,
    updatedAt: owner.updatedAt,
    endedAt: owner.endedAt,
    live: live === null ? null : toPrimarySessionLiveView(live)
  }
}

/** The objective from the intake receipt; read-only, so a missing receipt table is never created. */
function receiptObjective(owner: OrchestrationDb, requestId: string): string | null {
  const table = owner.db
    .prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'workbench_requests'"
    )
    .get()
  if (!table) {
    return null
  }
  const row = owner.db
    .prepare('SELECT objective FROM workbench_requests WHERE request_id = ?')
    .get(requestId)
  return typeof row?.objective === 'string' ? row.objective : null
}

/**
 * The desktop view of one run. `live` comes from the terminal for `show`; a list passes null. The
 * view is parsed strictly, so a field the shared contract does not name can never leave main.
 */
export function workflowRunView(
  owner: OrchestrationDb,
  run: WorkflowRunRecord,
  read: {
    readonly owner: PrimarySessionRecord
    readonly status: PrimarySessionStatus
  } | null = null
): WorkflowRunView {
  const origin = readWorkflowRunOrigin(owner, run.runId)
  const session = read?.owner ?? getPrimarySessionStore(owner).latestForRun(run.runId)
  return WorkflowRunViewSchema.parse({
    runId: run.runId,
    requestId: run.requestId,
    origin: origin.found ? origin.origin : 'unknown',
    workspaceId: run.workspaceId,
    objective: receiptObjective(owner, run.requestId),
    status: run.status,
    revision: run.revision,
    requestedAccess: run.requestedAccess,
    deliverableLanguage: run.deliverableLanguage,
    routingTable: { version: run.routingTableVersion, sha256: run.routingTableSha256 },
    coordinator: { model: run.coordinatorModel, effort: run.coordinatorEffort },
    endReason: run.endReason,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    endedAt: run.endedAt,
    primary: session === null ? null : primaryView(session, read?.status ?? null)
  })
}

export function requireWorkflowRun(owner: OrchestrationDb, runId: string): WorkflowRunRecord {
  const run = getWorkflowRunStore(owner).get(runId)
  if (!run) {
    throw new OrchestrationError('workbench_run_not_found', 'The run was not found.')
  }
  return run
}

/** Newest first, optionally for one workspace; stored records only, so no terminal is read. */
export function listWorkflowRunViews(
  owner: OrchestrationDb,
  input: { readonly workspaceId?: string | undefined; readonly limit: number }
): { runs: WorkflowRunView[]; hasMore: boolean } {
  const store = getWorkflowRunStore(owner)
  const workspaceId = input.workspaceId ?? null
  const ids = owner.db
    .prepare(
      'SELECT run_id FROM workflow_runs WHERE (? IS NULL OR workspace_id = ?) ORDER BY created_at DESC, run_id DESC LIMIT ?'
    )
    .all(workspaceId, workspaceId, input.limit + 1)
    .map((row) => String(row.run_id))
  const runs = ids
    .slice(0, input.limit)
    .map((runId) => store.get(runId))
    .filter((run): run is WorkflowRunRecord => run !== null)
    .map((run) => workflowRunView(owner, run))
  return { runs, hasMore: ids.length > input.limit }
}
