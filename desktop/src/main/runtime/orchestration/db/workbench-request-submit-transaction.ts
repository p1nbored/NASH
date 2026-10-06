import { createHash, randomUUID } from 'node:crypto'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { workbenchSqlList } from './workbench-request-schema-definition'
import { insertWorkbenchRequest } from './workbench-request-transition'
import {
  insertWorkbenchRequestSettings,
  readWorkbenchRequestSettings,
  sameWorkbenchRequestSettings,
  type WorkbenchRequestSettings
} from './workbench-request-settings'

export const WORKBENCH_PENDING_REQUEST_LIMIT = 200
export const WORKBENCH_TOTAL_REQUEST_LIMIT = 10_000
/** Receipts not yet launched or canceled count toward a workspace's pending capacity. */
const PENDING_STATUSES = ['RECEIVED', 'LAUNCHING', 'LAUNCH_BLOCKED'] as const

export type WorkbenchSubmitRow = {
  readonly principalId: string
  readonly workspaceId: string
  readonly workspaceBinding: string
  readonly idempotencyKey: string
  readonly objective: string
  readonly settings: WorkbenchRequestSettings
  readonly timestamp: string
}

// Why: the hash keeps its original schemaVersion 1 bytes so keys stored before v3 still replay.
export function workbenchInputHash(row: WorkbenchSubmitRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: row.workspaceId,
        workspaceBinding: row.workspaceBinding,
        objective: row.objective
      })
    )
    .digest('hex')
}

function requireCapacity(db: Database.Database, workspaceId: string, binding: string): void {
  const count = db
    .prepare(
      `SELECT count(*) AS total, sum(CASE WHEN workspace_id = ? AND workspace_binding = ? AND status IN (${workbenchSqlList(PENDING_STATUSES)}) THEN 1 ELSE 0 END) AS pending FROM workbench_requests`
    )
    .get(workspaceId, binding)
  if (
    Number(count?.total) >= WORKBENCH_TOTAL_REQUEST_LIMIT ||
    Number(count?.pending) >= WORKBENCH_PENDING_REQUEST_LIMIT
  ) {
    throw new OrchestrationError(
      'workbench_capacity_exceeded',
      'Workbench request retention or pending capacity has been reached.'
    )
  }
}

function conflict(): OrchestrationError {
  return new OrchestrationError(
    'workbench_idempotency_conflict',
    'The idempotency key is already bound to different request bytes or scope.'
  )
}

/**
 * Runs inside the store transaction: replays a known key, refusing different bytes, scope, access
 * or deliverable language, or records a new RECEIVED request with its settings.
 */
export function submitWorkbenchRequestRow(
  db: Database.Database,
  row: WorkbenchSubmitRow
): { requestId: string; duplicate: boolean } {
  const inputHash = workbenchInputHash(row)
  const prior = db
    .prepare(
      'SELECT request_id, workspace_id, input_hash FROM workbench_requests WHERE principal_id = ? AND idempotency_key = ?'
    )
    .get(row.principalId, row.idempotencyKey)
  if (prior) {
    const requestId = String(prior.request_id)
    if (prior.input_hash !== inputHash || prior.workspace_id !== row.workspaceId) {
      throw conflict()
    }
    if (!sameWorkbenchRequestSettings(readWorkbenchRequestSettings(db, requestId), row.settings)) {
      throw conflict()
    }
    return { requestId, duplicate: true }
  }
  requireCapacity(db, row.workspaceId, row.workspaceBinding)
  const requestId = randomUUID()
  insertWorkbenchRequest(db, {
    requestId,
    workspaceId: row.workspaceId,
    workspaceBinding: row.workspaceBinding,
    principalId: row.principalId,
    idempotencyKey: row.idempotencyKey,
    inputHash,
    objective: row.objective,
    timestamp: row.timestamp
  })
  insertWorkbenchRequestSettings(db, requestId, row.settings)
  return { requestId, duplicate: false }
}
