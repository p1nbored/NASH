import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import type { OrchestrationDb } from './orchestration-db'
import { OrchestrationError } from '../orchestration-error'
import type { WorkbenchLocalWorkspace } from '../../workbench-local-workspace'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import { WORKBENCH_WORKFLOW_RUN_ID_MAX_LENGTH } from './workbench-request-schema-definition'
import {
  WORKBENCH_REQUEST_COLUMNS as COLUMNS,
  projectWorkbenchRequest,
  storedWorkbenchStatus
} from './workbench-request-projection'
import { transitionWorkbenchRequest } from './workbench-request-transition'
import { cancelWorkbenchRequestRow } from './workbench-request-cancel'
import { submitWorkbenchRequestRow } from './workbench-request-submit-transaction'
import { workbenchRequestSettingsFrom } from './workbench-request-settings'
import { requireIdleWorkbenchConnection } from './workbench-connection-guard'
import {
  WorkbenchRequestTargetSchema,
  WorkbenchRevisionTargetSchema,
  requireWorkbenchPrincipal,
  resolveWorkbenchRequestScope,
  type WorkbenchRequestScope,
  type WorkbenchRevisionTarget
} from './workbench-request-scope'
import { RouteBlockerSchema, type RoutingStatus } from '../../../../shared/clef/clef-route-contract'
import type {
  WorkbenchRequest,
  WorkbenchListResult,
  WorkbenchSubmitResult,
  WorkbenchCancelResult
} from '../../../../shared/workbench-request'
import {
  WorkbenchSubmitParams,
  WorkbenchListParams,
  WorkbenchCancelParams,
  type WorkbenchSubmitInput,
  type WorkbenchListInput,
  type WorkbenchCancelInput
} from '../../../../shared/rpc-contract/workbench-params'

export {
  WORKBENCH_PENDING_REQUEST_LIMIT,
  WORKBENCH_TOTAL_REQUEST_LIMIT
} from './workbench-request-submit-transaction'

/** Routing status summary computed from configuration by the caller. */
export type WorkbenchRoutingSummary = { status: RoutingStatus; dispatch: boolean }

const NOT_CONFIGURED_ROUTING: WorkbenchRoutingSummary = {
  status: 'not_configured',
  dispatch: false
}

const RunIdSchema = z.string().min(1).max(WORKBENCH_WORKFLOW_RUN_ID_MAX_LENGTH)
const LaunchBlockerSchema = RouteBlockerSchema.refine(
  (blocker) => blocker.reason === 'launch_blocked',
  'A launch is blocked only with the launch_blocked reason'
)

/** One launch step the intake door takes (D-016 section 1.3); the view hides which stored state it is. */
export const WorkbenchLaunchChangeSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('LAUNCHING') }).strict(),
  z.object({ to: z.literal('LAUNCHED'), workflowRunId: RunIdSchema }).strict(),
  z
    .object({
      to: z.literal('LAUNCH_BLOCKED'),
      blocker: LaunchBlockerSchema,
      workflowRunId: RunIdSchema.optional()
    })
    .strict(),
  z.object({ to: z.literal('CANCELED') }).strict()
])
export type WorkbenchLaunchChange = z.input<typeof WorkbenchLaunchChangeSchema>

const stores = new WeakMap<OrchestrationDb, WorkbenchRequestStore>()

export function getWorkbenchRequestStore(owner: OrchestrationDb): WorkbenchRequestStore {
  let store = stores.get(owner)
  if (!store) {
    store = new WorkbenchRequestStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

function revisionConflict(): OrchestrationError {
  return new OrchestrationError(
    'workbench_revision_conflict',
    'Request revision changed. Refresh before changing it.'
  )
}

/** The intake receipt (D-016): it extends the host's DB and holds no execution state. */
export class WorkbenchRequestStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date()
  ) {
    ensureWorkbenchRequestSchema(db)
  }

  private transaction<T>(operation: () => T): T {
    requireIdleWorkbenchConnection(this.db)
    return runLifecycleWriteTransaction(this.db, 'workbench_request', operation)
  }

  private row(scope: WorkbenchRequestScope, requestId: string): Record<string, unknown> {
    const row = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM workbench_requests r WHERE r.principal_id = ? AND r.workspace_id = ? AND r.workspace_binding = ? AND r.request_id = ?`
      )
      .get(scope.principalId, scope.workspaceId, scope.workspaceBinding, requestId)
    if (!row) {
      throw new OrchestrationError(
        'workbench_request_not_found',
        'Request was not found in this caller and workspace scope.'
      )
    }
    return row
  }

  /** Records a RECEIVED request, or replays its key; launching it is the intake door's next step. */
  submit(
    principalId: string,
    input: WorkbenchSubmitInput,
    workspace: WorkbenchLocalWorkspace
  ): WorkbenchSubmitResult {
    requireWorkbenchPrincipal(principalId)
    const params = WorkbenchSubmitParams.parse(input)
    const settings = workbenchRequestSettingsFrom(params)
    const scope = resolveWorkbenchRequestScope(principalId, params.workspaceId, workspace)
    return this.transaction(() => {
      const { requestId, duplicate } = submitWorkbenchRequestRow(this.db, {
        ...scope,
        idempotencyKey: params.idempotencyKey,
        objective: params.objective,
        settings,
        timestamp: this.now().toISOString()
      })
      const request = projectWorkbenchRequest(this.row(scope, requestId))
      if (request.objective !== params.objective || request.workspaceId !== params.workspaceId) {
        throw new OrchestrationError(
          'workbench_recovery_required',
          'Storage did not preserve the request text. Registration was rolled back.'
        )
      }
      return { request, duplicate }
    })
  }

  list(
    principalId: string,
    input: WorkbenchListInput,
    workspace: WorkbenchLocalWorkspace,
    routing: WorkbenchRoutingSummary = NOT_CONFIGURED_ROUTING
  ): WorkbenchListResult {
    requireIdleWorkbenchConnection(this.db)
    const params = WorkbenchListParams.parse(input)
    const scope = resolveWorkbenchRequestScope(principalId, params.workspaceId, workspace)
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM workbench_requests r
      WHERE r.principal_id = ? AND r.workspace_id = ? AND r.workspace_binding = ? AND r.sequence < ? ORDER BY r.sequence DESC LIMIT ?`)
      .all(
        scope.principalId,
        scope.workspaceId,
        scope.workspaceBinding,
        params.beforeSequence ?? Number.MAX_SAFE_INTEGER,
        params.limit + 1
      )
    const hasMore = rows.length > params.limit
    const requests = rows.slice(0, params.limit).map(projectWorkbenchRequest)
    return {
      requests,
      nextBeforeSequence: hasMore ? (requests.at(-1)?.sequence ?? null) : null,
      capabilities: {
        submit: true,
        cancelPending: true,
        dispatch: routing.dispatch && routing.status === 'ready'
      },
      blocker: routing.status
    }
  }

  /** Reads one request inside the caller and workspace scope. */
  get(
    principalId: string,
    input: { workspaceId: string; requestId: string },
    workspace: WorkbenchLocalWorkspace
  ): WorkbenchRequest {
    requireIdleWorkbenchConnection(this.db)
    const { workspaceId, requestId } = WorkbenchRequestTargetSchema.parse(input)
    const scope = resolveWorkbenchRequestScope(principalId, workspaceId, workspace)
    return projectWorkbenchRequest(this.row(scope, requestId))
  }

  /** Cancels a received or launch-blocked request; a launched one is refused as handed off. */
  cancel(
    principalId: string,
    input: WorkbenchCancelInput,
    workspace: WorkbenchLocalWorkspace
  ): WorkbenchCancelResult {
    requireWorkbenchPrincipal(principalId)
    const params = WorkbenchCancelParams.parse(input)
    const scope = resolveWorkbenchRequestScope(principalId, params.workspaceId, workspace)
    return this.transaction(() => {
      const current = this.row(scope, params.requestId)
      const request = projectWorkbenchRequest(current)
      if (request.status === 'CANCELED') {
        return { request, changed: false }
      }
      if (request.revision !== params.expectedRevision) {
        throw revisionConflict()
      }
      cancelWorkbenchRequestRow(
        this.db,
        {
          requestId: request.requestId,
          status: storedWorkbenchStatus(current),
          revision: request.revision
        },
        this.now().toISOString()
      )
      return { request: projectWorkbenchRequest(this.row(scope, params.requestId)), changed: true }
    })
  }

  /**
   * One launch step for the intake door (D3): RECEIVED to LAUNCHING to LAUNCHED or LAUNCH_BLOCKED,
   * and CANCELED once the door has stopped a launched run. Scoped and revision-fenced.
   */
  advance(
    principalId: string,
    input: WorkbenchRevisionTarget,
    workspace: WorkbenchLocalWorkspace,
    change: WorkbenchLaunchChange
  ): WorkbenchRequest {
    const target = WorkbenchRevisionTargetSchema.parse(input)
    const scope = resolveWorkbenchRequestScope(principalId, target.workspaceId, workspace)
    const parsed = WorkbenchLaunchChangeSchema.safeParse(change)
    if (!parsed.success) {
      throw new OrchestrationError('workbench_invalid_input', 'The launch change is not valid.')
    }
    const step = parsed.data
    return this.transaction(() => {
      const current = this.row(scope, target.requestId)
      const from = storedWorkbenchStatus(current)
      if (Number(current.revision) !== target.expectedRevision) {
        throw revisionConflict()
      }
      if (
        step.to === 'LAUNCH_BLOCKED' &&
        step.workflowRunId !== undefined &&
        from !== 'LAUNCHING'
      ) {
        throw new OrchestrationError(
          'workbench_invalid_input',
          'Only a launching request can have created a run.'
        )
      }
      transitionWorkbenchRequest(this.db, {
        requestId: target.requestId,
        from,
        expectedRevision: target.expectedRevision,
        to: step.to,
        blocker: step.to === 'LAUNCH_BLOCKED' ? step.blocker : null,
        workflowRunId: 'workflowRunId' in step ? (step.workflowRunId ?? null) : null,
        timestamp: this.now().toISOString()
      })
      return projectWorkbenchRequest(this.row(scope, target.requestId))
    })
  }
}
