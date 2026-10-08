import { randomUUID } from 'node:crypto'
import type { OrchestrationDb } from '../orchestration/db'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import {
  getWorkflowRunStore,
  WorkflowRunCreateSchema,
  type WorkflowRunCreate
} from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { isEquivalentPaneKey } from '../orchestration/db/pane-key-match'
import type { NativeCoordinatorAuthority } from './native-coordinator-adoption'

/** The native Run remains authoritative; these rows only supply task routing and approval ownership. */
export function recordNativeCoordinator(
  db: OrchestrationDb,
  input: WorkflowRunCreate & { authority: NativeCoordinatorAuthority }
) {
  const { authority, ...fields } = input
  const params = WorkflowRunCreateSchema.parse(fields)
  const runs = getWorkflowRunStore(db)
  const sessions = getPrimarySessionStore(db)
  const current = db.getCurrentRunForCoordinator({
    terminalHandle: authority.terminalHandle,
    paneKey: authority.paneKey,
    orcaSessionId: null
  })
  if (current?.id !== params.runId) {
    throw new OrchestrationError('consumer_fenced', 'The coordinator binding changed.')
  }
  const existing = runs.get(params.runId)
  if (
    existing &&
    (existing.workspaceBinding !== params.workspaceBinding ||
      (existing.requestedAccess === 'read_only' && params.requestedAccess === 'workspace_write') ||
      !['launching', 'active'].includes(existing.status))
  ) {
    throw new OrchestrationError(
      'autopilot_native_coordinator_refused',
      'The existing run access, workspace or state does not permit attachment.'
    )
  }
  const owner = sessions.findLiveByRun(params.runId)
  if (owner) {
    if (
      owner.state === 'running' &&
      owner.paneKey &&
      isEquivalentPaneKey(owner.paneKey, authority.paneKey) &&
      owner.processIncarnation === authority.processIncarnation &&
      existing
    ) {
      return { run: existing, owner }
    }
    throw new OrchestrationError(
      'autopilot_owner_exists',
      'Another coordinator still owns the run.'
    )
  }
  if (sessions.findLiveByPane(authority.paneKey, authority.processIncarnation)) {
    throw new OrchestrationError(
      'autopilot_owner_exists',
      'The coordinator still owns another run.'
    )
  }
  let run = existing ?? runs.create(params).run
  const priorBoundary = sessions.latestForRun(run.runId)?.receipt?.nativeTaskBoundary
  const nativeTaskBoundary =
    typeof priorBoundary === 'number'
      ? priorBoundary
      : Number(
          db.db
            .prepare('SELECT COALESCE(MAX(rowid), 0) AS boundary FROM tasks WHERE run_id = ?')
            .get(run.runId)?.boundary
        )
  const started = sessions.insertStarting({
    runId: run.runId,
    launchOperationId: `native_${randomUUID()}`,
    permissionMode: 'manual',
    requestedModel: params.coordinatorModel,
    requestedEffort: params.coordinatorEffort,
    timestamp: params.timestamp
  })
  const running = sessions.markRunning(started.ownerId, {
    terminalHandle: authority.terminalHandle,
    paneKey: authority.paneKey,
    processIncarnation: authority.processIncarnation,
    launchTokenSha256: authority.launchTokenHash,
    launchLedger: 'app_only',
    receipt: { mode: 'terminal', nativeCoordinator: true, nativeTaskBoundary },
    timestamp: params.timestamp
  })
  if (run.status === 'launching') {
    run = runs.transition({
      runId: run.runId,
      from: run.status,
      to: 'active',
      expectedRevision: run.revision,
      reason: null,
      timestamp: params.timestamp
    })
  }
  return { run, owner: running }
}
