import type { OrchestrationDb } from '../orchestration/db'
import type { PermissionDecisionRecord } from '../orchestration/db/permission-decision-store'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { getTaskSpecStore } from '../orchestration/db/task-spec-store'
import { DOT_ALLOW_READ_TOOLS } from './permission-dot-allow'
import { OrchestrationError } from '../orchestration/orchestration-error'

export function requireChildAccess(db: OrchestrationDb, record: PermissionDecisionRecord): void {
  const dispatch = record.agentId ? db.getDispatchContextById(record.agentId) : undefined
  const spec = dispatch ? getTaskSpecStore(db).get(dispatch.task_id) : null
  if (spec?.accessNeed === 'read_only' && !DOT_ALLOW_READ_TOOLS.includes(record.toolName)) {
    throw new OrchestrationError(
      'autopilot_permission_caller_refused',
      'This child task is read-only. No effects were applied.',
      { effectsApplied: false }
    )
  }
}

export function permissionSource(
  db: OrchestrationDb,
  record: PermissionDecisionRecord
): { handle: string; incarnation: string } | null {
  const owner = getPrimarySessionStore(db).get(record.ownerId)
  const run = getWorkflowRunStore(db).get(record.runId)
  if (
    owner?.state !== 'running' ||
    !owner.terminalHandle ||
    !owner.processIncarnation ||
    !run ||
    !['launching', 'active', 'completing'].includes(run.status)
  ) {
    return null
  }
  if (record.agentId === null) {
    return { handle: owner.terminalHandle, incarnation: owner.processIncarnation }
  }
  const dispatch = db.getDispatchContextById(record.agentId)
  const worker = dispatch ? db.getWorkerDispatch(dispatch.id) : undefined
  if (
    !dispatch ||
    dispatch.run_id !== record.runId ||
    !dispatch.assignee_handle ||
    !dispatch.process_incarnation ||
    dispatch.capability_revoked_at ||
    !['pending', 'dispatched'].includes(dispatch.status) ||
    !worker ||
    !['starting', 'ready'].includes(worker.state)
  ) {
    return null
  }
  return { handle: dispatch.assignee_handle, incarnation: dispatch.process_incarnation }
}

export function isPermissionSourceLive(
  db: OrchestrationDb,
  record: PermissionDecisionRecord,
  original: { handle: string; incarnation: string | null } | undefined,
  readIncarnation?: (handle: string) => string | null
): boolean {
  const source = permissionSource(db, record)
  return (
    source !== null &&
    original !== undefined &&
    original.handle === source.handle &&
    original.incarnation === source.incarnation &&
    (!readIncarnation || readIncarnation(source.handle) === source.incarnation)
  )
}
